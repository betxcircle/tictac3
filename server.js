const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const mongoose = require("mongoose");

const OdinCircledbModel = require("./models/odincircledb");
const BetModel = require("./models/BetModel");
const WinnerModel = require("./models/WinnerModel");
const LoserModel = require("./models/LoserModel");

require("dotenv").config();

const app = express();
app.use(cors());

const server = http.createServer(app);

// MongoDB Connection
const uri = `mongodb+srv://${process.env.MONGO_USERNAME}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_CLUSTER}.kbgr5.mongodb.net/${process.env.MONGO_DATABASE}?retryWrites=true&w=majority`;

mongoose
  .connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

const activeRooms = {};

io.on("connection", (socket) => {
  console.log(`🔌 User connected: ${socket.id}`);

  socket.on("joinRoom", async ({ playerName, roomId, userId, totalBet, expoPushToken }) => {
    if (!playerName || !userId || !roomId || !totalBet) {
      return socket.emit("invalidJoin", "Missing required fields");
    }

    let room = activeRooms[roomId];

    if (!room) {
      room = {
        roomId,
        players: [],
        board: Array(16).fill(null),
        currentPlayer: 0,
        startingPlayer: 0,
        totalBet,
      };
      activeRooms[roomId] = room;
    }

    if (room.players.length > 0 && room.totalBet !== totalBet) {
      return socket.emit("invalidBet", "Bet amount must match the room");
    }

    if (room.players.length >= 3) {
      return socket.emit("roomFull", "Room already has three players");
    }

    const symbols = ["X", "O", "A"];
    const playerNumber = room.players.length + 1;
    const playerSymbol = symbols[playerNumber - 1];

    room.players.push({ name: playerName, userId, socketId: socket.id, totalBet, playerNumber, symbol: playerSymbol, expoPushToken });

    socket.join(roomId);
    socket.to(roomId).emit("playerJoined", `${playerName} joined`);

    socket.emit("playerInfo", { playerNumber, symbol: playerSymbol, playerName, roomId, userId });

    io.to(roomId).emit("playersUpdate", room.players);

    if (room.players.length === 2 || room.players.length === 3) {
      io.to(roomId).emit("gameReady", {
        players: room.players.map((p) => ({ name: p.name, symbol: p.symbol })),
        roomId,
      });

      room.currentPlayer = room.startingPlayer;
      io.to(roomId).emit("turnChange", room.currentPlayer);
    }
  });

  socket.on("makeMove", ({ roomId, index }) => {
    const room = activeRooms[roomId];

    if (!room || !room.players || room.players.length < 2) {
      return socket.emit("invalidMove", "Invalid game state or not enough players");
    }

    if (room.board[index] !== null) {
      return socket.emit("invalidMove", "Cell already occupied");
    }

    const currentPlayer = room.players[room.currentPlayer];

    if (socket.id !== currentPlayer.socketId) {
      return socket.emit("invalidMove", "Not your turn");
    }

    room.board[index] = currentPlayer.symbol;

    io.to(roomId).emit("moveMade", { index, symbol: currentPlayer.symbol, playerName: currentPlayer.name });

    const winnerSymbol = checkWin(room.board);

    if (winnerSymbol) {
      io.to(roomId).emit("gameOver", { winnerSymbol, result: `${currentPlayer.name} wins!` });
      return;
    }

    if (room.board.every((cell) => cell !== null)) {
      io.to(roomId).emit("gameDraw", { result: "It's a draw!" });
      return;
    }

    room.currentPlayer = (room.currentPlayer + 1) % room.players.length;
    io.to(roomId).emit("turnChange", room.currentPlayer);
  });

  socket.on("disconnect", () => {
    console.log(`❌ User disconnected: ${socket.id}`);

    for (const roomId in activeRooms) {
      const room = activeRooms[roomId];

      if (room) {
        const playerIndex = room.players.findIndex((player) => player.socketId === socket.id);

        if (playerIndex !== -1) {
          const [disconnectedPlayer] = room.players.splice(playerIndex, 1);

          io.to(roomId).emit("playerLeft", { message: `${disconnectedPlayer.name} left the game`, roomId });

          if (room.players.length === 0) {
            delete activeRooms[roomId];
          }
        }
      }
    }
  });
});

function checkWin(board) {
  const winPatterns = [
    [0, 1, 2], [1, 2, 3],
    [4, 5, 6], [5, 6, 7],
    [8, 9, 10], [9, 10, 11],
    [12, 13, 14], [13, 14, 15],
    [0, 4, 8], [4, 8, 12],
    [1, 5, 9], [5, 9, 13],
    [2, 6, 10], [6, 10, 14],
    [3, 7, 11], [7, 11, 15],
    [0, 5, 10], [1, 6, 11],
    [4, 9, 14], [5, 10, 15],
    [3, 6, 9], [2, 5, 8],
    [7, 10, 13], [6, 9, 12],
  ];

  for (const [a, b, c] of winPatterns) {
    if (board[a] && board[a] === board[b] && board[b] === board[c]) {
      return board[a];
    }
  }

  return null;
}

server.listen(5005, () => console.log("🚀 Server running on port 5005"));
