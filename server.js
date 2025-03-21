    



      const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const socketIO = require('socket.io');
const OdinCircledbModel = require('./models/odincircledb');
const BetModel = require('./models/BetModel');
const WinnerModel = require('./models/WinnerModel');
const LoserModel = require('./models/LoserModel');
const mongoose = require('mongoose');

require("dotenv").config();

const app = express();
app.use(cors()); // Allow connections from your React Native app

const server = http.createServer(app);

const mongoUsername = process.env.MONGO_USERNAME;
const mongoPassword = process.env.MONGO_PASSWORD;
const mongoDatabase = process.env.MONGO_DATABASE;
const mongoCluster = process.env.MONGO_CLUSTER;

const uri = `mongodb+srv://${mongoUsername}:${mongoPassword}@${mongoCluster}.kbgr5.mongodb.net/${mongoDatabase}?retryWrites=true&w=majority`;


// MongoDB Connection
mongoose.connect(uri, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
}).then(() => console.log("MongoDB connected"))
    .catch(err => console.error("MongoDB connection error:", err));

    const TictacSocketIo = (server) => {
  const io = new Server(server, {
    cors: {
      origin: "*", // Replace with your frontend's URL if needed
      methods: ["GET", "POST"],
    },
  });
  
  const activeRooms = {};

  io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);
    
      socket.on('joinRoom', async ({ playerName, roomId, userId, totalBet, expoPushToken }) => {
      // Validate input
      if (!playerName || !userId || !roomId || !totalBet) {
        return socket.emit('invalidJoin', 'Player name, userId, roomId, and bet amount are required');
      }
  
      // Check if the room exists
      let room = activeRooms[roomId];
  
      if (!room) {
        // Create a new room with the bet amount if it doesn't exist
        room = {
          roomId,
          players: [],
          board: Array(9).fill(null),
          currentPlayer: 0,
          startingPlayer: 0, // Track who starts
          totalBet, // Set bet for this room
        };
        activeRooms[roomId] = room;
      }
  
      // Enforce bet consistency - ensure all players in the room have the same bet amount
      if (room.players.length > 0 && room.totalBet !== totalBet) {
        return socket.emit('invalidBet', 'Bet amount must match the room');
      }
  
      // Prevent more than 3 players from joining the same room
      if (room.players.length >= 3) {
        return socket.emit('roomFull', 'This room already has three players');
      }
  
      // Determine player number and symbol (X, O, or A for 3 players)
      const symbols = ['X', 'O', 'A']; 
      const playerNumber = room.players.length + 1;
      const playerSymbol = symbols[playerNumber - 1];
  
      // Add the player to the room
      room.players.push({
        name: playerName,
        userId,
        socketId: socket.id,
        totalBet,
        playerNumber,
        symbol: playerSymbol,
        expoPushToken,
      });
  
      // Join the socket.io room
      socket.join(roomId);
  
      // Notify other players in the room about the new player
      socket.to(roomId).emit('playerJoined', `${playerName} joined the room`);
  
      // Send individual player information to the player who joined
      socket.emit('playerInfo', {
        playerNumber: playerNumber,
        symbol: playerSymbol,
        playerName: playerName,
        roomId: room.roomId,
        userId: userId
      });
  
      // Emit the updated player list to everyone in the room
      io.to(roomId).emit('playersUpdate', room.players);
  
      // Check if the room has at least 2 players to start the game
      if (room.players.length === 2 || room.players.length === 3) {
        io.to(roomId).emit('gameReady', {
          players: room.players.map(p => ({ name: p.name, symbol: p.symbol })),
          roomId,
        });
  
        room.currentPlayer = room.startingPlayer;
  
        // Notify players about whose turn it is
        io.to(roomId).emit('turnChange', room.currentPlayer);
        
        // Send push notification to all players in the room
        for (const player of room.players) {
          const recipient = await OdinCircledbModel.findById(player.userId); 
  
          if (recipient && recipient.expoPushToken) {
            await sendPushNotification(
              recipient.expoPushToken,
              'Game Ready!',
              'The game is ready to start!',
              { roomId }
            );
          }
        }
      }
  });
 


// // Function to send notifications to registered devices
      async function sendNotificationsToDevices(title, message) {
  try {
    // Fetch all devices from the database
    const devices = await Device.find({});
    console.log('Fetched devices:', devices);

    // Extract the expoPushToken from each device
    const tokens = devices.map((device) => device.expoPushToken);
    console.log('Extracted tokens:', tokens);

    if (tokens.length === 0) {
      console.warn('No devices registered for notifications');
      return;
    }

    // Filter out invalid tokens and prepare messages
    const messages = tokens
      .filter((token) => Expo.isExpoPushToken(token)) // Ensure token is valid
      .map((token) => ({
        to: token,
        sound: 'default',
        title,
        body: message,
      }));

    console.log('Prepared messages:', messages);

    if (messages.length === 0) {
      console.warn('No valid Expo push tokens found');
      return;
    }

    // Chunk messages into batches to send with Expo
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];

    // Send notifications in chunks
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
        console.log('Sent notification chunk:', ticketChunk);
      } catch (error) {
        console.error('Error sending notification chunk:', error);
      }
    }

    // Log tickets for debugging
    console.log('Notification tickets:', tickets);
  } catch (error) {
    console.error('Error sending notifications:', error.message);
    console.error('Error stack:', error.stack);
  }
}

      async function sendPushNotification(expoPushToken, title, body, data = {}) {
  try {
    // Validate if the token is a valid Expo push token
    if (!Expo.isExpoPushToken(expoPushToken)) {
      console.error(
        `Push token ${expoPushToken} is not a valid Expo push token`
      );
      return;
    }

    // Create the notification payload
    const message = {
      to: expoPushToken,
      sound: 'default',
      title,
      body,
      data,
      icon: 'https://as1.ftcdn.net/v2/jpg/03/06/02/06/1000_F_306020649_Kx1nsIMTl9FKwF0jyYruImTY5zV6mnzw.jpg', // Include the icon if required
    };

    console.log('Sending notification with message:', message);

    // Split messages into chunks for sending
    const chunks = expo.chunkPushNotifications([message]);
    const tickets = [];

    // Send the notification in chunks
    for (let chunk of chunks) {
      try {
        let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending push notification chunk:', error);
      }
    }

    console.log('Push notification tickets:', tickets);
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}

function generateUniqueRoomName() {
  return Math.random().toString(36).substr(2, 9); // Generate a random alphanumeric string
}



const startTurnTimer = (roomId) => {
  const room = activeRooms[roomId];

  if (!room) return;

  if (room.turnTimeout) {
    clearTimeout(room.turnTimeout); // Clear any existing timeout
  }

  // Set a new timeout
  room.turnTimeout = setTimeout(() => {
    console.log(`Player took too long. Auto-switching turn for room ${roomId}`);

    room.currentPlayer = (room.currentPlayer + 1) % room.players.length; // Switch turn for 3 players
    io.to(roomId).emit('turnChange', room.currentPlayer);

    // Restart the timer for the next player
    startTurnTimer(roomId);
  }, 3000);
};


// Listen for incoming chat messages from clients


   // Add this inside the io.on('connection', ...) block
   socket.on('chatText', ({ roomId, playerName, text }) => {
    // Log the data being received
    console.log(`Received chat message from ${playerName} in room ${roomId}: ${text}`);

    // Broadcast the chat text to all clients in the room
    io.to(roomId).emit('receiveText', { playerName, text });
  });
      

socket.on('makeMove', async ({ roomId, index, playerName, symbol }) => {
  const room = activeRooms[roomId];

  if (!room || !Array.isArray(room.players) || room.players.length < 2) {
    return socket.emit('invalidMove', 'Invalid game state or not enough players');
  }

  if (!room.board || room.board.length !== 16) {
    console.error('Invalid game board state:', room.board);
    return socket.emit('invalidMove', 'Invalid board state');
  }

  // Ensure currentPlayer is correctly initialized
  if (typeof room.currentPlayer !== 'number') {
    room.currentPlayer = 0;
  }

  const currentPlayer = room.players[room.currentPlayer];

  if (socket.id !== currentPlayer.socketId) {
    return socket.emit('invalidMove', "It's not your turn");
  }

  if (room.board[index] !== null) {
    return socket.emit('invalidMove', 'Cell already occupied');
  }

  // Make the move
  room.board[index] = currentPlayer.symbol;

  // Emit move event
  io.to(roomId).emit('moveMade', { index, symbol: currentPlayer.symbol, playerName: currentPlayer.name });

  // Check for a winner
  const winnerSymbol = checkWin(room.board);
  if (winnerSymbol) {
    clearTimeout(room.turnTimeout); // Stop turn timer if someone wins

    const winnerPlayer = room.players.find(player => player.symbol === winnerSymbol);
    if (winnerPlayer) {
      io.to(roomId).emit('gameOver', {
        winnerSymbol,
        result: `${winnerPlayer.name} (${winnerSymbol}) wins!`
      });

      return;
    }
  }

  // Check for a draw (all cells filled)
  if (room.board.every(cell => cell !== null)) {
    clearTimeout(room.turnTimeout);
    io.to(roomId).emit('gameDraw', { result: "It's a draw!" });

    return;
  }

  // Switch turn for the next player
  room.currentPlayer = (room.currentPlayer + 1) % room.players.length;
  io.to(roomId).emit('turnChange', room.currentPlayer);

  // Restart the turn timer
  startTurnTimer(roomId);
});




// Handle socket disconnection
socket.on('disconnect', async () => {
  console.log('A user disconnected:', socket.id);

  for (const roomId in rooms) {
    const room = rooms[roomId];
    const playerIndex = room.players.findIndex(player => player.id === socket.id);

    if (playerIndex !== -1) {
      const disconnectedPlayer = room.players[playerIndex];
      console.log(`Player ${disconnectedPlayer.name} (ID: ${socket.id}) disconnected from room ${roomId}`);

      room.players.splice(playerIndex, 1); // Remove the player from the room
      io.to(roomId).emit('message', `${disconnectedPlayer.name} has left the game`);

      console.log(`Remaining players in room ${roomId}:`, room.players);

      if (room.players.length === 0) {
        delete rooms[roomId]; // Delete room if empty
        console.log(`Room ${roomId} deleted from memory.`);
      } else {
        // Determine the winner
        const winnerData = determineOverallWinner(roomId);

        let overallWinnerMessage = "Game ended with no winner.";
        if (winnerData && winnerData.winnerId) {
          const remainingPlayer = room.players[0];
          overallWinnerMessage = `${remainingPlayer.name} wins by default!`;
        }

        console.log(`Overall winner message: ${overallWinnerMessage}`);

        if (
          typeof overallWinnerMessage === "string" &&
          !overallWinnerMessage.includes("tie") &&
          !overallWinnerMessage.includes("winner")
        ) {
          // Emit game over event
          io.to(roomId).emit("gameOver", {
            roomId,
            scores: room.scores,
            overallWinner: overallWinnerMessage,
          });

          // Update database for winner
          try {
            const winnerUser = await OdinCircledbModel.findById(room.players[0].userId);
            if (winnerUser) {
              winnerUser.wallet.cashoutbalance += room.totalBet || 0;
              await winnerUser.save();
              console.log(`${winnerUser.name}'s balance updated.`);

              const newWinner = new WinnerModel({
                roomId: roomId,
                winnerName: winnerUser._id,
                totalBet: room.totalBet || 0,
              });
              await newWinner.save();
            }
          } catch (error) {
            console.error("Error updating winner balance:", error.message);
          }

          // Delete room
          delete rooms[roomId];
          console.log(`Room ${roomId} deleted after awarding the winner.`);
        } else {
          io.to(roomId).emit("opponentLeft", `${disconnectedPlayer.name} has left. Waiting for a new player...`);
          room.choices = {};
        }
      }
      break;
    }
  }
});

      
// Handle socket disconnection
// Handle socket disconnection
socket.on('disconnect', () => {
  console.log('A user disconnected:', socket.id);

  // Iterate through the rooms to find the disconnected player's room
  for (const roomId in rooms) {
    const room = rooms[roomId];
    const playerIndex = room.players.findIndex(player => player.id === socket.id);

    if (playerIndex !== -1) {
      const disconnectedPlayer = room.players[playerIndex];
      room.players.splice(playerIndex, 1); // Remove the player from the room

      io.to(roomId).emit('message', `${disconnectedPlayer.name} has left the game`);

      if (room.players.length === 0) {
        // Delete the room if no players are left
        delete rooms[roomId];
        console.log(`Room ${roomId} deleted from memory.`);
      } else {
        io.to(roomId).emit('opponentLeft', `${disconnectedPlayer.name} has left the game. Waiting for a new player...`);
        room.choices = {}; // Reset choices if a player leaves mid-game
      }
      break;
    }
  }
});

function checkWin(board) {
  // Validate board
  if (!Array.isArray(board) || board.length !== 16) {
      console.error('Invalid game board:', board);
      return null;
  }

  // Define winning patterns for 3-in-a-row on a 4x4 board
  const winPatterns = [
      // Horizontal wins
      [0, 1, 2], [1, 2, 3],
      [4, 5, 6], [5, 6, 7],
      [8, 9, 10], [9, 10, 11],
      [12, 13, 14], [13, 14, 15],

      // Vertical wins
      [0, 4, 8], [4, 8, 12],
      [1, 5, 9], [5, 9, 13],
      [2, 6, 10], [6, 10, 14],
      [3, 7, 11], [7, 11, 15],

      // Diagonal wins
      [0, 5, 10], [1, 6, 11], 
      [4, 9, 14], [5, 10, 15], 
      [3, 6, 9], [2, 5, 8], 
      [7, 10, 13], [6, 9, 12]
  ];

  // Check all winning patterns
  for (const pattern of winPatterns) {
      const [a, b, c] = pattern;
      if (board[a] && board[a] === board[b] && board[b] === board[c]) {
          return board[a]; // Return the winning symbol (X, O, or A)
      }
  }

  // Check for a draw (all cells are filled)
  if (board.every(cell => cell !== null)) {
      return 'draw'; // Return "draw" if the board is full and no winner
  }

  return null; // No winner yet
}






function generateUniqueRoomName() {
  return Math.random().toString(36).substr(2, 9); // Generate a random alphanumeric string
}


  return io;
};

// Initialize Socket.IO with the server
const io = TictacSocketIo(server);

server.listen(5005, () => {
  console.log("🚀 Socket.io server running on port ");
});
