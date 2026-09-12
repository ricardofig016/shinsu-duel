/**
 * The client side of the login redirect contract.
 *
 * Two callers need the same answer about where a login should send the
 * browser: the shared fetch wrapper that reacts to a rejected request, and the
 * login page itself. The answer travels in a `next` query parameter, which is
 * attacker-controllable, so it is validated here and nowhere else.
 *
 * Every function takes its collaborators (`fetchImpl`, `navigate`, `location`)
 * as injectable options with browser defaults, so the module is testable
 * without a DOM.
 */

const LOGIN_PATH = "/login";
const DEFAULT_NEXT = "/play";
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f\s\\]/;

/**
 * Whether a candidate is a same-origin relative path this app may navigate to:
 * a single leading slash, no scheme, no backslash, no control character or
 * whitespace, and not the login page itself, which would loop.
 */
const isSafeNextPath = (candidate) => {
  if (typeof candidate !== "string" || !candidate.startsWith("/")) return false;
  if (candidate.startsWith("//")) return false;
  if (UNSAFE_CHARACTERS.test(candidate)) return false;
  if (candidate === LOGIN_PATH) return false;
  if (candidate.startsWith(`${LOGIN_PATH}?`) || candidate.startsWith(`${LOGIN_PATH}/`)) return false;
  return true;
};

/**
 * The path a login should return to, read from a location search string.
 * Anything unsafe, missing, or pointing back at the login page yields
 * `fallback`.
 */
export const safeNextPath = (search, fallback = DEFAULT_NEXT) => {
  const candidate = new URLSearchParams(typeof search === "string" ? search : "").get("next");
  return isSafeNextPath(candidate) ? candidate : fallback;
};

/** The login URL that returns to `location` once the login succeeds. */
export const loginUrlFor = (location) => {
  const target = `${location?.pathname ?? DEFAULT_NEXT}${location?.search ?? ""}`;
  return `${LOGIN_PATH}?next=${encodeURIComponent(target)}`;
};

const browserNavigate = (url) => {
  window.location.assign(url);
};

/**
 * Send the browser to the login page and return a promise that never settles,
 * so the caller's chain stops where it is instead of rendering its own failure
 * message while the page unloads.
 */
export const redirectToLogin = ({ location = null, navigate = null } = {}) => {
  const navigateTo = navigate ?? browserNavigate;
  navigateTo(loginUrlFor(location ?? window.location));
  return new Promise(() => {});
};

/**
 * `fetch` for routes that need a session. A 401 means the session is gone, so
 * the browser goes to the login page rather than every call site inventing its
 * own reaction. Every other status is handed back untouched.
 */
export const authFetch = async (input, init, options = {}) => {
  const { fetchImpl = globalThis.fetch } = options;
  const response = await fetchImpl(input, init);
  if (response.status === 401) return redirectToLogin(options);
  return response;
};
