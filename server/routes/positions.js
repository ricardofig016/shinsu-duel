import express from "express";
import { getPlacementRegistry, getPositionCatalog } from "../game/displayCatalogs.js";

/**
 * Serves the position catalog to the client, plus the placement registry the
 * board builds its drop targets from. Prose fields carry compiled display
 * segments (see docs/COMPILED_CARD_DSL.md), so inline links in the copy
 * render; `segmentsToPlainText` projects them where plain text is needed.
 *
 * The payload is a bare map keyed by position code, exactly as it always was,
 * with the registry added under one reserved `placement` key: `{ <position
 * code>: entry, ..., placement: { frontline: slot[], backline: slot[] } }`.
 * Riding the existing payload rather than adding a second route is what keeps
 * the catalog and the slots it describes from disagreeing; a consumer keyed by
 * position code reads the five entries and never sees `placement`.
 */
const router = express.Router();

router.get("/", (req, res) => {
  res.json({ ...getPositionCatalog(), placement: getPlacementRegistry() });
});

export default router;
