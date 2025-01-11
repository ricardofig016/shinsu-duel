import express from "express";
import path from "path";

const router = express.Router();
const validRoomCodes = new Set();

router.get("/", (req, res) => {
  res.redirect("/play");
});

router.post("/create-room", (req, res) => {
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase(); // Generate a random 6-character room code
  validRoomCodes.add(roomCode); // Store the room code as valid
  res.redirect(`/game/${roomCode}`);
});

router.get("/:roomCode", (req, res) => {
  const { roomCode } = req.params;
  if (validRoomCodes.has(roomCode)) {
    res.sendFile(path.resolve("public/pages/game.html"));
  } else {
    res.status(404).send("Invalid room code");
  }
});

export default router;