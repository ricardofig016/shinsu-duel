import express from "express";
import path from "path";

const router = express.Router();

router.get("/play", (req, res) => {
  res.sendFile(path.resolve("public/pages/play.html"));
});

router.get("/rules", (req, res) => {
  res.sendFile(path.resolve("public/pages/rules.html"));
});

export default router;
