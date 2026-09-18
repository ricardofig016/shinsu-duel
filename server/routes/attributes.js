import express from "express";
import { getIconPath } from "../utils/file-util.js";
import { getAttributes } from "../game/displayCatalogs.js";

/**
 * Serves the attribute catalog to the client. Prose fields carry compiled
 * display segments (see docs/COMPILED_CARD_DSL.md), so inline links in the
 * copy render; `segmentsToPlainText` projects them where plain text is
 * needed.
 */
const router = express.Router();

router.get("/", (req, res) => {
  const attributes = getAttributes();
  const data = {};
  for (const code of Object.keys(attributes)) {
    data[code] = { ...attributes[code], iconPath: getIconPath(code, "attributes") };
  }
  res.json(data);
});

export default router;
