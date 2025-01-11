import express from "express";

const router = express.Router();

router.get("/status", (req, res) => {
  if (req.session.username) {
    res.json({ isAuthenticated: true, username: req.session.username });
  } else {
    res.json({ isAuthenticated: false });
  }
});

router.post("/login", (req, res) => {
  const { username } = req.body;
  if (username) {
    req.session.username = username;
    res.status(200).send("Login successful");
  } else {
    res.status(400).send("Username is required");
  }
});

router.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send("Logout failed");
    }
    res.status(200).send("Logout successful");
  });
});

export default router;
