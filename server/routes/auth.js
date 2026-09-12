import express from "express";
import { createAccountStore } from "../accounts/accountStore.js";
import { provisionStarterDecks } from "../decks/deckProvisioning.js";

/**
 * Auth routes with injectable storage, so tests can drive login against a
 * temporary accounts file and deck library.
 *
 * @param {{ accounts?: object, provisionDecks?: Function }} [options]
 *   `accounts` is the account store the routes read and write, injectable so a
 *   server boot uses one store for the login routes, the session gate, and the
 *   socket identity check.
 */
export function createAuthRouter({ accounts = createAccountStore(), provisionDecks = provisionStarterDecks } = {}) {
  const router = express.Router();

  // A newly created account receives one copy of every starter deck. An
  // existing record is never provisioned again, so deleted decks stay deleted.
  // A failed provisioning rolls the account record back: the next login
  // retries from scratch, so no account can get stuck without its decks.
  const createUser = async (username) => {
    if (!(await accounts.createAccountIfMissing(username))) return;
    try {
      await provisionDecks(username);
    } catch (error) {
      await accounts.removeAccount(username);
      throw error;
    }
  };

  router.get("/status", async (req, res) => {
    if (!req.session.username) return res.json({ isAuthenticated: false });
    if (await accounts.hasAccount(req.session.username)) {
      return res.json({ isAuthenticated: true, username: req.session.username });
    }
    return res.json({ isAuthenticated: false });
  });

  router.post("/login", async (req, res, next) => {
    const { username } = req.body;
    if (!username) return res.status(400).send("Username is required");

    const usernameRegex = /^[a-zA-Z0-9_]{3,18}$/;
    if (!usernameRegex.test(username))
      return res
        .status(400)
        .send(
          "Invalid username, must be 3-18 characters long and contain only letters, numbers, and underscores"
        );

    try {
      await createUser(username);
    } catch (error) {
      return next(error);
    }
    req.session.username = username;
    return res.status(200).send("Login successful");
  });

  router.post("/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).send("Logout failed");
      }
      res.status(200).send("Logout successful");
    });
  });

  return router;
}
