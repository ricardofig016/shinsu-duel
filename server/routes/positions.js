import express from "express";
import { getIconPath } from "../utils/file-util.js";
import { getPositions } from "../game/displayCatalogs.js";

/**
 * Serves the position catalog to the client. Prose fields carry compiled
 * display segments (see docs/COMPILED_CARD_DSL.md), so inline links in the
 * copy render; `segmentsToPlainText` projects them where plain text is
 * needed.
 */
const router = express.Router();

router.get("/", (req, res) => {
  const positions = getPositions();
  const data = {};
  for (const code of Object.keys(positions)) {
    data[code] = { ...positions[code], iconPath: getIconPath(code, "positions") };
  }
  res.json(data);
});

export default router;
