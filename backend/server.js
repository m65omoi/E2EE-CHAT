const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve frontend files
app.use(express.static(path.join(__dirname, '../frontend')));

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // When a user joins a room (they all join 'dorm' by default)
    socket.on('join_room', (room) => {
        socket.join(room);
        console.log(`User ${socket.id} joined room: ${room}`);
    });

    // Relay encrypted messages to everyone in the room
    socket.on('send_message', (data) => {
        // data looks like: { room: 'dorm', encryptedPayload: '...', iv: '...', salt: '...', senderId: '...' }
        // The server DOES NOT have the passphrase, so it CANNOT decrypt this payload.
        socket.to(data.room).emit('receive_message', data);
    });

    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`E2EE Chat Server running on http://localhost:${PORT}`);
});
