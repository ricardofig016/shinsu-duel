import express from "express";
import path from "path";
import winston from "winston";

const router = express.Router();
const rooms = {};

// middleware
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

const isAuthenticated = (req, res, next) => {
  if (req.session.username) {
    return next();
  } else {
    res.status(403).send("Access denied, please login.");
  }
};

// routes
router.get("/", (req, res) => {
  res.redirect("/play");
});

router.post("/create-room", isAuthenticated, (req, res) => {
  const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  rooms[roomCode] = { players: [] };
  logger.info(`Room created with code: ${roomCode}`);
  res.send(roomCode);
});

router.get("/:roomCode", isAuthenticated, (req, res) => {
  const { roomCode } = req.params;
  const username = req.session.username;
  if (!rooms[roomCode]) {
    logger.warn(`Invalid access attempt to inexistant room: ${roomCode} by user: ${username}`);
    return res.status(404).send("Invalid room code");
  }
  if (!rooms[roomCode].players.includes(username)) {
    logger.warn(`Invalid access attempt to room: ${roomCode} by user: ${username}`);
    return res.status(403).send("Access denied");
  }
  return res.sendFile(path.resolve("public/pages/game.html"));
});

router.post("/:roomCode/join", isAuthenticated, (req, res) => {
  const { roomCode } = req.params;
  const username = req.session.username;
  if (!rooms[roomCode]) {
    logger.warn(`Attempt to join invalid room code: ${roomCode}`);
    return res.status(404).send("Invalid room code");
  }
  if (rooms[roomCode].players.length >= 2) {
    logger.warn(`Attempt to join full room: ${roomCode}`);
    return res.status(403).send("Room is full");
  }
  if (rooms[roomCode].players.includes(username)) {
    logger.info(`Player ${username} already in room: ${roomCode}`);
    return res.status(200).send(`Player ${username} already in room: ${roomCode}`);
  }
  rooms[roomCode].players.push(username);
  logger.info(`Player ${username} joined room: ${roomCode}`);
  return res.status(200).send(`Player ${username} joined room: ${roomCode}`);
});

export default router;
