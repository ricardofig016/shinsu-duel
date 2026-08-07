import { readJsonFile } from "../utils/file-util.js";
import GameState from "./GameState.js";
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
        const game = new GameState(roomCode, rooms[roomCode].players);
        activeGames.set(roomCode, game);
        broadcast(io, roomCode, "game-init", (playerSocket) =>
          game.getClientState(playerSocket.request.session.username)
        );
      }
    }

    socket.on("game-action", (action) => {
      const game = activeGames.get(roomCode);
      if (!game) { socket.emit("game-error", "Game has not started yet."); return; }

      // Check for game over — reject actions
      if (game.gameOver) {
        socket.emit("game-over", game.gameOver);
        return;
      }

      try {
        action.data.username = username;
        action.data.source = "player"; // mark action as player-sourced
        game.processAction(action);

        // Check if game ended from this action
        if (game.gameOver) {
          broadcast(io, roomCode, "game-over", () => game.gameOver);
        }

        broadcast(io, roomCode, "game-update", (playerSocket) =>
          game.getClientState(playerSocket.request.session.username)
        );
      } catch (error) {
        socket.emit("game-error", error.message);
      }
    });

    // Phase 2: pending-decision protocol
    socket.on("game-decision", (decision) => {
      const game = activeGames.get(roomCode);
      if (!game) return;
      try {
        game.resolveDecision({ ...decision, username });
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
