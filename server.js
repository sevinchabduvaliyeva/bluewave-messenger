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
// Ro'yxatdan o'tgan foydalanuvchilar: normalizedPhone -> { name, phone, socketId }
const registeredUsers = new Map();

function getCurrentTime() {
    const now = new Date();
    return now.toTimeString().slice(0, 5);
}

function normalizePhone(phone = '') {
    return String(phone).replace(/\D/g, '');
}

function getDirectRoom(phoneA, phoneB) {
    const a = normalizePhone(phoneA);
    const b = normalizePhone(phoneB);
    if (!a || !b) return null;
    return 'dm_' + [a, b].sort().join('_');
}

function removeSocketFromRoom(socket, roomId) {
    if (!roomId || !roomUsers[roomId]) return;
    roomUsers[roomId].delete(socket.id);
    if (roomUsers[roomId].size <= 1) {
        const time = getCurrentTime();
        lastSeenMap[roomId] = time;
        socket.to(roomId).emit('peer_status', {
            online: false,
            lastSeen: time
        });
    }
    if (roomUsers[roomId].size === 0) {
        delete roomUsers[roomId];
    }
}

function enterRoom(socket, roomId) {
    if (!roomId) return;

    if (socket.currentRoom && socket.currentRoom !== roomId) {
        const prevRoom = socket.currentRoom;
        socket.leave(prevRoom);
        removeSocketFromRoom(socket, prevRoom);
    }

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
}

function resolveRoom(socket, data = {}) {
    if (typeof data === 'string') return data;
    return (
        data.roomId ||
        getDirectRoom(data.senderPhone || socket.userPhone, data.targetPhone) ||
        socket.currentRoom ||
        null
    );
}

io.on('connection', (socket) => {
    // Foydalanuvchini ism va telefon raqami bilan ro'yxatdan o'tkazish
    socket.on('register_user', ({ name, phone } = {}) => {
        const cleanPhone = normalizePhone(phone);
        if (!cleanPhone) return;

        socket.userPhone = cleanPhone;
        socket.userName = (name || '').trim() || cleanPhone;
        socket.join(`user_${cleanPhone}`);

        registeredUsers.set(cleanPhone, {
            name: socket.userName,
            phone: String(phone).trim(),
            socketId: socket.id
        });

        socket.emit('registered_success', {
            name: socket.userName,
            phone: String(phone).trim()
        });
    });

    // Ikki telefon raqam o'rtasidagi shaxsiy xonaga ulanish
    socket.on('join_direct_chat', ({ myPhone, targetPhone } = {}) => {
        const roomId = getDirectRoom(myPhone || socket.userPhone, targetPhone);
        if (!roomId) return;
        enterRoom(socket, roomId);
        socket.emit('direct_room_joined', {
            roomId,
            targetPhone: normalizePhone(targetPhone)
        });
    });

    // Xonaga kirish
    socket.on('join_room', (roomId) => {
        enterRoom(socket, roomId);
    });

    // Reaksiya signali
    socket.on('add_reaction', (data = {}) => {
        const roomId = resolveRoom(socket, data);
        if (!roomId) return;
        socket.to(roomId).emit('add_reaction', data);
    });

    // WebRTC qo'ng'iroq signallari
    socket.on('call_offer', (data = {}) => {
        const roomId = resolveRoom(socket, data);
        if (!roomId) return;
        socket.to(roomId).emit('call_offer', { ...data, roomId });
    });

    socket.on('call_answer', (data = {}) => {
        const roomId = resolveRoom(socket, data);
        if (!roomId) return;
        socket.to(roomId).emit('call_answer', data);
    });

    socket.on('ice_candidate', (data = {}) => {
        const roomId = resolveRoom(socket, data);
        if (!roomId) return;
        socket.to(roomId).emit('ice_candidate', data);
    });

    socket.on('end_call', (payload) => {
        const roomId = resolveRoom(socket, payload);
        if (!roomId) return;
        socket.to(roomId).emit('end_call');
    });

    // Xabar yuborish (avtomatik javobsiz, faqat narigi odamga uzatadi)
    socket.on('send_message', (data = {}) => {
        const roomId = resolveRoom(socket, data);
        if (!roomId) return;
        socket.to(roomId).emit('receive_message', data.message);
    });

    // Narigi odam xabarni haqiqatdan ochib ko'rganda
    socket.on('message_read', (data = {}) => {
        const roomId = resolveRoom(socket, data);
        if (!roomId) return;
        socket.to(roomId).emit('message_was_read', data.messageId);
    });

    // Faqat matn yozayotgan paytda
    socket.on('typing', (data = {}) => {
        const roomId = resolveRoom(socket, data);
        if (!roomId) return;
        socket.to(roomId).emit('user_typing', data.isTyping);
    });

    socket.on('disconnect', () => {
        if (socket.userPhone && registeredUsers.has(socket.userPhone)) {
            const current = registeredUsers.get(socket.userPhone);
            if (current.socketId === socket.id) {
                registeredUsers.delete(socket.userPhone);
            }
        }

        if (socket.currentRoom) {
            removeSocketFromRoom(socket, socket.currentRoom);
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server ishga tushdi: http://localhost:${PORT}`);
});