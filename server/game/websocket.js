import { readJsonFile } from "../utils/file-util.js";
import GameState from "./state.js";
import { roomsFilePath } from "../routes/game.js";

const activeGames = new Map();

export function initializeGameWebSocket(io) {
  io.of("/game").on("connection", async (socket) => {
    const { roomCode } = socket.handshake.query;
    const username = socket.request.session.username;

    // Validate room access
    const rooms = await readJsonFile(roomsFilePath);
    if (!rooms[roomCode] || !rooms[roomCode].players.includes(username)) {
      socket.disconnect(true);
      return;
    }

    // Join room channel
    socket.join(roomCode);

    // Initialize or retrieve game state
    const roomSockets = io.of("/game").adapter.rooms.get(roomCode) || new Set();
    // console.log("active games:", activeGames);
    if (!activeGames.has(roomCode)) {
      // Check if there are already 2 other people connected to the socket
      if (roomSockets.size < 2) return;
      activeGames.set(roomCode, new GameState(roomCode, rooms[roomCode]));
      // console.log("created new game state for room:", roomCode);
    }
    const game = activeGames.get(roomCode);
    // console.log("game:", JSON.stringify(game, null, 2));

    // Send initial game state
    broadcast(io, roomCode, "game-init", (playerSocket) =>
      game.getClientState(playerSocket.request.session.username)
    );
    // console.log("Game state:", JSON.stringify(game.state, null, 2));

    // Handle game actions
    socket.on("game-action", (action) => {
      try {
        if (game.validateAction(action, username)) {
          game.processAction(action);
          // send updated game state to all players in the room
          broadcast(io, roomCode, "game-update", (playerSocket) =>
            game.getClientState(playerSocket.request.session.username)
          );
        }
      } catch (error) {
        socket.emit("game-error", error.message);
      }
    });

    // Handle disconnection
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
