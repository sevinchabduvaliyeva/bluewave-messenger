const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    maxHttpBufferSize: 1e7
});

app.use(express.static(__dirname));

// Xonadagi foydalanuvchilar holatini saqlash
// roomUsers[roomId] = Set(socket.id)
const roomUsers = {};
// Oxirgi onlaynlik vaqti: lastSeenMap[roomId] = "16:45"
const lastSeenMap = {};

function getCurrentTime() {
    const now = new Date();
    return now.toTimeString().slice(0, 5);
}

io.on('connection', (socket) => {
    socket.on('call_offer', (data) => {
        socket.to(data.roomId).emit('call_offer', data);
    });

    socket.on('call_answer', (data) => {
        socket.to(data.roomId).emit('call_answer', data);
    });

    socket.on('ice_candidate', (data) => {
        socket.to(data.roomId).emit('ice_candidate', data);
    });

    socket.on('end_call', (roomId) => {
        socket.to(roomId).emit('end_call');
    });
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        socket.currentRoom = roomId;

        if (!roomUsers[roomId]) roomUsers[roomId] = new Set();
        roomUsers[roomId].add(socket.id);

        // Xonadagi boshqa odamga "onlayn" ekanini bildirish
        socket.to(roomId).emit('peer_status', { online: true });

        // Yangi kirgan odamga narigi odam hozir onlayn yoki oflayn ekanini aytish
        const othersCount = roomUsers[roomId].size - 1;
        socket.emit('peer_status', {
            online: othersCount > 0,
            lastSeen: lastSeenMap[roomId] || null
        });
    });

    // Xabar yuborish (avtomatik javobsiz, faqat narigi odamga uzatadi)
    socket.on('send_message', (data) => {
        socket.to(data.roomId).emit('receive_message', data.message);
    });

    // Narigi odam xabarni haqiqatdan ochib ko'rganda
    socket.on('message_read', (data) => {
        socket.to(data.roomId).emit('message_was_read', data.messageId);
    });

    // Faqat matn yozayotgan paytda
    socket.on('typing', (data) => {
        socket.to(data.roomId).emit('user_typing', data.isTyping);
    });

    socket.on('disconnect', () => {
        const roomId = socket.currentRoom;
        if (roomId && roomUsers[roomId]) {
            roomUsers[roomId].delete(socket.id);
            if (roomUsers[roomId].size <= 1) {
                const time = getCurrentTime();
                lastSeenMap[roomId] = time;
                socket.to(roomId).emit('peer_status', {
                    online: false,
                    lastSeen: time
                });
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ishga tushdi: http://localhost:${PORT}`);
});