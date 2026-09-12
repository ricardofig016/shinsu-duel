import { createAccountStore } from "../accounts/accountStore.js";

const AUTHENTICATION_MESSAGE = "Authentication required.";

/**
 * The session gate for every route that needs a player identity.
 *
 * A request is authenticated only when its session carries a username that
 * still has an account record: no session and a session whose account was
 * removed are the same case. Two contracts share that one check, because an
 * API call and a page load need different answers to the same condition:
 *
 *  - `requireApiSession` answers 401 with a JSON message.
 *  - `requirePageSession` sends the browser to the login page, carrying the
 *    requested URL so a successful login can return to it.
 *
 * Neither contract touches the session. A rejected session stays on the
 * cookie and logging in again overwrites the name, so the user never has to
 * clear anything.
 *
 * @param {{ accounts?: object }} [options] `accounts` is the account store the
 *   gate asks about a username; it is injectable so tests can point it at a
 *   temporary accounts file.
 */
export function createAuthGate({ accounts = createAccountStore() } = {}) {
  const hasLiveSession = async (req) => {
    const username = req.session?.username;
    if (typeof username !== "string" || username.trim() === "") return false;
    return accounts.hasAccount(username);
  };

  // Express 4 does not forward a rejected promise from async middleware, so
  // every gate funnels its own failures into next().
  const requireApiSession = async (req, res, next) => {
    try {
      if (await hasLiveSession(req)) return next();
      return res.status(401).json({ message: AUTHENTICATION_MESSAGE });
    } catch (error) {
      return next(error);
    }
  };

  const requirePageSession = async (req, res, next) => {
    try {
      if (await hasLiveSession(req)) return next();
      return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    } catch (error) {
      return next(error);
    }
  };

  return { requireApiSession, requirePageSession };
}
