import express from "express";

import affiliations from "./affiliations.js";
import cards from "./cards.js";
import glossary from "./glossary.js";
import login from "./login.js";
import positions from "./positions.js";
import rules from "./rules.js";
import traits from "./traits.js";
import { createAccountStore } from "../accounts/accountStore.js";
import { createAuthRouter } from "./auth.js";
import { createDecksRouter } from "./decks.js";
import { createGameRouter } from "./game.js";
import { createPlayRouter } from "./play.js";

/**
 * The HTTP surface of the server, assembled once per boot with the storage
 * that boot owns.
 *
 * One account store and one session gate are shared by every gated route, so
 * the HTTP gate, the login routes, and the socket identity check cannot
 * disagree about who is signed in: a boot that injects its own accounts (a
 * test harness, an embedded server) injects them everywhere.
 *
 * The content routes hold no runtime state, so they stay module singletons.
 *
 * @param {{ accounts?: object, deckLibrary?: object, catalog?: object,
 *   authRouter?: object }} [options] `authRouter` replaces the whole `/auth`
 *   router, for a boot that needs its own login behavior rather than its own
 *   storage.
 */
export function createRouter({ accounts = createAccountStore(), deckLibrary, catalog, authRouter } = {}) {
  const router = express.Router();

  const decksOptions = { accounts, ...(deckLibrary ? { library: deckLibrary } : {}), ...(catalog ? { catalog } : {}) };

  router.use("/affiliations", affiliations);
  router.use("/auth", authRouter ?? createAuthRouter({ accounts }));
  router.use("/cards", cards);
  router.use("/decks", createDecksRouter(decksOptions));
  router.use("/game", createGameRouter({ accounts }));
  router.use("/glossary", glossary);
  router.use("/login", login);
  router.use("/play", createPlayRouter({ accounts }));
  router.use("/positions", positions);
  router.use("/rules", rules);
  router.use("/traits", traits);

  return router;
}
