import express from "express";
import path from "node:path";
import authGate from "./authentication.js";

const router = express.Router();
const { requirePageSession } = authGate;

router.get("/", requirePageSession, (req, res) => {
  res.sendFile(path.resolve("public/pages/play/index.html"));
});

export default router;
