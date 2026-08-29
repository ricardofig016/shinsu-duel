import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();
const rulesFilePath = path.resolve("RULES.md");
const guideFilePath = path.resolve("HOW_TO_PLAY.md");

const sendMarkdownFile = (filePath) => (req, res) => {
  res.type("text/markdown").send(fs.readFileSync(filePath, "utf-8"));
};

router.get("/content", sendMarkdownFile(rulesFilePath));
router.get("/guide/content", sendMarkdownFile(guideFilePath));

router.get("/", (req, res) => {
  res.sendFile(path.resolve("public/pages/rules/index.html"));
});

export default router;
