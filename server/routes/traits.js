import express from "express";
import path from "path";
import fs from "fs";
import { getIconPath } from "../utils/file-util.js";

const router = express.Router();

router.get("/", (req, res) => {
  const data = JSON.parse(fs.readFileSync(path.resolve("server/data/traits.json"), "utf-8"));
  for (let code of Object.keys(data)) {
    data[code].iconPath = getIconPath(code, "traits");
  }
  res.json(data);
});

export default router;
