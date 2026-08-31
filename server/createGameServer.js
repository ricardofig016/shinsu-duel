import express from "express";
import session from "express-session";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import morgan from "morgan";
import winston from "winston";
import { createServer } from "http";
import { Server } from "socket.io";
import router from "./routes/router.js";
import { roomsFilePath } from "./routes/game.js";
import { readJsonFile } from "./utils/file-util.js";
import { createSeededGame } from "./game/gameFactory.js";
import SessionRegistry from "./game/net/SessionRegistry.js";
import SocketGateway from "./game/net/socketGateway.js";

async function readFileRoom(code) {
  return (await readJsonFile(roomsFilePath))[code] ?? null;
}

/**
 * Assemble the express app, the HTTP server, and Socket.IO with the game
 * socket gateway attached.
 *
 * The collaborators of the gateway (session registry, room lookup, game
 * factory) are injectable so tests can boot this exact stack in-process with
 * their own room store and card catalog; production uses the defaults and
 * only `server/app.js` calls this without arguments.
 *
 * @param {object} [args]
 * @param {import("./game/net/SessionRegistry.js").default} [args.registry]
 *   session registry backing the gateway
 * @param {(roomCode: string) => Promise<object|null>} [args.loadRoom]
 *   room lookup by code
 * @param {Function} [args.createGame] `({ roomCode, usernames, seed }) => GameState`
 * @param {boolean} [args.logToFile=true] when false, no file logging is
 *   configured (embedded and test boots)
 * @returns {{ app: express.Express, server: import("http").Server,
 *   io: import("socket.io").Server, gateway: SocketGateway,
 *   registry: SessionRegistry }}
 */
export function createGameServer({ registry = new SessionRegistry(), loadRoom, createGame, logToFile = true } = {}) {
  const app = express();
  const server = createServer(app);
  const io = new Server(server);

  // middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(64).toString("hex");
  const sessionMiddleware = session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // set to true if using HTTPS
  });
  app.use(sessionMiddleware);
  io.engine.use(sessionMiddleware);

  const logger = winston.createLogger({
    level: "info",
    silent: !logToFile,
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: logToFile
      ? [
          new winston.transports.File({ filename: "server/logs/error.log", level: "error" }),
          new winston.transports.File({ filename: "server/logs/combined.log" }),
        ]
      : [],
  });
  if (logToFile) {
    const accessLogStream = fs.createWriteStream(path.resolve("server/logs/access.log"), { flags: "a" });
    app.use(morgan("combined", { stream: accessLogStream }));
  }

  app.use((err, req, res, next) => {
    logger.error(`${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
    next(err);
  });

  app.use(express.static(path.resolve("public")));
  app.use("/", router);

  const gameGateway = new SocketGateway({
    registry,
    loadRoom: loadRoom ?? readFileRoom,
    createGame: createGame ?? (({ roomCode, usernames, seed }) => createSeededGame({ roomCode, usernames, seed })),
    logger,
  });
  gameGateway.attach(io);

  return { app, server, io, gateway: gameGateway, registry };
}
