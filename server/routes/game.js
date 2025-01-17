import express from "express";
import path from "path";
import winston from "winston";
import { readJsonFile, writeJsonFile } from "../utils/file-util.js";

const router = express.Router();
const roomsFilePath = path.resolve("server/data/rooms.json");

// middleware
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: "server/logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "server/logs/combined.log" }),
  ],
});

const isAuthenticated = (req, res, next) => {
  return next(); // TODO: remove this line (for testing purposes only)
  if (req.session.username) return next();
  return res.status(403).send("Access denied, please login.");
};

// routes
router.get("/", (req, res) => {
  res.redirect("/play");
});

router.post("/createRoom", isAuthenticated, async (req, res) => {
  const { opponent, difficulty } = req.body;
  if (!["bot", "friend"].includes(opponent))
    return res.status(400).send("Invalid opponent type. Must be 'bot' or 'friend'");
  if (opponent === "bot" && !["easy", "hard"].includes(difficulty))
    return res.status(400).send("Invalid difficulty. Must be 'easy' or 'hard'");

  const rooms = await readJsonFile(roomsFilePath);
  let roomCode;
  do roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  while (rooms[roomCode]);
  rooms[roomCode] = { players: [], opponent, difficulty: opponent === "bot" ? difficulty : null };

  await writeJsonFile(roomsFilePath, rooms);
  logger.info(`Room created with code: ${roomCode}, opponent: ${opponent}, difficulty: ${difficulty}`);
  res.send(roomCode);
});

router.get("/:roomCode", isAuthenticated, async (req, res) => {
  const { roomCode } = req.params;
  const username = req.session.username;
  const rooms = await readJsonFile(roomsFilePath);
  if (!roomCode || !rooms[roomCode]) {
    logger.warn(`Invalid access attempt to inexistant room: ${roomCode} by user: ${username}`);
    return res.status(404).send("Invalid room code");
  }
  if (!rooms[roomCode].players.includes(username)) {
    return res.sendFile(path.resolve("public/pages/game/index.html")); // TODO: remove this line (for testing purposes only)
    logger.warn(`Invalid access attempt to room: ${roomCode} by user: ${username}`);
    return res.status(403).send("Access denied");
  }
  return res.sendFile(path.resolve("public/pages/game/index.html"));
});

router.post("/:roomCode/join", isAuthenticated, async (req, res) => {
  const { roomCode } = req.params;
  const username = req.session.username;
  const rooms = await readJsonFile(roomsFilePath);
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
  await writeJsonFile(roomsFilePath, rooms);
  logger.info(`Player ${username} joined room: ${roomCode}`);
  return res.status(200).send(`Player ${username} joined room: ${roomCode}`);
});

export default router;
