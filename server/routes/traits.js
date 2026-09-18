import express from "express";
import { getIconPath } from "../utils/file-util.js";
import { getTraits } from "../game/displayCatalogs.js";

/**
 * Serves the trait catalog to the client. Prose fields carry compiled display
 * segments (see docs/COMPILED_CARD_DSL.md), so inline links in the copy
 * render; `segmentsToPlainText` projects them where plain text is needed.
 */
const router = express.Router();

router.get("/", (req, res) => {
  const traits = getTraits();
  const data = {};
  for (const code of Object.keys(traits)) {
    data[code] = { ...traits[code], iconPath: getIconPath(code, "traits") };
  }
  res.json(data);
});

export default router;
