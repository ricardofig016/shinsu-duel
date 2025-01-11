import express from "express";
import path from "path";
import winston from "winston";

const router = express.Router();
const validRoomCodes = new Set();

// logger
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

router.get("/", (req, res) => {
  res.redirect("/play");
});

router.post("/create-room", (req, res) => {
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  validRoomCodes.add(roomCode);
  logger.info(`Room created with code: ${roomCode}`);
  res.redirect(`/game/${roomCode}`);
});

router.get("/:roomCode", (req, res) => {
  const { roomCode } = req.params;
  if (validRoomCodes.has(roomCode)) {
    res.sendFile(path.resolve("public/pages/game.html"));
  } else {
    logger.warn(`Invalid room code attempted: ${roomCode}`);
    res.status(404).send("Invalid room code");
  }
});

export default router;
