import express from "express";
import path from "path";
import crypto from "node:crypto";
import winston from "winston";
import { readJsonFile, writeJsonFile } from "../utils/file-util.js";
import { generateSeed } from "../game/utils/SeededRng.js";
import { createAccountStore } from "../accounts/accountStore.js";
import { createAuthGate } from "./authentication.js";
import { botPlaystyles, botDeckMethods } from "../bots/botSeat.js";
import { STEP, roomStep, stepPath, stepDocument, deniedDocument } from "../game/net/roomSteps.js";

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
 * Game routes with injectable storage, so tests can drive room creation and
 * joining against a temporary rooms file.
 *
 * @param {{ roomsFilePath?: string, accounts?: object, registry?: object }} [options]
 *   `accounts` is the account store the session gate reads, injectable so a
 *   server boot shares one store across the login routes, the gate, and the
 *   socket. `registry` is the session registry the room pages read to resolve
 *   which step a room is in; without it every room reads as waiting.
 */
export function createGameRouter({
  roomsFilePath: roomsFile = roomsFilePath,
  accounts = createAccountStore(),
  registry = null,
} = {}) {
  const router = express.Router();
  const { requireApiSession, requirePageSession } = createAuthGate({ accounts });

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

  router.post("/createRoom", requireApiSession, (req, res, next) => {
    const { opponent, bot, deckMethod } = req.body;
    if (!["bot", "friend"].includes(opponent))
      return res.status(400).send("Invalid opponent type. Must be 'bot' or 'friend'");

    let botSpec = null;
    if (opponent === "bot") {
      if (typeof bot !== "string" || !botPlaystyles.has(bot))
        return res.status(400).send("Unknown bot.");
      if (typeof deckMethod !== "string" || !botDeckMethods.has(deckMethod))
        return res.status(400).send("Unknown deck method.");
      botSpec = { bot, deckMethod };
    }

    withRoomFileLock(async () => {
      const rooms = await readJsonFile(roomsFile);
      let roomCode;
      do roomCode = crypto.randomInt(0, 36 ** 6).toString(36).toUpperCase().padStart(6, "0");
      while (rooms[roomCode]);
      rooms[roomCode] = {
        players: [],
        opponent,
        ...(botSpec ? { bot: botSpec } : {}),
        seed: generateSeed(),
      };

      await writeJsonFile(roomsFile, rooms);
      logger.info(
        `Room created with code: ${roomCode}, opponent: ${opponent}${botSpec ? `, bot: ${botSpec.bot}/${botSpec.deckMethod}` : ""}`
      );
      return roomCode;
    })
      .then((roomCode) => res.send(roomCode))
      .catch(next);
  });

  /**
   * Whether a room's human seats are all taken. A bot room is full once its
   * creator has claimed the seat: the other seat belongs to the bot and no
   * second human can join.
   * @param {object} room a room record
   */
  const isRoomFull = (room) => room.players.length >= 2 || (room.opponent === "bot" && room.players.length >= 1);

  /**
   * Serve the step the room is in, wherever the request asked to be.
   *
   * Every room address resolves to the same answer, so a shared or stale link
   * always lands a player at the step the room has reached; a request for
   * another step is redirected to the canonical address for the current one.
   * A visitor who is not in the room's player list is seated by the waiting
   * room itself (`POST /:roomCode/join`) when a seat is free, and gets the
   * denied page when the room is unknown or full.
   */
  const serveRoomStep = (requested) => async (req, res, next) => {
    const { roomCode } = req.params;
    const username = req.session.username;
    try {
      const rooms = await readJsonFile(roomsFile);
      const room = roomCode ? rooms[roomCode] : undefined;
      if (!room) {
        logger.warn(`Invalid access attempt to inexistant room: ${roomCode} by user: ${username}`);
        // Add request context to help track where malformed requests originate from
        logger.warn(
          `Request details: originalUrl=${req.originalUrl}, referer=${req.headers.referer || "none"}, method=${
            req.method
          }, ip=${req.ip}, params=${JSON.stringify(req.params)}, query=${JSON.stringify(req.query)}`
        );
        return res.status(404).sendFile(deniedDocument());
      }
      if (!room.players.includes(username) && isRoomFull(room)) {
        logger.warn(`Invalid access attempt to room: ${roomCode} by user: ${username}`);
        return res.status(403).sendFile(deniedDocument());
      }

      const step = roomStep({ session: registry?.get(roomCode) ?? null });
      if (step !== requested) return res.redirect(stepPath(roomCode, step));
      return res.sendFile(stepDocument(step));
    } catch (error) {
      return next(error);
    }
  };

  // The board keeps the bare room address; the two pre-game steps are named.
  router.get("/:roomCode", requirePageSession, serveRoomStep(STEP.BOARD));
  router.get("/:roomCode/waiting", requirePageSession, serveRoomStep(STEP.WAITING));
  router.get("/:roomCode/deck", requirePageSession, serveRoomStep(STEP.DECK));

  router.post("/:roomCode/join", requireApiSession, (req, res, next) => {
    const { roomCode } = req.params;
    const username = req.session.username;

    withRoomFileLock(async () => {
      const rooms = await readJsonFile(roomsFile);
      if (!rooms[roomCode]) {
        logger.warn(`Attempt to join invalid room code: ${roomCode}`);
        return { status: 404, body: "Invalid room code" };
      }
      if (rooms[roomCode].players.includes(username)) {
        logger.info(`Player ${username} already in room: ${roomCode}`);
        return { status: 200, body: `Player ${username} already in room: ${roomCode}` };
      }
      if (isRoomFull(rooms[roomCode])) {
        logger.warn(`Attempt to join full room: ${roomCode}`);
        return { status: 403, body: "Room is full" };
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
