import express from "express";
import path from "path";
import fs from "fs";

const router = express.Router();

router.get("/", (req, res) => {
  const data = JSON.parse(fs.readFileSync(path.resolve("server/data/affiliations.json"), "utf-8"));
  res.json(data);
});

export default router;
