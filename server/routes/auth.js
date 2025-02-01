import express from "express";
import path from "path";
import { readJsonFile, writeJsonFile } from "../utils/file-util.js";

const router = express.Router();
const usersFilePath = path.resolve("server/data/users.json");

const createUser = async (username) => {
  const users = await readJsonFile(usersFilePath);
  if (!users[username]) {
    users[username] = {};
    await writeJsonFile(usersFilePath, users);
  }
};

router.get("/status", async (req, res) => {
  if (!req.session.username) return res.json({ isAuthenticated: false });
  const users = await readJsonFile(usersFilePath);
  const user = users[req.session.username];
  if (user) return res.json({ isAuthenticated: true, username: req.session.username });
  return res.json({ isAuthenticated: false });
});

router.post("/login", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).send("Username is required");

  const usernameRegex = /^[a-zA-Z0-9_]{3,18}$/;
  if (!usernameRegex.test(username))
    return res
      .status(400)
      .send(
        "Invalid username, must be 3-18 characters long and contain only letters, numbers, and underscores"
      );

  const users = await readJsonFile(usersFilePath);
  if (!users[username]) await createUser(username);
  req.session.username = username;
  return res.status(200).send("Login successful");
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
