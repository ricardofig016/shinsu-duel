import express from "express";
import path from "node:path";

const router = express.Router();

// The login page is the one page that answers without a session: it is where
// the session gate sends everyone else.
router.get("/", (req, res) => {
  res.sendFile(path.resolve("public/pages/login/index.html"));
});

export default router;
