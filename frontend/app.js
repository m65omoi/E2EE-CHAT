document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const joinScreen = document.getElementById('join-screen');
    const chatScreen = document.getElementById('chat-screen');
    const joinForm = document.getElementById('join-form');
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const messagesArea = document.getElementById('messages-area');
    const leaveBtn = document.getElementById('leave-btn');

    // State
    let socket = null;
    let cryptoKey = null;
    let username = '';
    const ROOM_NAME = 'dorm-secret-room'; // Default single room

    // Join Room
    joinForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        username = document.getElementById('username').value.trim();
        const passphrase = document.getElementById('passphrase').value;

        if (!username || !passphrase) return;

        try {
            // Derive the encryption key from the passphrase
            cryptoKey = await E2EE.deriveKey(passphrase);
            
            // Connect to Socket.io server
            socket = io();

            socket.emit('join_room', ROOM_NAME);

            // Listen for incoming messages
            socket.on('receive_message', async (data) => {
                await handleIncomingMessage(data);
            });

            // Switch UI
            joinScreen.classList.remove('active');
            chatScreen.classList.add('active');
            
            addSystemMessage(`你已作为 ${username} 加入加密频道。`);
            
        } catch (error) {
            console.error("Key derivation failed", error);
            alert("初始化加密失败，请重试。");
        }
    });

    // Send Message
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = messageInput.value.trim();
        if (!text) return;

        try {
            // Encrypt the message text
            const encryptedData = await E2EE.encrypt(text, cryptoKey);
            
            const payload = {
                room: ROOM_NAME,
                senderName: username,
                ciphertext: encryptedData.ciphertext,
                iv: encryptedData.iv,
                timestamp: Date.now()
            };

            // Send to server
            socket.emit('send_message', payload);

            // Render locally (don't need to decrypt our own message)
            addChatMessage(username, text, true);
            messageInput.value = '';

        } catch (error) {
            console.error("Encryption failed", error);
            addSystemMessage("发送失败：加密错误。");
        }
    });

    // Handle Incoming Messages
    async function handleIncomingMessage(data) {
        try {
            // Decrypt the payload
            const decryptedText = await E2EE.decrypt(data.ciphertext, data.iv, cryptoKey);
            addChatMessage(data.senderName, decryptedText, false);
        } catch (error) {
            console.error("Failed to decrypt incoming message", error);
            addChatMessage(data.senderName, "🔒 [解密失败：可能使用了错误的密钥]", false);
        }
    }

    // UI Helpers
    function addChatMessage(sender, text, isSelf) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message-bubble ${isSelf ? 'self' : 'other'}`;
        
        const senderSpan = document.createElement('div');
        senderSpan.className = 'sender-name';
        senderSpan.textContent = sender;

        const textDiv = document.createElement('div');
        textDiv.className = 'message-text';
        textDiv.textContent = text;

        if (!isSelf) msgDiv.appendChild(senderSpan);
        msgDiv.appendChild(textDiv);
        
        messagesArea.appendChild(msgDiv);
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    function addSystemMessage(text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'system-message';
        msgDiv.textContent = text;
        messagesArea.appendChild(msgDiv);
        messagesArea.scrollTop = messagesArea.scrollHeight;
    }

    // Leave Room
    leaveBtn.addEventListener('click', () => {
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        cryptoKey = null;
        username = '';
        document.getElementById('passphrase').value = '';
        
        messagesArea.innerHTML = '<div class="system-message">欢迎来到加密聊天室，输入的消息只有知道密钥的人才能看到。</div>';
        
        chatScreen.classList.remove('active');
        joinScreen.classList.add('active');
    });
});
