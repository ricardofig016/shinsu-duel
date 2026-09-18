import express from "express";
import { getGlossaryView } from "../game/displayCatalogs.js";

/**
 * Serves the client-facing tooltip glossary: the descriptive copy the UI
 * renders outside the card views (types, kinds, ranks, header concepts, HUD
 * strings, line labels). Tooltip copy is server-owned; the frontend only
 * looks entries up by code and styles them. Prose fields carry compiled
 * display segments (see docs/COMPILED_CARD_DSL.md), so inline links render.
 * The payload is composed per request from the active compiled copy, whose
 * rank entries carry the canonical rank catalog's cost ranges, so a displayed
 * range can't drift from build-time validation and a missing rank copy fails
 * on the first request instead of silently degrading.
 */
const router = express.Router();

router.get("/", (req, res) => {
  res.json(getGlossaryView());
});

export default router;
