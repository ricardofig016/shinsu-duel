import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();
const rulesFilePath = path.resolve("RULES.md");

router.get("/content", (req, res) => {
  res.type("text/markdown").send(fs.readFileSync(rulesFilePath, "utf-8"));
});

router.get("/", (req, res) => {
  res.sendFile(path.resolve("public/pages/rules/index.html"));
});

export default router;
