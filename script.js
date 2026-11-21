const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥"];

let myProfile = JSON.parse(localStorage.getItem('bluewave_profile')) || {
    name: "Mening Profilim",
    phone: "+998 90 000 00 00",
    bio: "BlueWave foydalanuvchisi",
    avatar: ""
};

let contacts = JSON.parse(localStorage.getItem('bluewave_contacts')) || [
    {
        id: 1,
        name: "Sardorbek Alimov",
        phone: "+998 90 123 45 67",
        avatar: "",
        messages: [
            {
                id: 101,
                type: 'text',
                content: "Salom! Yangi dizayn juda zo'r chiqibdi!",
                sender: 'in',
                time: "10:15",
                read: true,
                reactions: { "👍": 1 }
            }
        ]
    },
    {
        id: 2,
        name: "Madina Karimova",
        phone: "+998 93 987 65 43",
        avatar: "",
        messages: [
            {
                id: 102,
                type: 'text',
                content: "Bugun soat 15:00 da qo'ng'iroqlashamizmi?",
                sender: 'in',
                time: "11:40",
                read: true,
                reactions: {}
            }
        ]
    }
];

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
const CURRENT_ROOM = "bluewave-room-1";
socket.emit('join_room', CURRENT_ROOM);

let isPeerOnline = false;
let peerLastSeen = null;
let typingTimeout = null;

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

// +998 xx xxx xx xx formatlash
function attachPhoneMask(inputEl) {
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

attachPhoneMask(document.getElementById('contact-phone'));
attachPhoneMask(document.getElementById('my-phone-input'));

function saveAll() {
    localStorage.setItem('bluewave_contacts', JSON.stringify(contacts));
    localStorage.setItem('bluewave_profile', JSON.stringify(myProfile));
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

// Xabarga reaksiya bosish / olib tashlash
window.toggleReaction = function(contactId, msgId, emoji) {
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return;
    const msg = contact.messages.find(m => m.id === msgId);
    if (!msg) return;

    if (!msg.reactions) msg.reactions = {};
    msg.reactions[emoji] = msg.reactions[emoji] ? 0 : 1;

    saveAll();
    if (activeContactId === contactId) {
        renderMessages(contact);
    }
};

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

    const newMsg = {
        id: Date.now(),
        type,
        content,
        fileName,
        sender: 'out',
        time: getCurrentTime(),
        read: false,
        reactions: {}
    };

    contact.messages.push(newMsg);
    saveAll();
    renderMessages(contact);
    renderContacts(searchInput.value);

    socket.emit('typing', { roomId: CURRENT_ROOM, isTyping: false });
    socket.emit('send_message', {
        roomId: CURRENT_ROOM,
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
    const targetContact = contacts.find(c => c.id === activeContactId) || contacts[0];
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
    if (messageInput.value.trim().length > 0) {
        sendBtn.classList.remove('hidden');
        recordBtn.classList.add('hidden');
        socket.emit('typing', { roomId: CURRENT_ROOM, isTyping: true });

        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('typing', { roomId: CURRENT_ROOM, isTyping: false });
        }, 1500);
    } else {
        sendBtn.classList.add('hidden');
        recordBtn.classList.remove('hidden');
        socket.emit('typing', { roomId: CURRENT_ROOM, isTyping: false });
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
    saveAll();
    renderMyProfile();
    profileModal.classList.add('hidden');
});

// Qo'ng'iroq oynasi
const callModal = document.getElementById('call-modal');
const callTimerEl = document.getElementById('call-timer');

function startCall(isVideo = false) {
    if (!activeContactId) return;
    const contact = contacts.find(c => c.id === activeContactId);

    document.getElementById('call-avatar').innerHTML = getAvatarContent(contact.avatar, contact.name);
    document.getElementById('call-contact-name').textContent = contact.name;
    document.getElementById('call-contact-phone').textContent = contact.phone;
    callTimerEl.textContent = isVideo ? "Video qo'ng'iroq qilinmoqda..." : "Qo'ng'iroq qilinmoqda...";
    callModal.classList.remove('hidden');

    let seconds = 0;
    clearInterval(callInterval);
    callInterval = setInterval(() => {
        seconds++;
        if (seconds >= 2) {
            const activeSec = seconds - 2;
            const mins = String(Math.floor(activeSec / 60)).padStart(2, '0');
            const secs = String(activeSec % 60).padStart(2, '0');
            callTimerEl.textContent = `${mins}:${secs}`;
        }
    }, 1000);
}

document.getElementById('audio-call-btn').addEventListener('click', () => startCall(false));
document.getElementById('video-call-btn').addEventListener('click', () => startCall(true));

document.getElementById('end-call-btn').addEventListener('click', () => {
    clearInterval(callInterval);
    callModal.classList.add('hidden');
});

document.getElementById('mute-call-btn').addEventListener('click', (e) => {
    const icon = e.currentTarget.querySelector('i');
    icon.classList.toggle('fa-microphone');
    icon.classList.toggle('fa-microphone-slash');
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

renderMyProfile();
renderContacts();