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

    const roomSockets = io.of("/game").adapter.rooms.get(roomCode) || new Set();
    if (!activeGames.has(roomCode)) {
      if (roomSockets.size < 2) return; // comment this line to allow starting games with 1 player, for easier testing environment
      if (roomSockets.size > 2) {
        socket.emit("game-error", "Too many players in the room.");
        socket.disconnect(true);
        return;
      }
      activeGames.set(roomCode, new GameState(roomCode, rooms[roomCode]));
    }
    const game = activeGames.get(roomCode);

    broadcast(io, roomCode, "game-init", (playerSocket) =>
      game.getClientState(playerSocket.request.session.username)
    );

    socket.on("game-action", (actionData) => {
      try {
        actionData.username = username;
        console.log("actionData", actionData);
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
