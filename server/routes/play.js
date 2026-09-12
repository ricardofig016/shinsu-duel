import express from "express";
import path from "node:path";
import { createAccountStore } from "../accounts/accountStore.js";
import { createAuthGate } from "./authentication.js";

/**
 * The play page, behind the page gate: an anonymous visitor is sent to the
 * login page first.
 *
 * @param {{ accounts?: object }} [options] `accounts` is the account store the
 *   session gate reads, injectable so a server boot shares one store across
 *   the login routes, the gate, and the socket.
 */
export function createPlayRouter({ accounts = createAccountStore() } = {}) {
  const router = express.Router();
  const { requirePageSession } = createAuthGate({ accounts });

  router.get("/", requirePageSession, (req, res) => {
    res.sendFile(path.resolve("public/pages/play/index.html"));
  });

  return router;
}
