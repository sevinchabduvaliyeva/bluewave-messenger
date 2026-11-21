const socket = io();

function normalizePhone(phone = '') {
    return String(phone).replace(/\D/g, '');
}

function formatUzPhoneInput(rawValue = '') {
    let digits = String(rawValue).replace(/\D/g, '');

    // Agar 998 bilan boshlanmasa, 998 ni oldiga qo'shamiz
    if (!digits.startsWith('998')) {
        digits = '998' + digits;
    }

    // +998 va 9 ta raqam = jami 12 raqam
    digits = digits.slice(0, 12);
    const local = digits.slice(3); // XX XXX XX XX qismi

    let formatted = '+998';
    if (local.length > 0) formatted += ' ' + local.slice(0, 2);
    if (local.length > 2) formatted += ' ' + local.slice(2, 5);
    if (local.length > 5) formatted += ' ' + local.slice(5, 7);
    if (local.length > 7) formatted += ' ' + local.slice(7, 9);

    return formatted;
}

const authPhoneInput = document.getElementById('auth-phone');

authPhoneInput?.addEventListener('focus', () => {
    if (!authPhoneInput.value.trim()) {
        authPhoneInput.value = '+998 ';
    }
});

authPhoneInput?.addEventListener('input', (e) => {
    const caretAtEnd = e.target.selectionStart === e.target.value.length;
    e.target.value = formatUzPhoneInput(e.target.value);
    if (caretAtEnd) {
        e.target.setSelectionRange(e.target.value.length, e.target.value.length);
    }
});

function getDirectRoomId(phoneA, phoneB) {
    const a = normalizePhone(phoneA);
    const b = normalizePhone(phoneB);
    if (!a || !b) return null;
    return 'dm_' + [a, b].sort().join('_');
}

// --- Foydalanuvchi akkaunti va kontaktlar ---
let currentUser = JSON.parse(localStorage.getItem('bluewave_current_user')) || null;
let contacts = JSON.parse(localStorage.getItem('bluewave_contacts')) || [];
let messagesByContact = JSON.parse(localStorage.getItem('bluewave_messages')) || {};
let activeContactId = null;
let CURRENT_ROOM = 'bluewave-room-1';
let typingTimeout = null;

// DOM elementlar
const authModal = document.getElementById('auth-modal');
const authForm = document.getElementById('auth-form');
const contactsListEl = document.getElementById('contacts-list');
const addContactBtn = document.getElementById('add-contact-btn');
const chatHeaderNameEl = document.getElementById('chat-header-name');
const chatHeaderPhoneEl = document.getElementById('chat-header-phone');
const chatHeaderStatusEl = document.getElementById('chat-header-status');
const messagesContainerEl = document.getElementById('messages-container');
const messageFormEl = document.getElementById('message-form');
const messageInputEl = document.getElementById('message-input');

// Qo'ng'iroq oynasi elementlari
const callModal = document.getElementById('call-modal');
const callTimerEl = document.getElementById('call-timer');
const callAvatarEl = document.getElementById('call-avatar');
const callContactNameEl = document.getElementById('call-contact-name');
const callContactPhoneEl = document.getElementById('call-contact-phone');

let callInterval = null;
let callSeconds = 0;

function saveState() {
    localStorage.setItem('bluewave_contacts', JSON.stringify(contacts));
    localStorage.setItem('bluewave_messages', JSON.stringify(messagesByContact));
}

function getCurrentTime() {
    const now = new Date();
    return now.toTimeString().slice(0, 5);
}

// --- 1. Akkaunt yaratish va kirish ---
function initAuthState() {
    if (!currentUser || !currentUser.phone) {
        authModal?.classList.remove('hidden');
        return;
    }
    authModal?.classList.add('hidden');
    socket.emit('register_user', currentUser);
}

authForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('auth-name');
    const phoneInput = document.getElementById('auth-phone');
    const name = nameInput?.value.trim();
    const phone = phoneInput?.value.trim();

    if (!name || !phone) return;

    currentUser = { name, phone };
    localStorage.setItem('bluewave_current_user', JSON.stringify(currentUser));
    authModal?.classList.add('hidden');
    socket.emit('register_user', currentUser);
});

socket.on('connect', () => {
    if (currentUser && currentUser.phone) {
        socket.emit('register_user', currentUser);
    }
    if (activeContactId) {
        const contact = contacts.find(c => c.id === activeContactId);
        if (contact) connectToContact(contact);
    }
});

// --- 2. Kontakt qo'shish va ro'yxatni chizish ---
function renderContacts() {
    if (!contactsListEl) return;
    contactsListEl.innerHTML = '';

    contacts.forEach(contact => {
        const item = document.createElement('div');
        item.className = `contact-item ${contact.id === activeContactId ? 'active' : ''}`;
        item.dataset.id = contact.id;

        const list = messagesByContact[contact.id] || [];
        const lastMsg = list[list.length - 1];
        const previewText = lastMsg ? lastMsg.text : contact.phone;

        item.innerHTML = `
            <div class="contact-info">
                <div class="contact-name">${escapeHtml(contact.name)}</div>
                <div class="contact-preview">${escapeHtml(previewText)}</div>
            </div>
        `;

        item.addEventListener('click', () => selectContact(contact.id));
        contactsListEl.appendChild(item);
    });
}

addContactBtn?.addEventListener('click', () => {
    const name = prompt("Kontakt ismini kiriting:")?.trim();
    if (!name) return;

    const phone = prompt("Kontakt telefon raqamini kiriting (masalan: +998 90 123 45 67):")?.trim();
    if (!phone) return;

    const cleanPhone = normalizePhone(phone);
    const existing = contacts.find(c => normalizePhone(c.phone) === cleanPhone);
    if (existing) {
        selectContact(existing.id);
        return;
    }

    const newContact = {
        id: 'c_' + Date.now(),
        name,
        phone
    };

    contacts.push(newContact);
    if (!messagesByContact[newContact.id]) {
        messagesByContact[newContact.id] = [];
    }
    saveState();
    renderContacts();
    selectContact(newContact.id);
});

function connectToContact(contact) {
    if (!contact) return;

    if (currentUser?.phone && contact?.phone) {
        const roomId = getDirectRoomId(currentUser.phone, contact.phone);
        CURRENT_ROOM = roomId;
        socket.emit('join_direct_chat', {
            myPhone: currentUser.phone,
            targetPhone: contact.phone
        });
    } else {
        socket.emit('join_room', CURRENT_ROOM);
    }
}

function selectContact(contactId) {
    activeContactId = contactId;
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    renderContacts();
    connectToContact(contact);

    if (chatHeaderNameEl) chatHeaderNameEl.textContent = contact.name;
    if (chatHeaderPhoneEl) chatHeaderPhoneEl.textContent = contact.phone;
    if (chatHeaderStatusEl) chatHeaderStatusEl.textContent = "ulanmoqda...";

    renderMessages();
    markUnreadMessagesAsRead(contact);
}

// --- 3. Xabarlar, o'qilganlik va reaksiyalar ---
const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

function escapeHtml(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderReactionsHtml(msg) {
    const reactions = msg.reactions || {};
    const entries = Object.entries(reactions).filter(([, count]) => count > 0);
    if (!entries.length) return '';

    return `
        <div class="message-reactions">
            ${entries.map(([emoji, count]) => `
                <span class="reaction-chip" data-emoji="${emoji}">${emoji} ${count}</span>
            `).join('')}
        </div>
    `;
}

function applyReactionToMessage(messageId, emoji) {
    if (!activeContactId) return;
    const list = messagesByContact[activeContactId] || [];
    const msg = list.find(m => m.id === messageId);
    if (!msg) return;

    if (!msg.reactions) msg.reactions = {};
    msg.reactions[emoji] = (msg.reactions[emoji] || 0) + 1;

    saveState();
    renderMessages();
}

function sendReaction(messageId, emoji) {
    if (!activeContactId) return;
    const contact = contacts.find(c => c.id === activeContactId);
    applyReactionToMessage(messageId, emoji);

    socket.emit('add_reaction', {
        roomId: CURRENT_ROOM,
        senderPhone: currentUser?.phone,
        targetPhone: contact?.phone,
        messageId,
        emoji
    });
}

socket.on('add_reaction', ({ messageId, emoji }) => {
    applyReactionToMessage(messageId, emoji);
});

function renderMessages() {
    if (!messagesContainerEl || !activeContactId) return;
    const list = messagesByContact[activeContactId] || [];
    messagesContainerEl.innerHTML = '';

    list.forEach(msg => {
        const div = document.createElement('div');
        div.className = `message-item ${msg.sender === 'me' ? 'outgoing' : 'incoming'}`;
        div.dataset.id = msg.id;

        const statusMark = msg.sender === 'me'
            ? `<span class="msg-status">${msg.read ? '✓✓' : '✓'}</span>`
            : '';

        const pickerButtons = REACTION_EMOJIS.map(emoji =>
            `<button type="button" class="reaction-picker-btn" data-msg-id="${msg.id}" data-emoji="${emoji}">${emoji}</button>`
        ).join('');

        div.innerHTML = `
            <div class="message-bubble">
                <div class="message-text">${escapeHtml(msg.text)}</div>
                <div class="message-meta">
                    <span class="message-time">${escapeHtml(msg.time)}</span>
                    ${statusMark}
                </div>
                ${renderReactionsHtml(msg)}
                <div class="reaction-picker">${pickerButtons}</div>
            </div>
        `;

        div.querySelectorAll('.reaction-picker-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                sendReaction(btn.dataset.msgId, btn.dataset.emoji);
            });
        });

        messagesContainerEl.appendChild(div);
    });

    messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
}

function markUnreadMessagesAsRead(contact) {
    if (!activeContactId || !contact) return;
    const list = messagesByContact[activeContactId] || [];
    let changed = false;

    list.forEach(msg => {
        if (msg.sender === 'them' && !msg.read) {
            msg.read = true;
            changed = true;
            socket.emit('message_read', {
                roomId: CURRENT_ROOM,
                senderPhone: currentUser?.phone,
                targetPhone: contact.phone,
                messageId: msg.id
            });
        }
    });

    if (changed) saveState();
}

messageFormEl?.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!activeContactId) return;
    const contact = contacts.find(c => c.id === activeContactId);
    if (!contact) return;

    const text = messageInputEl?.value.trim();
    if (!text) return;

    const newMessage = {
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        text,
        sender: 'me',
        time: getCurrentTime(),
        read: false,
        reactions: {}
    };

    if (!messagesByContact[activeContactId]) {
        messagesByContact[activeContactId] = [];
    }
    messagesByContact[activeContactId].push(newMessage);
    saveState();
    renderMessages();
    renderContacts();

    messageInputEl.value = '';
    socket.emit('typing', {
        roomId: CURRENT_ROOM,
        senderPhone: currentUser?.phone,
        targetPhone: contact.phone,
        isTyping: false
    });

    socket.emit('send_message', {
        roomId: CURRENT_ROOM,
        senderPhone: currentUser?.phone,
        targetPhone: contact.phone,
        message: {
            ...newMessage,
            sender: 'them'
        }
    });
});

socket.on('receive_message', (incomingMsg) => {
    if (!incomingMsg) return;

    let targetContact = contacts.find(c =>
        incomingMsg.senderPhone &&
        normalizePhone(c.phone) === normalizePhone(incomingMsg.senderPhone)
    );

    if (!targetContact && incomingMsg.senderPhone) {
        targetContact = {
            id: 'c_' + normalizePhone(incomingMsg.senderPhone),
            name: incomingMsg.senderName || incomingMsg.senderPhone,
            phone: incomingMsg.senderPhone
        };
        contacts.push(targetContact);
    }

    if (!targetContact && contacts.length > 0) {
        targetContact = contacts[0];
    }

    if (!targetContact) return;

    if (!messagesByContact[targetContact.id]) {
        messagesByContact[targetContact.id] = [];
    }

    messagesByContact[targetContact.id].push({
        ...incomingMsg,
        sender: 'them',
        read: activeContactId === targetContact.id
    });

    saveState();
    renderContacts();

    if (activeContactId === targetContact.id) {
        renderMessages();
        socket.emit('message_read', {
            roomId: CURRENT_ROOM,
            senderPhone: currentUser?.phone,
            targetPhone: targetContact.phone,
            messageId: incomingMsg.id
        });
    }
});

socket.on('message_was_read', (messageId) => {
    if (!activeContactId) return;
    const list = messagesByContact[activeContactId] || [];
    const msg = list.find(m => m.id === messageId);
    if (msg) {
        msg.read = true;
        saveState();
        renderMessages();
    }
});

messageInputEl?.addEventListener('input', () => {
    if (!activeContactId) return;
    const contact = contacts.find(c => c.id === activeContactId);
    if (!contact) return;

    socket.emit('typing', {
        roomId: CURRENT_ROOM,
        senderPhone: currentUser?.phone,
        targetPhone: contact.phone,
        isTyping: true
    });

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', {
            roomId: CURRENT_ROOM,
            senderPhone: currentUser?.phone,
            targetPhone: contact.phone,
            isTyping: false
        });
    }, 1000);
});

socket.on('user_typing', (isTyping) => {
    if (!chatHeaderStatusEl) return;
    if (isTyping) {
        chatHeaderStatusEl.textContent = "yozmoqda...";
    } else if (activeContactId) {
        const contact = contacts.find(c => c.id === activeContactId);
        if (contact) chatHeaderStatusEl.textContent = "onlayn";
    }
});

socket.on('peer_status', ({ online, lastSeen }) => {
    if (!chatHeaderStatusEl) return;
    if (online) {
        chatHeaderStatusEl.textContent = "onlayn";
    } else if (lastSeen) {
        chatHeaderStatusEl.textContent = `oxirgi marta ${lastSeen} da onlayn edi`;
    } else {
        chatHeaderStatusEl.textContent = "oflayn";
    }
});

// --- 4. WebRTC Audio / Video qo'ng'iroqlar ---
let peerConnection = null;
let localStream = null;

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

function startCallTimer() {
    clearInterval(callInterval);
    callSeconds = 0;
    callInterval = setInterval(() => {
        callSeconds++;
        const mins = String(Math.floor(callSeconds / 60)).padStart(2, '0');
        const secs = String(callSeconds % 60).padStart(2, '0');
        if (callTimerEl) callTimerEl.textContent = `${mins}:${secs}`;
    }, 1000);
}

async function setupPeerConnection(isVideo) {
    localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: isVideo
    });

    peerConnection = new RTCPeerConnection(rtcConfig);

    localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
    });

    const remoteAudio = document.getElementById('remote-audio') || (() => {
        const el = document.createElement('audio');
        el.id = 'remote-audio';
        el.autoplay = true;
        document.body.appendChild(el);
        return el;
    })();

    peerConnection.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0];
    };

    peerConnection.onicecandidate = (event) => {
        const contact = contacts.find(c => c.id === activeContactId);
        if (event.candidate) {
            socket.emit('ice_candidate', {
                roomId: CURRENT_ROOM,
                senderPhone: currentUser?.phone,
                targetPhone: contact?.phone,
                candidate: event.candidate
            });
        }
    };
}

async function startCall(isVideo = false) {
    if (!activeContactId) return;
    const contact = contacts.find(c => c.id === activeContactId);
    if (!contact) return;

    connectToContact(contact);

    if (callAvatarEl) callAvatarEl.textContent = contact.name.charAt(0).toUpperCase();
    if (callContactNameEl) callContactNameEl.textContent = contact.name;
    if (callContactPhoneEl) callContactPhoneEl.textContent = contact.phone;
    if (callTimerEl) callTimerEl.textContent = isVideo ? "Video qo'ng'iroq qilinmoqda..." : "Qo'ng'iroq qilinmoqda...";
    callModal?.classList.remove('hidden');

    try {
        await setupPeerConnection(isVideo);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('call_offer', {
            roomId: CURRENT_ROOM,
            senderPhone: currentUser?.phone,
            targetPhone: contact.phone,
            offer,
            isVideo
        });
    } catch (err) {
        alert("Mikrofon yoki kameraga ruxsat berilmadi yoki ulanishda xatolik bo'ldi.");
        endCallCleanup(false);
    }
}

socket.on('call_offer', async ({ offer, isVideo, roomId, senderPhone }) => {
    if (roomId) CURRENT_ROOM = roomId;

    const accept = confirm(
        isVideo
            ? `${senderPhone || 'Foydalanuvchi'} dan kiruvchi video qo'ng'iroq. Qabul qilasizmi?`
            : `${senderPhone || 'Foydalanuvchi'} dan kiruvchi audio qo'ng'iroq. Qabul qilasizmi?`
    );

    if (!accept) {
        socket.emit('end_call', {
            roomId: CURRENT_ROOM,
            senderPhone: currentUser?.phone,
            targetPhone: senderPhone
        });
        return;
    }

    callModal?.classList.remove('hidden');
    if (callTimerEl) callTimerEl.textContent = "Ulandi...";

    try {
        await setupPeerConnection(isVideo);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        startCallTimer();
        socket.emit('call_answer', {
            roomId: CURRENT_ROOM,
            senderPhone: currentUser?.phone,
            targetPhone: senderPhone,
            answer
        });
    } catch (err) {
        alert("Qo'ng'iroqni qabul qilishda xatolik!");
        endCallCleanup(false);
    }
});

socket.on('call_answer', async ({ answer }) => {
    if (peerConnection && answer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        startCallTimer();
    }
});

socket.on('ice_candidate', async ({ candidate }) => {
    if (peerConnection && candidate) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
            console.error("ICE candidate xatosi:", err);
        }
    }
});

function endCallCleanup(notifyPeer = true) {
    clearInterval(callInterval);
    if (notifyPeer) {
        const contact = contacts.find(c => c.id === activeContactId);
        socket.emit('end_call', {
            roomId: CURRENT_ROOM,
            senderPhone: currentUser?.phone,
            targetPhone: contact?.phone
        });
    }
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }
    callModal?.classList.add('hidden');
}

socket.on('end_call', () => endCallCleanup(false));

document.getElementById('audio-call-btn')?.addEventListener('click', () => startCall(false));
document.getElementById('video-call-btn')?.addEventListener('click', () => startCall(true));
document.getElementById('end-call-btn')?.addEventListener('click', () => endCallCleanup(true));

// --- Boshlang'ich ishga tushirish ---
initAuthState();
renderContacts();
if (contacts.length > 0) {
    selectContact(contacts[0].id);
}