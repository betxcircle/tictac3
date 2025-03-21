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
// const { v4: uuidv4 } = require('uuid'); // Import UUID for unique room IDs


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
    console.log(`🔹 Player ${playerName} (ID: ${userId}) is trying to join a room with bet amount: ${amount}`);

    // Validate required fields
    if (!playerName || !userId || !amount) {
        console.log("❌ Error: Missing required fields (playerName, userId, amount).");
        return socket.emit("invalidJoin", "Missing required fields");
    }

    // Look for an existing room with the same amount that has space
    let room = Object.values(activeRooms).find(r => r.amount === amount && r.players.length < 2);

    if (room) {
        console.log(`🔍 Found an existing room: ${room.roomId} with ${room.players.length} players.`);
    } else {
        // If no available room, create a new one
        const newRoomId = generateRoomId();
        console.log(`🆕 No room available. Creating a new Room with ID: ${newRoomId} for bet amount: ${amount}`);

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

    // If room is already full, reject the join request
    if (room.players.length >= 2) {
        console.log(`🚫 Room ${room.roomId} is already full. ${playerName} cannot join.`);
        return socket.emit("roomFull", "Room is already full. Create a new room.");
    }

    // Assign player symbol based on their position
    const symbols = ["X", "O"];
    const playerNumber = room.players.length + 1;
    const playerSymbol = symbols[playerNumber - 1];

    console.log(`🎭 Assigning symbol "${playerSymbol}" to Player ${playerNumber}`);

    // Add player to room
    room.players.push({
        name: playerName,
        userId,
        socketId: socket.id,
        amount,
        playerNumber,
        symbol: playerSymbol,
        expoPushToken
    });

    // Join the socket room
    socket.join(room.roomId);
    console.log(`✅ ${playerName} successfully joined Room ${room.roomId} as Player ${playerNumber}`);

    // Notify others in the room
    socket.to(room.roomId).emit("playerJoined", `${playerName} joined`);
    io.to(room.roomId).emit("playersUpdate", room.players);

    console.log(`🔄 Updated Room ${room.roomId} Players List:`, room.players);

    // If the room has 2 players, start the game
    if (room.players.length === 2) {
        console.log(`🎮 Game in Room ${room.roomId} is now READY! Players:`, room.players);

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


function generateRoomId() {
  return Math.random().toString(36).substr(2, 9); // Generate a random alphanumeric string
}

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
