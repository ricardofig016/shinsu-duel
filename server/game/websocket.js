import { readJsonFile } from "../utils/file-util.js";
import GameState from "./state.js";
import { roomsFilePath } from "../routes/game.js";

const activeGames = new Map();

export function initializeGameWebSocket(io) {
  io.of("/game").on("connection", async (socket) => {
    const { roomCode } = socket.handshake.query;
    const username = socket.request.session.username;

    const rooms = await readJsonFile(roomsFilePath);
    if (!rooms[roomCode] || !rooms[roomCode].players.includes(username)) {
      socket.disconnect(true);
      return;
    }

    socket.join(roomCode);

    if (activeGames.has(roomCode)) {
      const game = activeGames.get(roomCode);
      socket.emit("game-update", game.getClientState(username));
    } else {
      const roomSockets = io.of("/game").adapter.rooms.get(roomCode) || new Set();
      if (roomSockets.size > 2) {
        socket.emit("game-error", "Too many players in the room.");
        socket.disconnect(true);
        return;
      }
      // Initialize the game state only if there are 2 players in the room
      if (roomSockets.size == 2) {
        const config = rooms[roomCode];
        // Rename players to usernames for consistency
        config.usernames = config.players;
        delete config.players;
        const game = new GameState(roomCode, config);
        activeGames.set(roomCode, game);
        broadcast(io, roomCode, "game-init", (playerSocket) =>
          game.getClientState(playerSocket.request.session.username)
        );
      }
    }

    socket.on("game-action", (actionData) => {
      const game = activeGames.get(roomCode);
      if (!game) socket.emit("game-error", "Game has not started yet.");
      try {
        actionData.username = username; // always add username to action data
        game.processAction(actionData);
        broadcast(io, roomCode, "game-update", (playerSocket) =>
          game.getClientState(playerSocket.request.session.username)
        );
      } catch (error) {
        socket.emit("game-error", error.message);
      }
    });

    socket.on("disconnect", () => {
      const roomSockets = io.of("/game").adapter.rooms.get(roomCode) || new Set();
      if (roomSockets.size === 0) activeGames.delete(roomCode);
    });
  });
}

const broadcast = (io, roomCode, event, getData) => {
  const roomSockets = io.of("/game").adapter.rooms.get(roomCode) || new Set();
  roomSockets.forEach((socketId) => {
    const playerSocket = io.of("/game").sockets.get(socketId);
    if (playerSocket) {
      const data = getData(playerSocket);
      playerSocket.emit(event, data);
    }
  });
};
