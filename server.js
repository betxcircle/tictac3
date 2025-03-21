I const express = require("express");
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
const { v4: uuidv4 } = require('uuid'); // Import UUID for unique room IDs


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

 socket.on("joinRoom", async ({ playerName, userId, amount, expoPushToken }) => {
    console.log(`🔹 Player ${playerName} (ID: ${userId}) wants to join a room with bet amount: ${amount}`);

    if (!playerName || !userId || !amount) {
        console.log("❌ Missing required fields for joining the room.");
        return socket.emit("invalidJoin", "Missing required fields");
    }

    // Find an existing room with the same bet amount and an open slot
    let room = Object.values(activeRooms).find(r => r.amount === amount && r.players.length < 2);

    // If no available room, create a new one
    if (!room) {
        const newRoomId = uuidv4(); // Generate unique room ID
        console.log(`🆕 No available room, creating Room ${newRoomId} with bet amount: ${amount}`);

        room = {
            roomId: newRoomId,
            players: [],
            board: Array(16).fill(null),
            currentPlayer: 0,
            startingPlayer: 0,
            amount,
        };
        activeRooms[newRoomId] = room;
    }

    if (room.players.length >= 2) {
        console.log(`🚫 Room ${room.roomId} is full. ${playerName} cannot join.`);
        return socket.emit("roomFull", "Room is already full. Create a new room.");
    }

    const symbols = ["X", "O"];
    const playerNumber = room.players.length + 1;
    const playerSymbol = symbols[playerNumber - 1];

    room.players.push({ 
        name: playerName, 
        userId, 
        socketId: socket.id, 
        amount, 
        playerNumber, 
        symbol: playerSymbol, 
        expoPushToken 
    });

    socket.join(room.roomId);
    console.log(`✅ ${playerName} joined Room ${room.roomId} as Player ${playerNumber} with Symbol: ${playerSymbol}`);

    socket.to(room.roomId).emit("playerJoined", `${playerName} joined`);
    io.to(room.roomId).emit("playersUpdate", room.players);

    console.log(`🔄 Room ${room.roomId} now has ${room.players.length} players:`, room.players);

    if (room.players.length === 2) {
        console.log(`🎮 Game in Room ${room.roomId} is ready! Players:`, room.players);

        io.to(room.roomId).emit("gameReady", {
            players: room.players.map((p) => ({ name: p.name, symbol: p.symbol, amount: p.amount })),
            roomId: room.roomId,
            amount: room.amount,
        });

        room.currentPlayer = room.startingPlayer;
        console.log(`🌀 Turn changed: Now it's Player ${room.currentPlayer}'s turn.`);
        io.to(room.roomId).emit("turnChange", room.currentPlayer);
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
