import express from "express";
import path from "path";
import crypto from "node:crypto";
import winston from "winston";
import { readJsonFile, writeJsonFile } from "../utils/file-util.js";
import { generateSeed } from "../game/utils/SeededRng.js";
import { isAuthenticated } from "./authentication.js";

export const roomsFilePath = path.resolve("server/data/rooms.json");

// middleware
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: "server/logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "server/logs/combined.log" }),
  ],
});

/**
 * Auth routes with injectable storage, so tests can drive room creation and
 * joining against a temporary rooms file.
 *
 * @param {{ roomsFilePath?: string }} [options]
 */
export function createGameRouter({ roomsFilePath: roomsFile = roomsFilePath } = {}) {
  const router = express.Router();

  /**
   * Serialized read-modify-write over the rooms runtime file. The JSON file has
   * no atomic compare-and-swap, so two concurrent joins would each read the
   * same player list and the last write would silently drop the other join
   * (leaving a seat locked out of its own room). Every mutation queues behind
   * the previous one.
   */
  let roomFileQueue = Promise.resolve();
  const withRoomFileLock = (task) => {
    const run = roomFileQueue.then(task);
    roomFileQueue = run.catch(() => {});
    return run;
  };

  router.get("/", (req, res) => {
    res.redirect("/play");
  });

  router.post("/createRoom", isAuthenticated, (req, res, next) => {
    const { opponent, difficulty } = req.body;
    if (!["bot", "friend"].includes(opponent))
      return res.status(400).send("Invalid opponent type. Must be 'bot' or 'friend'");
    if (opponent === "bot" && !["easy", "hard"].includes(difficulty))
      return res.status(400).send("Invalid difficulty. Must be 'easy' or 'hard'");

    withRoomFileLock(async () => {
      const rooms = await readJsonFile(roomsFile);
      let roomCode;
      do roomCode = crypto.randomInt(0, 36 ** 6).toString(36).toUpperCase().padStart(6, "0");
      while (rooms[roomCode]);
      rooms[roomCode] = {
        players: [],
        opponent,
        difficulty: opponent === "bot" ? difficulty : null,
        seed: generateSeed(),
      };

      await writeJsonFile(roomsFile, rooms);
      logger.info(`Room created with code: ${roomCode}, opponent: ${opponent}, difficulty: ${difficulty}`);
      return roomCode;
    })
      .then((roomCode) => res.send(roomCode))
      .catch(next);
  });

  router.get("/:roomCode", isAuthenticated, async (req, res) => {
    const { roomCode } = req.params;
    const username = req.session.username;
    const rooms = await readJsonFile(roomsFile);
    if (!roomCode || !rooms[roomCode]) {
      logger.warn(`Invalid access attempt to inexistant room: ${roomCode} by user: ${username}`);
      // Add request context to help track where malformed requests originate from
      logger.warn(
        `Request details: originalUrl=${req.originalUrl}, referer=${req.headers.referer || "none"}, method=${
          req.method
        }, ip=${req.ip}, params=${JSON.stringify(req.params)}, query=${JSON.stringify(req.query)}`
      );
      return res.status(404).send("Invalid room code");
    }
    if (!rooms[roomCode].players.includes(username)) {
      logger.warn(`Invalid access attempt to room: ${roomCode} by user: ${username}`);
      return res.status(403).send("Access denied");
    }
    return res.sendFile(path.resolve("public/pages/game/index.html"));
  });

  router.post("/:roomCode/join", isAuthenticated, (req, res, next) => {
    const { roomCode } = req.params;
    const username = req.session.username;

    withRoomFileLock(async () => {
      const rooms = await readJsonFile(roomsFile);
      if (!rooms[roomCode]) {
        logger.warn(`Attempt to join invalid room code: ${roomCode}`);
        return { status: 404, body: "Invalid room code" };
      }
      if (rooms[roomCode].players.length >= 2) {
        if (rooms[roomCode].players.includes(username)) {
          logger.info(`Player ${username} already in room: ${roomCode}`);
          return { status: 200, body: `Player ${username} already in room: ${roomCode}` };
        }
        logger.warn(`Attempt to join full room: ${roomCode}`);
        return { status: 403, body: "Room is full" };
      }
      if (rooms[roomCode].players.includes(username)) {
        logger.info(`Player ${username} already in room: ${roomCode}`);
        return { status: 200, body: `Player ${username} already in room: ${roomCode}` };
      }
      rooms[roomCode].players.push(username);
      await writeJsonFile(roomsFile, rooms);
      logger.info(`Player ${username} joined room: ${roomCode}`);
      return { status: 200, body: `Player ${username} joined room: ${roomCode}` };
    })
      .then(({ status, body }) => res.status(status).send(body))
      .catch(next);
  });

  return router;
}

export default createGameRouter();
