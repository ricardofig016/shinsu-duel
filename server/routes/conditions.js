import express from "express";
import { getIconPath } from "../utils/file-util.js";
import { getConditions } from "../game/displayCatalogs.js";

/**
 * Serves the condition catalog to the client. Prose fields carry compiled
 * display segments (see docs/COMPILED_CARD_DSL.md), so inline links in the
 * copy render; `segmentsToPlainText` projects them where plain text is
 * needed.
 */
const router = express.Router();

router.get("/", (req, res) => {
  const conditions = getConditions();
  const data = {};
  for (const code of Object.keys(conditions)) {
    data[code] = { ...conditions[code], iconPath: getIconPath(code, "conditions") };
  }
  res.json(data);
});

export default router;
