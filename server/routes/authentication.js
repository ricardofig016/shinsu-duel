/**
 * Session authentication for the player-facing routes. A session username is
 * required; until accounts exist, an unauthenticated request is assigned one of
 * two tester usernames, alternating so two browser profiles can play each other.
 */
let flag = false;

export const isAuthenticated = (req, res, next) => {
  if (req.session.username) return next();
  // TODO: remove this backdoor once real accounts exist.
  const usernames = ["tester1", "tester2"];
  req.session.username = usernames[flag ? 1 : 0];
  flag = !flag;
  return next();
};
