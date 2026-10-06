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
    let mqttClient = null;
    let cryptoKey = null;
    let username = '';
    const ROOM_NAME = 'dorm-secret-room'; // Default room name, used to derive MQTT topic
    let mqttTopic = '';

    // Broker Configuration (Public EMQX Broker)
    const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';

    // Join Room
    joinForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        username = document.getElementById('username').value.trim();
        const passphrase = document.getElementById('passphrase').value;

        if (!username || !passphrase) return;

        try {
            // Derive the encryption key from the passphrase
            cryptoKey = await E2EE.deriveKey(passphrase);
            
            // Hash the room name and passphrase to generate a unique but deterministic MQTT topic
            // This prevents overlapping with random public users on the broker
            const encoder = new TextEncoder();
            const topicData = encoder.encode(ROOM_NAME + passphrase);
            const topicHashBuffer = await crypto.subtle.digest('SHA-256', topicData);
            const topicHashArray = Array.from(new Uint8Array(topicHashBuffer));
            const topicHashHex = topicHashArray.map(b => b.toString(16).padStart(2, '0')).join('');
            mqttTopic = `dormchat/e2ee/${topicHashHex}`;
            
            // Connect to MQTT broker via WebSockets
            mqttClient = mqtt.connect(MQTT_BROKER, {
                clientId: 'dorm_user_' + Math.random().toString(16).substr(2, 8)
            });

            mqttClient.on('connect', () => {
                console.log('Connected to MQTT public broker');
                mqttClient.subscribe(mqttTopic, (err) => {
                    if (err) {
                        console.error('Subscription error:', err);
                        alert("连接房间失败！");
                    }
                });
            });

            // Listen for incoming messages
            mqttClient.on('message', async (topic, message) => {
                if (topic === mqttTopic) {
                    try {
                        const data = JSON.parse(message.toString());
                        // Only process if it's not sent by ourselves (MQTT echoes back)
                        if (data.senderName !== username) {
                            await handleIncomingMessage(data);
                        }
                    } catch (err) {
                        console.error('Failed to parse incoming message:', err);
                    }
                }
            });

            // Switch UI
            joinScreen.classList.remove('active');
            chatScreen.classList.add('active');
            
            addSystemMessage(`你已作为 ${username} 加入加密频道。`);
            
        } catch (error) {
            console.error("Initialization failed", error);
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
                senderName: username,
                ciphertext: encryptedData.ciphertext,
                iv: encryptedData.iv,
                timestamp: Date.now()
            };

            // Publish via MQTT
            if (mqttClient && mqttClient.connected) {
                mqttClient.publish(mqttTopic, JSON.stringify(payload));
            } else {
                addSystemMessage("发送失败：未连接到网络。");
                return;
            }

            // Render locally
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
        if (mqttClient) {
            mqttClient.end();
            mqttClient = null;
        }
        cryptoKey = null;
        username = '';
        document.getElementById('passphrase').value = '';
        mqttTopic = '';
        
        messagesArea.innerHTML = '<div class="system-message">欢迎来到加密聊天室，输入的消息只有知道密钥的人才能看到。</div>';
        
        chatScreen.classList.remove('active');
        joinScreen.classList.add('active');
    });
});
