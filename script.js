const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

let myProfile = JSON.parse(localStorage.getItem('bluewave_profile')) || {
    name: "Mening Profilim",
    phone: "+998 90 000 00 00",
    bio: "BlueWave foydalanuvchisi",
    avatar: ""
};

let contacts = JSON.parse(localStorage.getItem('bluewave_contacts')) || [];

let activeContactId = null;
let mediaRecorder = null;
let audioChunks = [];
let callInterval = null;

// Vaqtincha avatar rasmlari
let tempContactAvatar = "";
let tempMyAvatar = "";

// DOM elementlar
const contactsListEl = document.getElementById('contacts-list');
const searchInput = document.getElementById('search-input');
const emptyChatEl = document.getElementById('empty-chat');
const activeChatEl = document.getElementById('active-chat');
const messagesContainer = document.getElementById('messages-container');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const recordBtn = document.getElementById('record-btn');
const fileInput = document.getElementById('file-input');
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');

// Socket ulanishi va holat o'zgaruvchilari
const socket = io();
let CURRENT_ROOM = "bluewave-room-1";
socket.emit('join_room', CURRENT_ROOM);

let isPeerOnline = false;
let peerLastSeen = null;
let typingTimeout = null;

function normalizePhone(phone = '') {
    return String(phone).replace(/\D/g, '');
}

function getDirectRoomId(phoneA, phoneB) {
    const a = normalizePhone(phoneA);
    const b = normalizePhone(phoneB);
    if (!a || !b) return null;
    return 'dm_' + [a, b].sort().join('_');
}

// +998 xx xxx xx xx formatlash
function attachPhoneMask(inputEl) {
    if (!inputEl) return;

    inputEl.addEventListener('focus', () => {
        if (!inputEl.value.trim()) {
            inputEl.value = '+998 ';
        }
    });

    inputEl.addEventListener('input', (e) => {
        let digits = e.target.value.replace(/\D/g, '');
        if (!digits.startsWith('998')) {
            digits = '998' + digits.replace(/^998/, '');
        }
        digits = digits.substring(0, 12);

        let formatted = '+998';
        if (digits.length > 3) formatted += ' ' + digits.substring(3, 5);
        if (digits.length > 5) formatted += ' ' + digits.substring(5, 8);
        if (digits.length > 8) formatted += ' ' + digits.substring(8, 10);
        if (digits.length > 10) formatted += ' ' + digits.substring(10, 12);

        e.target.value = formatted;
    });

    inputEl.addEventListener('keydown', (e) => {
        if (e.target.selectionStart <= 5 && (e.key === 'Backspace' || e.key === 'Delete')) {
            e.preventDefault();
        }
    });
}

attachPhoneMask(document.getElementById('auth-phone'));
attachPhoneMask(document.getElementById('contact-phone'));
attachPhoneMask(document.getElementById('my-phone-input'));

let currentUser = JSON.parse(localStorage.getItem('bluewave_current_user')) || null;

const authModal = document.getElementById('auth-modal');
const authForm = document.getElementById('auth-form');
const authErrorEl = document.getElementById('auth-error');

function saveAll() {
    localStorage.setItem('bluewave_contacts', JSON.stringify(contacts));
    localStorage.setItem('bluewave_profile', JSON.stringify(myProfile));
    if (currentUser) {
        localStorage.setItem('bluewave_current_user', JSON.stringify(currentUser));
    }
}

function initAuthState() {
    if (!currentUser || !currentUser.phone) {
        authModal?.classList.remove('hidden');
        return;
    }
    authModal?.classList.add('hidden');
    myProfile.name = currentUser.name || myProfile.name;
    myProfile.phone = currentUser.phone;
    saveAll();
    socket.emit('register_user', currentUser);
}

authForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    const nameInput = document.getElementById('auth-name');
    const phoneInput = document.getElementById('auth-phone');
    const name = nameInput?.value.trim() || '';
    const phone = phoneInput?.value.trim() || '';

    if (!name || phone.length < 17) {
        if (authErrorEl) {
            authErrorEl.textContent = "Ism va to'liq telefon raqamni (+998 XX XXX XX XX) kiriting.";
        } else {
            alert("Iltimos, ism va to'liq telefon raqamni kiriting: +998 xx xxx xx xx");
        }
        return;
    }

    if (authErrorEl) authErrorEl.textContent = '';

    currentUser = { name, phone };
    myProfile.name = name;
    myProfile.phone = phone;
    saveAll();
    renderMyProfile();

    authModal?.classList.add('hidden');
    socket.emit('register_user', currentUser);
});

// Kontakt tanlanganda yoki qo'shilganda ikki raqam orasidagi shaxsiy xonaga kirish
function connectToContactByPhone(contact) {
    if (!contact) return;

    if (currentUser?.phone && contact?.phone) {
        const roomId = getDirectRoomId(currentUser.phone, contact.phone);
        if (roomId) {
            CURRENT_ROOM = roomId;
            socket.emit('join_direct_chat', {
                myPhone: currentUser.phone,
                targetPhone: contact.phone
            });
            return;
        }
    }

    socket.emit('join_room', CURRENT_ROOM);
}

socket.on('connect', () => {
    if (currentUser && currentUser.phone) {
        socket.emit('register_user', currentUser);
    }
    if (activeContactId) {
        const contact = contacts.find(c => c.id === activeContactId);
        if (contact) connectToContactByPhone(contact);
    } else {
        socket.emit('join_room', CURRENT_ROOM);
    }
});

// Sarlavhadagi status matnini yangilash
function updateChatStatusText(isTyping = false) {
    const statusEl = document.getElementById('chat-status');
    if (!statusEl) return;

    if (isTyping && isPeerOnline) {
        statusEl.textContent = "yozmoqda...";
        statusEl.style.color = "#0077ff";
        return;
    }

    if (isPeerOnline) {
        statusEl.textContent = "onlayn";
        statusEl.style.color = "#0077ff";
    } else {
        statusEl.textContent = peerLastSeen
            ? `oxirgi marta ${peerLastSeen} da onlayn edi`
            : "oflayn";
        statusEl.style.color = "#64748b";
    }
}

// Avatar HTML yaratuvchi yordamchi funksiya
function getAvatarContent(avatarUrl, name) {
    if (avatarUrl) {
        return `<img src="${avatarUrl}" alt="${name}">`;
    }
    return (name || "U").charAt(0).toUpperCase();
}

// Faylni Base64 ga o'giruvchi funksiya
function readFileAsDataURL(file, callback) {
    const reader = new FileReader();
    reader.onload = (e) => callback(e.target.result);
    reader.readAsDataURL(file);
}

function renderMyProfile() {
    document.getElementById('my-name-display').textContent = myProfile.name;
    document.getElementById('my-status-display').textContent = myProfile.bio || "Onlayn";
    document.getElementById('my-avatar-display').innerHTML = getAvatarContent(myProfile.avatar, myProfile.name);
}

function renderContacts(filter = '') {
    contactsListEl.innerHTML = '';

    // Faqat kamida 1 ta xabari bor (yozishilgan) kontaktlarni ajratib olish
    const chattedContacts = contacts.filter(c => c.messages && c.messages.length > 0);

    const filtered = chattedContacts.filter(c =>
        c.name.toLowerCase().includes(filter.toLowerCase()) || c.phone.includes(filter)
    );

    if (filtered.length === 0) {
        contactsListEl.innerHTML = `
            <div style="text-align:center; color:#64748b; padding:30px 15px; font-size:14px;">
                <p>Hozircha faol suhbatlar yo'q.</p>
                <small>Suhbat boshlash uchun yuqoridagi <i class="fas fa-address-book"></i> kontaktlar ro'yxatidan biror kishini tanlang.</small>
            </div>
        `;
        return;
    }

    filtered.forEach(contact => {
        const lastMsg = contact.messages[contact.messages.length - 1];
        let previewText = contact.phone;
        let timeText = "";

        if (lastMsg) {
            timeText = lastMsg.time;
            if (lastMsg.type === 'text') previewText = lastMsg.content;
            else if (lastMsg.type === 'image') previewText = "📷 Rasm";
            else if (lastMsg.type === 'audio') previewText = "🎤 Ovozli xabar";
            else if (lastMsg.type === 'file') previewText = "📎 Fayl";
        }

        const div = document.createElement('div');
        div.className = `contact-item ${contact.id === activeContactId ? 'active' : ''}`;
        div.innerHTML = `
            <div class="avatar">${getAvatarContent(contact.avatar, contact.name)}</div>
            <div class="contact-info">
                <div class="contact-top">
                    <span class="contact-name">${contact.name}</span>
                    <span class="contact-time">${timeText}</span>
                </div>
                <div class="contact-last-msg">${previewText}</div>
            </div>
        `;
        div.onclick = () => openChat(contact.id);
        contactsListEl.appendChild(div);
    });
}

function openChat(id) {
    activeContactId = id;
    const contact = contacts.find(c => c.id === id);
    if (!contact) return;

    emptyChatEl.classList.add('hidden');
    activeChatEl.classList.remove('hidden');

    document.getElementById('chat-name').textContent = `${contact.name} (${contact.phone})`;
    document.getElementById('chat-avatar').innerHTML = getAvatarContent(contact.avatar, contact.name);

    isPeerOnline = false;
    connectToContactByPhone(contact);

    renderContacts(searchInput.value);
    renderMessages(contact);
    updateChatStatusText(false);
}

function renderMessages(contact) {
    messagesContainer.innerHTML = '';
    contact.messages.forEach(msg => {
        if (!msg.reactions) msg.reactions = {};

        const wrapper = document.createElement('div');
        wrapper.className = `message-wrapper ${msg.sender === 'out' ? 'outgoing' : 'incoming'}`;

        // Reaksiya va o'chirish tugmalari
        const reactionBtnsHtml = QUICK_REACTIONS.map(emoji =>
            `<button type="button" class="react-quick-btn" onclick="toggleReaction(${contact.id}, ${msg.id}, '${emoji}')">${emoji}</button>`
        ).join('');

        const toolbarHtml = `
            <div class="message-toolbar">
                ${reactionBtnsHtml}
                <button type="button" class="delete-msg-btn" title="Xabarni o'chirish" onclick="deleteMessage(${contact.id}, ${msg.id})">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;

        let bodyHtml = '';
        if (msg.type === 'text') {
            bodyHtml = `<p>${msg.content}</p>`;
        } else if (msg.type === 'image') {
            bodyHtml = `<img class="chat-img" src="${msg.content}" alt="Rasm">`;
        } else if (msg.type === 'audio') {
            bodyHtml = `<audio controls src="${msg.content}"></audio>`;
        } else if (msg.type === 'file') {
            bodyHtml = `<a href="${msg.content}" download="${msg.fileName}" class="file-attachment">
                            <i class="fas fa-file-alt fa-lg"></i>
                            <span>${msg.fileName}</span>
                        </a>`;
        }

        let tickHtml = '';
        if (msg.sender === 'out') {
            tickHtml = msg.read
                ? '<i class="fas fa-check-double tick-read" title="O\'qildi"></i>'
                : '<i class="fas fa-check tick-sent" title="Yuborildi"></i>';
        }

        // Qo'yilgan reaksiyalar
        const reactionBadges = Object.entries(msg.reactions)
            .filter(([, count]) => count > 0)
            .map(([emoji, count]) =>
                `<span class="reaction-badge" onclick="toggleReaction(${contact.id}, ${msg.id}, '${emoji}')">${emoji} ${count}</span>`
            ).join('');

        const reactionsRowHtml = reactionBadges
            ? `<div class="reactions-row">${reactionBadges}</div>`
            : '';

        wrapper.innerHTML = `
            ${toolbarHtml}
            <div class="message">
                ${bodyHtml}
                <div class="msg-meta">
                    <span>${msg.time}</span>
                    ${tickHtml}
                </div>
            </div>
            ${reactionsRowHtml}
        `;
        messagesContainer.appendChild(wrapper);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function applyReactionLocal(contactId, msgId, emoji, forceState = null) {
    const contact = contacts.find(c => c.id == contactId);
    if (!contact) return;
    const msg = contact.messages.find(m => m.id == msgId);
    if (!msg) return;

    if (!msg.reactions) msg.reactions = {};
    if (typeof forceState === 'boolean') {
        msg.reactions[emoji] = forceState ? 1 : 0;
    } else {
        msg.reactions[emoji] = msg.reactions[emoji] ? 0 : 1;
    }

    saveAll();
    if (activeContactId == contact.id) {
        renderMessages(contact);
    }
    return Boolean(msg.reactions[emoji]);
}

// Xabarga reaksiya bosish / olib tashlash + narigi qurilmaga yuborish
window.toggleReaction = function(contactId, msgId, emoji) {
    const isNowActive = applyReactionLocal(contactId, msgId, emoji);
    if (typeof isNowActive !== 'boolean') return;

    const contact = contacts.find(c => c.id == contactId);
    socket.emit('add_reaction', {
        roomId: CURRENT_ROOM,
        senderPhone: currentUser?.phone || myProfile.phone,
        targetPhone: contact?.phone,
        msgId,
        emoji,
        active: isNowActive
    });
};

socket.on('add_reaction', (data = {}) => {
    const msgId = data.msgId || data.messageId;
    if (!msgId || !data.emoji) return;

    let targetContact = contacts.find(c => c.id === activeContactId);
    if (!targetContact && data.senderPhone) {
        targetContact = contacts.find(c => normalizePhone(c.phone) === normalizePhone(data.senderPhone));
    }
    if (!targetContact) return;

    applyReactionLocal(
        targetContact.id,
        msgId,
        data.emoji,
        typeof data.active === 'boolean' ? data.active : null
    );
});

// Tanlangan bitta xabarni o'chirish
window.deleteMessage = function(contactId, msgId) {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;

    contact.messages = contact.messages.filter(m => m.id !== msgId);
    saveAll();
    renderContacts(searchInput.value);
    if (activeContactId === contactId) {
        renderMessages(contact);
    }
};

function getCurrentTime() {
    return new Date().toTimeString().slice(0, 5);
}

// Xabar yuborish (1 ta ptichka bilan ketadi, o'qilsa 2 ta bo'ladi)
function sendMessage(type, content, fileName = '') {
    if (!activeContactId) return;
    const contact = contacts.find(c => c.id === activeContactId);
    if (!contact) return;

    const senderPhone = currentUser?.phone || myProfile.phone;
    const senderName = currentUser?.name || myProfile.name;

    const newMsg = {
        id: Date.now(),
        type,
        content,
        fileName,
        sender: 'out',
        senderPhone,
        senderName,
        time: getCurrentTime(),
        read: false,
        reactions: {}
    };

    contact.messages.push(newMsg);
    saveAll();
    renderMessages(contact);
    renderContacts(searchInput.value);

    socket.emit('typing', {
        roomId: CURRENT_ROOM,
        senderPhone,
        targetPhone: contact.phone,
        isTyping: false
    });

    socket.emit('send_message', {
        roomId: CURRENT_ROOM,
        senderPhone,
        targetPhone: contact.phone,
        message: newMsg
    });
}

// Narigi odamning onlayn/oflayn holati
socket.on('peer_status', (status) => {
    isPeerOnline = status.online;
    if (status.lastSeen) {
        peerLastSeen = status.lastSeen;
    }
    updateChatStatusText(false);
});

// Narigi odam yozayotganini ko'rsatish
socket.on('user_typing', (isTyping) => {
    updateChatStatusText(isTyping);
});

// Boshqa odamdan real xabar kelganda
socket.on('receive_message', (msg) => {
    if (!msg) return;

    let targetContact = null;
    if (msg.senderPhone) {
        targetContact = contacts.find(c => normalizePhone(c.phone) === normalizePhone(msg.senderPhone));
        if (!targetContact) {
            targetContact = {
                id: Date.now() + Math.floor(Math.random() * 1000),
                name: msg.senderName || msg.senderPhone,
                phone: msg.senderPhone,
                avatar: "",
                messages: []
            };
            contacts.unshift(targetContact);
        }
    } else {
        targetContact = contacts.find(c => c.id === activeContactId) || contacts[0];
    }

    if (!targetContact) return;

    const isChatOpen = activeContactId === targetContact.id && !document.hidden;

    targetContact.messages.push({
        ...msg,
        sender: 'in',
        read: isChatOpen,
        reactions: msg.reactions || {}
    });

    saveAll();
    renderContacts(searchInput.value);

    if (isChatOpen) {
        renderMessages(targetContact);
        socket.emit('message_read', {
            roomId: CURRENT_ROOM,
            senderPhone: currentUser?.phone || myProfile.phone,
            targetPhone: targetContact.phone,
            messageId: msg.id
        });
    }
});

// Xabar o'qilganda 2 ta ptichkaga o'tkazish
socket.on('message_was_read', (msgId) => {
    contacts.forEach(c => {
        const m = c.messages.find(item => item.id === msgId);
        if (m) m.read = true;
    });
    saveAll();
    if (activeContactId) {
        const active = contacts.find(c => c.id === activeContactId);
        if (active) renderMessages(active);
    }
});

// Matnli xabar va "yozmoqda..." signali
messageInput.addEventListener('input', () => {
    const contact = contacts.find(c => c.id === activeContactId);
    const payloadBase = {
        roomId: CURRENT_ROOM,
        senderPhone: currentUser?.phone || myProfile.phone,
        targetPhone: contact?.phone
    };

    if (messageInput.value.trim().length > 0) {
        sendBtn.classList.remove('hidden');
        recordBtn.classList.add('hidden');
        socket.emit('typing', { ...payloadBase, isTyping: true });

        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('typing', { ...payloadBase, isTyping: false });
        }, 1500);
    } else {
        sendBtn.classList.add('hidden');
        recordBtn.classList.remove('hidden');
        socket.emit('typing', { ...payloadBase, isTyping: false });
    }
});

sendBtn.addEventListener('click', () => {
    const text = messageInput.value.trim();
    if (text) {
        sendMessage('text', text);
        messageInput.value = '';
        sendBtn.classList.add('hidden');
        recordBtn.classList.remove('hidden');
    }
});

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendBtn.click();
});

// Rasm va fayl yuborish
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    readFileAsDataURL(file, (dataUrl) => {
        if (file.type.startsWith('image/')) {
            sendMessage('image', dataUrl);
        } else {
            sendMessage('file', dataUrl, file.name);
        }
    });
    fileInput.value = '';
});

// Ovozli xabar
recordBtn.addEventListener('click', async () => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder = new MediaRecorder(stream);
            audioChunks = [];

            mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
            mediaRecorder.onstop = () => {
                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                readFileAsDataURL(audioBlob, (dataUrl) => sendMessage('audio', dataUrl));
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            recordBtn.classList.add('recording');
        } catch (err) {
            alert("Mikrofonga ruxsat berilmadi yoki qurilma topilmadi!");
        }
    } else {
        mediaRecorder.stop();
        recordBtn.classList.remove('recording');
    }
});

// Emoji paneli
emojiBtn.addEventListener('click', () => emojiPicker.classList.toggle('hidden'));
emojiPicker.addEventListener('click', (e) => {
    if (e.target.tagName === 'SPAN') {
        messageInput.value += e.target.textContent;
        messageInput.dispatchEvent(new Event('input'));
        emojiPicker.classList.add('hidden');
    }
});

// Modallarni yopish
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', () => {
        document.getElementById(btn.dataset.target).classList.add('hidden');
    });
});

// Alohida Kontaktlar ro'yxati oynasi
const directoryModal = document.getElementById('contacts-directory-modal');
const directoryListEl = document.getElementById('directory-list');
const directorySearchInput = document.getElementById('directory-search-input');

function renderDirectory(filter = '') {
    directoryListEl.innerHTML = '';
    const list = contacts.filter(c =>
        c.name.toLowerCase().includes(filter.toLowerCase()) || c.phone.includes(filter)
    );

    if (list.length === 0) {
        directoryListEl.innerHTML = `<p style="text-align:center; color:#64748b; padding:16px;">Kontakt topilmadi</p>`;
        return;
    }

    list.forEach(c => {
        const item = document.createElement('div');
        item.className = 'directory-item';
        item.innerHTML = `
            <div class="directory-user">
                <div class="avatar">${getAvatarContent(c.avatar, c.name)}</div>
                <div>
                    <h4>${c.name}</h4>
                    <small>${c.phone}</small>
                </div>
            </div>
            <div class="directory-btns">
                <button type="button" class="dir-btn chat-btn" title="Yozish" onclick="dirOpenChat(${c.id})"><i class="fas fa-comment"></i></button>
                <button type="button" class="dir-btn edit-btn" title="Tahrirlash" onclick="dirEditContact(${c.id})"><i class="fas fa-edit"></i></button>
                <button type="button" class="dir-btn del-btn" title="O'chirish" onclick="dirDeleteContact(${c.id})"><i class="fas fa-trash"></i></button>
            </div>
        `;
        directoryListEl.appendChild(item);
    });
}

document.getElementById('open-contacts-list-btn').addEventListener('click', () => {
    directorySearchInput.value = '';
    renderDirectory();
    directoryModal.classList.remove('hidden');
});

directorySearchInput.addEventListener('input', (e) => renderDirectory(e.target.value));

window.dirOpenChat = function(id) {
    directoryModal.classList.add('hidden');
    openChat(id);
};

window.dirEditContact = function(id) {
    directoryModal.classList.add('hidden');
    openEditContactModal(id);
};

window.dirDeleteContact = function(id) {
    const contact = contacts.find(c => c.id === id);
    if (!contact) return;
    if (confirm(`"${contact.name}" kontaktini o'chirishni xohlaysizmi?`)) {
        contacts = contacts.filter(c => c.id !== id);
        if (activeContactId === id) {
            activeContactId = null;
            activeChatEl.classList.add('hidden');
            emptyChatEl.classList.remove('hidden');
        }
        saveAll();
        renderContacts(searchInput.value);
        renderDirectory(directorySearchInput.value);
    }
};

// Kontakt qo'shish va tahrirlash
const contactModal = document.getElementById('contact-modal');
const contactForm = document.getElementById('contact-form');
const contactModalTitle = document.getElementById('contact-modal-title');
const editContactIdInput = document.getElementById('edit-contact-id');
const contactNameInput = document.getElementById('contact-name');
const contactPhoneInput = document.getElementById('contact-phone');
const contactAvatarPreview = document.getElementById('contact-avatar-preview');
const contactAvatarFile = document.getElementById('contact-avatar-file');

function updateContactAvatarPreview() {
    contactAvatarPreview.innerHTML = getAvatarContent(tempContactAvatar, contactNameInput.value || "K");
}

contactNameInput.addEventListener('input', () => {
    if (!tempContactAvatar) updateContactAvatarPreview();
});

contactAvatarFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readFileAsDataURL(file, (dataUrl) => {
        tempContactAvatar = dataUrl;
        updateContactAvatarPreview();
    });
    contactAvatarFile.value = '';
});

document.getElementById('clear-contact-avatar-btn').addEventListener('click', () => {
    tempContactAvatar = "";
    updateContactAvatarPreview();
});

document.getElementById('open-add-modal-btn').addEventListener('click', () => {
    contactModalTitle.textContent = "Yangi kontakt qo'shish";
    editContactIdInput.value = '';
    contactNameInput.value = '';
    contactPhoneInput.value = '+998 ';
    tempContactAvatar = "";
    updateContactAvatarPreview();
    contactModal.classList.remove('hidden');
});

function openEditContactModal(id) {
    const contact = contacts.find(c => c.id === id);
    if (!contact) return;
    contactModalTitle.textContent = "Kontaktni tahrirlash";
    editContactIdInput.value = contact.id;
    contactNameInput.value = contact.name;
    contactPhoneInput.value = contact.phone;
    tempContactAvatar = contact.avatar || "";
    updateContactAvatarPreview();
    contactModal.classList.remove('hidden');
}

document.getElementById('edit-contact-btn').addEventListener('click', () => {
    if (activeContactId) openEditContactModal(activeContactId);
});

contactForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = contactNameInput.value.trim();
    const phone = contactPhoneInput.value.trim();
    const editId = editContactIdInput.value;

    if (phone.length < 17) {
        alert("Iltimos, telefon raqamni to'liq kiriting: +998 xx xxx xx xx");
        return;
    }

    if (editId) {
        const contact = contacts.find(c => c.id == editId);
        if (contact) {
            contact.name = name;
            contact.phone = phone;
            contact.avatar = tempContactAvatar;
            saveAll();
            renderContacts(searchInput.value);
            if (activeContactId == editId) openChat(contact.id);
        }
    } else {
        const newContact = {
            id: Date.now(),
            name,
            phone,
            avatar: tempContactAvatar,
            messages: []
        };
        contacts.unshift(newContact);
        saveAll();
        renderContacts(searchInput.value);
        openChat(newContact.id);
    }

    contactModal.classList.add('hidden');
});

document.getElementById('delete-contact-btn').addEventListener('click', () => {
    if (!activeContactId) return;
    dirDeleteContact(activeContactId);
});

// Mening profilimni ko'rish va tahrirlash
const profileModal = document.getElementById('profile-modal');
const profileForm = document.getElementById('profile-form');
const profileModalAvatar = document.getElementById('profile-modal-avatar');
const myAvatarFile = document.getElementById('my-avatar-file');

document.getElementById('open-profile-btn').addEventListener('click', () => {
    tempMyAvatar = myProfile.avatar || "";
    document.getElementById('my-name-input').value = myProfile.name;
    document.getElementById('my-phone-input').value = myProfile.phone;
    document.getElementById('my-bio-input').value = myProfile.bio;
    profileModalAvatar.innerHTML = getAvatarContent(tempMyAvatar, myProfile.name);
    profileModal.classList.remove('hidden');
});

myAvatarFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    readFileAsDataURL(file, (dataUrl) => {
        tempMyAvatar = dataUrl;
        profileModalAvatar.innerHTML = getAvatarContent(tempMyAvatar, document.getElementById('my-name-input').value);
    });
    myAvatarFile.value = '';
});

profileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('my-name-input').value.trim();
    const phone = document.getElementById('my-phone-input').value.trim();
    const bio = document.getElementById('my-bio-input').value.trim();

    if (phone.length < 17) {
        alert("Telefon raqamni to'liq kiriting: +998 xx xxx xx xx");
        return;
    }

    myProfile = { name, phone, bio, avatar: tempMyAvatar };
    currentUser = { name, phone };
    saveAll();
    renderMyProfile();
    socket.emit('register_user', currentUser);
    profileModal.classList.add('hidden');
});

// Qo'ng'iroq oynasi
const callModal = document.getElementById('call-modal');
const callTimerEl = document.getElementById('call-timer');

let peerConnection = null;
let localStream = null;

const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};

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
                senderPhone: currentUser?.phone || myProfile.phone,
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

    connectToContactByPhone(contact);

    document.getElementById('call-avatar').innerHTML = getAvatarContent(contact.avatar, contact.name);
    document.getElementById('call-contact-name').textContent = contact.name;
    document.getElementById('call-contact-phone').textContent = contact.phone;
    callTimerEl.textContent = isVideo ? "Video qo'ng'iroq qilinmoqda..." : "Qo'ng'iroq qilinmoqda...";
    callModal.classList.remove('hidden');

    try {
        await setupPeerConnection(isVideo);
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        socket.emit('call_offer', {
            roomId: CURRENT_ROOM,
            senderPhone: currentUser?.phone || myProfile.phone,
            targetPhone: contact.phone,
            offer,
            isVideo
        });
    } catch (err) {
        alert("Mikrofon yoki kameraga ruxsat berilmadi!");
        endCallCleanup(false);
    }
}

socket.on('call_offer', async ({ offer, isVideo, roomId, senderPhone }) => {
    if (roomId) CURRENT_ROOM = roomId;

    const accept = confirm(isVideo ? "Kiruvchi video qo'ng'iroq. Qabul qilasizmi?" : "Kiruvchi audio qo'ng'iroq. Qabul qilasizmi?");
    if (!accept) {
        socket.emit('end_call', {
            roomId: CURRENT_ROOM,
            senderPhone: currentUser?.phone || myProfile.phone,
            targetPhone: senderPhone
        });
        return;
    }

    callModal.classList.remove('hidden');
    callTimerEl.textContent = "Ulandi...";

    try {
        await setupPeerConnection(isVideo);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('call_answer', {
            roomId: CURRENT_ROOM,
            senderPhone: currentUser?.phone || myProfile.phone,
            targetPhone: senderPhone,
            answer
        });
    } catch (err) {
        alert("Qo'ng'iroqni qabul qilishda xatolik!");
        endCallCleanup(false);
    }
});

socket.on('call_answer', async ({ answer }) => {
    if (peerConnection) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        callTimerEl.textContent = "Ulandi...";
    }
});

socket.on('ice_candidate', async ({ candidate }) => {
    if (peerConnection && candidate) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
});

function endCallCleanup(notifyPeer = true) {
    clearInterval(callInterval);
    if (notifyPeer) {
        const contact = contacts.find(c => c.id === activeContactId);
        socket.emit('end_call', {
            roomId: CURRENT_ROOM,
            senderPhone: currentUser?.phone || myProfile.phone,
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
    callModal.classList.add('hidden');
}

socket.on('end_call', () => endCallCleanup(false));

document.getElementById('end-call-btn').addEventListener('click', () => endCallCleanup(true));
document.getElementById('audio-call-btn').addEventListener('click', () => startCall(false));
document.getElementById('video-call-btn').addEventListener('click', () => startCall(true));

document.getElementById('mute-call-btn').addEventListener('click', (e) => {
    const icon = e.currentTarget.querySelector('i');
    icon.classList.toggle('fa-microphone');
    icon.classList.toggle('fa-microphone-slash');
    if (localStream) {
        localStream.getAudioTracks().forEach(track => {
            track.enabled = !track.enabled;
        });
    }
});

searchInput.addEventListener('input', (e) => renderContacts(e.target.value));

document.getElementById('clear-chat-btn').addEventListener('click', () => {
    if (!activeContactId) return;
    const contact = contacts.find(c => c.id === activeContactId);
    if (confirm("Ushbu suhbat tarixini tozalamoqchimisiz?")) {
        contact.messages = [];
        saveAll();
        renderMessages(contact);
        renderContacts(searchInput.value);
    }
});

initAuthState();
renderMyProfile();
renderContacts();