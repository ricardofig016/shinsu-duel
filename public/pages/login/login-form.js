import { safeNextPath } from "../../utils/auth-redirect.js";

const FALLBACK_MESSAGE = "Login failed. Please try again.";

const browserNavigate = (url) => {
  window.location.assign(url);
};

/**
 * Read the session status, or null when it cannot be read. A status request
 * that fails is treated as not signed in, so the page still offers the form.
 */
export const loadSession = async ({ fetchImpl = null } = {}) => {
  const send = fetchImpl ?? globalThis.fetch;
  try {
    const response = await send("/auth/status");
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
};

/**
 * Where a visitor to the login page belongs: the requested page when the
 * session is already valid, or null when the page must stay put and show the
 * form. An unsafe `next` never leaves this origin.
 */
export const resolveDestination = ({ status, search }) =>
  status?.isAuthenticated ? safeNextPath(search) : null;

/**
 * Log in and navigate to `nextPath` on success. Returns the server's message
 * when the login is rejected and null once the browser is on its way, so the
 * caller renders the server's own words instead of a duplicated rule.
 */
export const submitLogin = async ({ username, nextPath, fetchImpl = null, navigate = null }) => {
  const send = fetchImpl ?? globalThis.fetch;
  const response = await send("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!response.ok) return (await response.text()).trim() || FALLBACK_MESSAGE;
  (navigate ?? browserNavigate)(nextPath);
  return null;
};
