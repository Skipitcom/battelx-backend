require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow all for now, lock down later
        methods: ["GET", "POST"]
    }
});

// --- In-Memory State ---
let waitingUsers = []; // Queue of socket IDs
const activeRooms = new Map(); // roomId -> { user1, user2 }

// --- Socket Logic ---
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // 1. Find Match
    socket.on('find-match', () => {
        // If someone is waiting
        if (waitingUsers.length > 0) {
            const partnerId = waitingUsers.shift();

            // Check if partner is still connected
            if (partnerId === socket.id) {
                waitingUsers.push(socket.id); // Put back if it's self (shouldn't happen)
                return;
            }

            const roomId = `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Join both to room
            socket.join(roomId);
            const partnerSocket = io.sockets.sockets.get(partnerId);
            if (partnerSocket) {
                partnerSocket.join(roomId);

                // Store room info
                activeRooms.set(roomId, { user1: socket.id, user2: partnerId });

                // Notify both
                io.to(roomId).emit('match-found', { roomId, initiator: socket.id }); // Initiator sends offer
            } else {
                // Partner disconnected while waiting, user goes to queue
                waitingUsers.push(socket.id);
            }
        } else {
            // No one waiting, join queue
            waitingUsers.push(socket.id);
            console.log('User joined queue:', socket.id);
        }
    });

    // 2. WebRTC Signaling (Relay)
    socket.on('offer', (data) => {
        socket.to(data.roomId).emit('offer', data);
    });

    socket.on('answer', (data) => {
        socket.to(data.roomId).emit('answer', data);
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.roomId).emit('ice-candidate', data);
    });

    // 3. User Disconnects
    socket.on('disconnect', () => {
        // Remove from queue if there
        waitingUsers = waitingUsers.filter(id => id !== socket.id);
        console.log('User disconnected:', socket.id);
        // (Optional: Notify partner in room if active)
    });
});

const PORT = 4000;
server.listen(PORT, () => {
    console.log(`BattleX Backend running on port ${PORT}`);
});
