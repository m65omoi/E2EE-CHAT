// Web Crypto API Wrapper for E2EE
// 使用浏览器的原生加密 API，保证高性能和高安全性

const E2EE = {
    // 固定的 Salt，由于是预共享密码，固定 Salt 简化了握手流程
    SALT: new TextEncoder().encode("dorm-chat-e2ee-salt-v1"),
    
    // 从用户输入的密码派生出 AES-GCM 密钥
    async deriveKey(passphrase) {
        const enc = new TextEncoder();
        const keyMaterial = await window.crypto.subtle.importKey(
            "raw",
            enc.encode(passphrase),
            { name: "PBKDF2" },
            false,
            ["deriveBits", "deriveKey"]
        );

        return window.crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: this.SALT,
                iterations: 100000,
                hash: "SHA-256"
            },
            keyMaterial,
            { name: "AES-GCM", length: 256 },
            true, // extractable (在当前标签页内可用)
            ["encrypt", "decrypt"]
        );
    },

    // 加密消息
    async encrypt(text, key) {
        const enc = new TextEncoder();
        const iv = window.crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV 推荐用于 AES-GCM
        
        const ciphertext = await window.crypto.subtle.encrypt(
            {
                name: "AES-GCM",
                iv: iv
            },
            key,
            enc.encode(text)
        );

        // 将 Buffer 转换为 Base64 以便通过 WebSocket 传输
        return {
            ciphertext: this.arrayBufferToBase64(ciphertext),
            iv: this.arrayBufferToBase64(iv)
        };
    },

    // 解密消息
    async decrypt(ciphertextBase64, ivBase64, key) {
        try {
            const ciphertext = this.base64ToArrayBuffer(ciphertextBase64);
            const iv = this.base64ToArrayBuffer(ivBase64);

            const decrypted = await window.crypto.subtle.decrypt(
                {
                    name: "AES-GCM",
                    iv: iv
                },
                key,
                ciphertext
            );

            const dec = new TextDecoder();
            return dec.decode(decrypted);
        } catch (e) {
            console.error("Decryption failed:", e);
            return "[解密失败：密文损坏或密钥不匹配]";
        }
    },

    // --- Helper Functions ---
    arrayBufferToBase64(buffer) {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    },

    base64ToArrayBuffer(base64) {
        const binary_string = window.atob(base64);
        const len = binary_string.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary_string.charCodeAt(i);
        }
        return bytes.buffer;
    }
};
