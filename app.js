const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

app.use(cors({
  origin: 'http://localhost:5173',
  methods: ['GET', 'POST'],
  credentials: true,
}));

app.get('/', (req, res) => {
  res.send("hello world");
});

let waitingQueue = [];
let rooms = {}; // Object to store all rooms and their associated users

io.on("connection", (socket) => {
  console.log("A user connected:", socket.id);

  socket.on("username", (username) => {
    socket.username = username;

    if (waitingQueue.length > 0) {
      // Pair the user with the first one in the queue
      const pairedUser = waitingQueue.shift();
      const room = `room-${socket.id}-${pairedUser.socketId}`;
      socket.join(room);
      
      pairedUser.socket.join(room);

      // Store the room details
      rooms[room] = {
        user1: { socketId: socket.id, username, socket },
        user2: { socketId: pairedUser.socketId, username: pairedUser.username, socket: pairedUser.socket },
      };

      // Notify both users about the connection
      io.to(room).emit("roomConnected", { room, users: [username, pairedUser.username] });
      console.log(`Room created: ${room} with users ${username} and ${pairedUser.username}`);
    } else {
      // Add the user to the waiting queue
      waitingQueue.push({ socketId: socket.id, socket, username });
      socket.emit("noUserOnline", true);
      console.log(`User ${username} added to the waiting queue.`);
    }
  });

  

  // Handle the skip feature
  socket.on("skip", () => {
    console.log(`${socket.username} requested to skip.`);

    // Find the room where this user is
    for (const room in rooms) {
      const { user1, user2 } = rooms[room];
      if (user1.socketId === socket.id || user2.socketId === socket.id) {
        const remainingUser = user1.socketId === socket.id ? user2 : user1;

        // Notify the remaining user and clear the chat
        io.to(remainingUser.socketId).emit("opponentDisconnected");
        delete rooms[room];
        console.log(`Room ${room} cleared after skip.`);

        // Attempt to connect the remaining user with another waiting user
        if (waitingQueue.length > 0) {
          const nextUser = waitingQueue.shift();
          const newRoom = `room-${remainingUser.socketId}-${nextUser.socketId}`;
          remainingUser.socket = io.sockets.sockets.get(remainingUser.socketId);
          remainingUser.socket.join(newRoom);
          nextUser.socket.join(newRoom);

          // Store the new room details
          rooms[newRoom] = {
            user1: remainingUser,
            user2: { socketId: nextUser.socketId, username: nextUser.username, socket: nextUser.socket },
          };

          io.to(newRoom).emit("roomConnected", {
            room: newRoom,
            users: [remainingUser.username, nextUser.username],
          });
          console.log(`New room created: ${newRoom} with users ${remainingUser.username} and ${nextUser.username}`);
        } else {
          // If no user is in the queue, place the remaining user back in the queue
          waitingQueue.push(remainingUser);
          io.to(remainingUser.socketId).emit("noUserOnline", true);
        }

        // Attempt to connect the skipping user to another waiting user
        if (waitingQueue.length > 0) {
          const nextUser = waitingQueue.shift();
          const newRoom = `room-${socket.id}-${nextUser.socketId}`;
          socket.join(newRoom);
          nextUser.socket.join(newRoom);

          // Store the new room details
          rooms[newRoom] = {
            user1: { socketId: socket.id, username: socket.username, socket },
            user2: { socketId: nextUser.socketId, username: nextUser.username, socket: nextUser.socket },
          };

          io.to(newRoom).emit("roomConnected", {
            room: newRoom,
            users: [socket.username, nextUser.username],
          });
          console.log(`New room created: ${newRoom} with users ${socket.username} and ${nextUser.username}`);
        } else {
          // If no user is in the queue, place the skipping user back in the queue
          waitingQueue.push({ socketId: socket.id, username: socket.username, socket });
          socket.emit("noUserOnline", true);
        }
        return;
      }
    }
  });

  // Handle message sending
  socket.on("sendMessage", (data) => {
    const { room, message } = data;
    console.log(`Message in ${room} from ${socket.username}: ${message}`);
    io.to(room).emit("receiveMessage", { sender: socket.id, username: socket.username, message });
  });

  // Handle user disconnect
  socket.on("disconnect", () => {
    console.log("A user disconnected:", socket.id);

    // Remove the user from the room
    for (const room in rooms) {
      const { user1, user2 } = rooms[room];
      if (user1.socketId === socket.id || user2.socketId === socket.id) {
        const remainingUser = user1.socketId === socket.id ? user2 : user1;

        // Notify the remaining user
        io.to(remainingUser.socketId).emit("opponentDisconnected");
        delete rooms[room];

        // Reconnect the remaining user to another waiting user
        if (waitingQueue.length > 0) {
          const nextUser = waitingQueue.shift();
          const newRoom = `room-${remainingUser.socketId}-${nextUser.socketId}`;
          remainingUser.socket = io.sockets.sockets.get(remainingUser.socketId);
          remainingUser.socket.join(newRoom);
          nextUser.socket.join(newRoom);

          rooms[newRoom] = {
            user1: remainingUser,
            user2: { socketId: nextUser.socketId, username: nextUser.username, socket: nextUser.socket },
          };

          io.to(newRoom).emit("roomConnected", {
            room: newRoom,
            users: [remainingUser.username, nextUser.username],
          });
          console.log(`New room created: ${newRoom} with users ${remainingUser.username} and ${nextUser.username}`);
        } else {
          waitingQueue.push(remainingUser);
          io.to(remainingUser.socketId).emit("noUserOnline", true);
        }
        break;
      }
    }

    // Remove the disconnected user from the queue if they were waiting
    waitingQueue = waitingQueue.filter((user) => user.socketId !== socket.id);
  });
});

server.listen(3000, () => {
  console.log('Server is running on port 3000');
});
