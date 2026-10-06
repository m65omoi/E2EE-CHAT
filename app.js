document.addEventListener('DOMContentLoaded', () => {
    // UI Elements
    const joinScreen = document.getElementById('join-screen');
    const chatScreen = document.getElementById('chat-screen');
    const joinForm = document.getElementById('join-form');
    const chatForm = document.getElementById('chat-form');
    const messageInput = document.getElementById('message-input');
    const messagesArea = document.getElementById('messages-area');
    const leaveBtn = document.getElementById('leave-btn');
    const attachBtn = document.getElementById('attach-btn');
    const imageInput = document.getElementById('image-input');

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

    // Handle Image Attachment Click
    attachBtn.addEventListener('click', () => {
        imageInput.click();
    });

    // Handle Image Selection
    imageInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // 限制文件类型
        if (!file.type.startsWith('image/')) {
            alert('只能发送图片文件！');
            return;
        }

        try {
            addSystemMessage("正在压缩并加密图片...");
            const compressedBase64 = await compressImage(file);
            await sendMessageAndRender(compressedBase64, 'image');
        } catch (error) {
            console.error("Image processing failed", error);
            addSystemMessage("图片处理或加密失败。");
        } finally {
            imageInput.value = ''; // Reset input
        }
    });

    // Send Text Message
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = messageInput.value.trim();
        if (!text) return;

        try {
            await sendMessageAndRender(text, 'text');
            messageInput.value = '';
        } catch (error) {
            console.error("Encryption failed", error);
            addSystemMessage("发送失败：加密错误。");
        }
    });

    // Common Send Logic (Encrypt and Publish)
    async function sendMessageAndRender(content, type) {
        // Encrypt the content (text or base64 image)
        const encryptedData = await E2EE.encrypt(content, cryptoKey);
        
        const payload = {
            senderName: username,
            type: type,
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
        addChatMessage(username, content, true, type);
    }

    // Handle Incoming Messages
    async function handleIncomingMessage(data) {
        try {
            // Decrypt the payload
            const decryptedContent = await E2EE.decrypt(data.ciphertext, data.iv, cryptoKey);
            const type = data.type || 'text'; // Fallback to text for older messages
            addChatMessage(data.senderName, decryptedContent, false, type);
        } catch (error) {
            console.error("Failed to decrypt incoming message", error);
            addChatMessage(data.senderName, "🔒 [解密失败：可能使用了错误的密钥]", false, 'text');
        }
    }

    // --- Utility: Client-Side Image Compression ---
    function compressImage(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = event => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    // 限制最大宽高，避免 Base64 字符串过大超出 MQTT 限制
                    const MAX_WIDTH = 800;
                    const MAX_HEIGHT = 800;
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > MAX_WIDTH) {
                            height *= MAX_WIDTH / width;
                            width = MAX_WIDTH;
                        }
                    } else {
                        if (height > MAX_HEIGHT) {
                            width *= MAX_HEIGHT / height;
                            height = MAX_HEIGHT;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    // 压缩为 JPEG，质量 0.7
                    const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
                    resolve(compressedDataUrl);
                };
                img.onerror = error => reject(error);
            };
            reader.onerror = error => reject(error);
        });
    }

    // UI Helpers
    function addChatMessage(sender, content, isSelf, type = 'text') {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message-bubble ${isSelf ? 'self' : 'other'}`;
        
        const senderSpan = document.createElement('div');
        senderSpan.className = 'sender-name';
        senderSpan.textContent = sender;

        if (!isSelf) msgDiv.appendChild(senderSpan);

        if (type === 'text') {
            const textDiv = document.createElement('div');
            textDiv.className = 'message-text';
            textDiv.textContent = content;
            msgDiv.appendChild(textDiv);
        } else if (type === 'image') {
            const imgEl = document.createElement('img');
            imgEl.className = 'message-image';
            imgEl.src = content; // content is the decrypted Base64 data URL
            
            // 点击图片可全屏查看 (简单实现为在新标签页打开)
            imgEl.addEventListener('click', () => {
                const w = window.open("");
                w.document.write(`<img src="${content}" style="max-width: 100%;">`);
            });

            const textDiv = document.createElement('div');
            textDiv.className = 'message-text';
            textDiv.style.padding = '8px'; // 减小图片的文字容器内边距
            textDiv.appendChild(imgEl);
            msgDiv.appendChild(textDiv);
        }
        
        messagesArea.appendChild(msgDiv);
        
        // 由于图片加载是异步的（哪怕是base64），稍微延迟滚动以确保滚动到底部
        setTimeout(() => {
            messagesArea.scrollTop = messagesArea.scrollHeight;
        }, 50);
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
