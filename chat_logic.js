// chat_logic.js

// --- 对话框的CSS样式 (保持不变) ---
const chatPanelStyles = `
    #chat-panel {
        position: fixed;
        bottom: 20px;
        right: -100%;
        width: 400px;
        height: 450px;
        background-color: white;
        border-radius: 15px;
        box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
        z-index: 2001;
        display: flex;
        flex-direction: column;
        transition: right 0.5s ease-in-out;
        font-family: 'Inter', sans-serif;
        overflow: hidden;
    }
    #chat-panel.visible {
        right: 20px;
    }
    #chat-header {
        background-color: #007bff;
        color: white;
        padding: 12px 15px;
        border-top-left-radius: 15px;
        border-top-right-radius: 15px;
        display: flex;
        justify-content.space-between;
        align-items: center;
        font-size: 18px;
        font-weight: bold;
    }
    #chat-close-btn {
        background: none;
        border: none;
        color: white;
        font-size: 24px;
        cursor: pointer;
        padding: 0 5px;
    }
    #chat-new-btn {
        background-color: #6c757d;
        color: white;
        border: none;
        border-radius: 5px;
        padding: 5px 10px;
        cursor: pointer;
        font-size: 14px;
        margin-left: auto;
        margin-right: 10px;
    }
    #chat-new-btn:hover {
        background-color: #5a6268;
    }
    #chat-messages {
        flex-grow: 1;
        padding: 15px;
        overflow-y: auto;
        background-color: #f8f9fa;
        border-bottom: 1px solid #eee;
    }
    .chat-message {
        margin-bottom: 10px;
        display: flex;
        flex-direction: column;
        max-width: 85%;
    }
    .chat-message.user {
        align-self: flex-end;
        align-items: flex-end;
    }
    .chat-message.ai {
        align-self: flex-start;
        align-items: flex-start;
    }
    .chat-bubble {
        padding: 10px 15px;
        border-radius: 15px;
        line-height: 1.5;
        word-wrap: break-word;
        white-space: pre-wrap;
    }
    .chat-bubble.user {
        background-color: #007bff;
        color: white;
        border-bottom-right-radius: 2px;
    }
    .chat-bubble.ai {
        background-color: #e2e6ea;
        color: #333;
        border-bottom-left-radius: 2px;
    }
    #chat-input-container {
        display: flex;
        padding: 10px 15px;
        border-top: 1px solid #eee;
        background-color: white;
    }
    #chat-input {
        flex-grow: 1;
        border: 1px solid #ccc;
        border-radius: 20px;
        padding: 8px 15px;
        font-size: 14px;
        margin-right: 10px;
    }
    #chat-send-btn {
        background-color: #28a745;
        color: white;
        border: none;
        border-radius: 20px;
        padding: 8px 15px;
        cursor: pointer;
        font-size: 14px;
        font-weight: bold;
        transition: background-color 0.2s;
    }
    #chat-send-btn:hover {
        background-color: #218838;
    }
    #chat-send-btn:disabled {
        background-color: #cccccc;
        cursor: not-allowed;
    }
    .typing-indicator {
        font-style: italic;
        color: #666;
        margin-top: 5px;
        font-size: 13px;
    }
`;

// 注入CSS样式
const chatStyleSheet = document.createElement("style");
chatStyleSheet.type = "text/css";
chatStyleSheet.innerText = chatPanelStyles;
document.head.appendChild(chatStyleSheet);

// --- 创建HTML元素 (保持不变) ---
const chatPanel = document.createElement('div');
chatPanel.id = 'chat-panel';

const chatHeader = document.createElement('div');
chatHeader.id = 'chat-header';
chatHeader.innerHTML = `
    <span>AI对话</span>
    <button id="chat-new-btn">新对话</button>
    <button id="chat-close-btn">&times;</button>
`;

const chatMessagesDiv = document.createElement('div');
chatMessagesDiv.id = 'chat-messages';

const chatInputContainer = document.createElement('div');
chatInputContainer.id = 'chat-input-container';
chatInputContainer.innerHTML = `
    <input type="text" id="chat-input" placeholder="输入您的问题...">
    <button id="chat-send-btn">发送</button>
`;

chatPanel.appendChild(chatHeader);
chatPanel.appendChild(chatMessagesDiv);
chatPanel.appendChild(chatInputContainer);
document.body.appendChild(chatPanel);

// --- 获取元素引用 (保持不变) ---
const chatCloseBtn = document.getElementById('chat-close-btn');
const chatNewBtn = document.getElementById('chat-new-btn');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');

// --- 动态生成地图地点列表，用于AI的系统提示 ---
let mapLocationsList = '';
// 确保 allMarkersData 已经从 map.py 注入到全局变量
if (typeof allMarkersData !== 'undefined' && allMarkersData.length > 0) {
    mapLocationsList = allMarkersData.map(marker => `${marker.name} (${marker.year})`).join('；');
}

// --- 对话历史 (存储在前端) ---
// 初始系统消息，用于引导AI，并限制其知识范围到地图地点
// *** 关键修改：更严格的系统提示，强调客观性和范围限制 ***
const initialAiMessage = `您好！我是您的智能地图助手。我将为您提供本张地图上标记的地点（包括：${mapLocationsList}）及其相关的历史事件信息。请注意，我只会基于客观的历史事实进行介绍，不提供任何个人观点或政治评论。请您提出与这些地点直接相关的问题。如果问题超出我的职责范围或涉及敏感内容，我将无法回答，并会礼貌地提醒您。`;

let chatHistory = [{
    role: 'model',
    parts: [{ text: initialAiMessage }]
}];


// --- 辅助函数：显示消息 (保持不变) ---
function displayMessage(role, text) {
    const messageDiv = document.createElement('div');
    messageDiv.classList.add('chat-message', role);
    const bubbleDiv = document.createElement('div');
    bubbleDiv.classList.add('chat-bubble', role);
    bubbleDiv.innerHTML = text.replace(/\n/g, '<br>');
    messageDiv.appendChild(bubbleDiv);
    chatMessagesDiv.appendChild(messageDiv);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
}

// --- 辅助函数：显示AI正在输入提示 (保持不变) ---
let typingIndicatorElement = null;
function showTypingIndicator() {
    if (!typingIndicatorElement) {
        typingIndicatorElement = document.createElement('div');
        typingIndicatorElement.classList.add('chat-message', 'ai', 'typing-indicator');
        typingIndicatorElement.innerHTML = '<div class="chat-bubble ai">AI正在思考...</div>';
        chatMessagesDiv.appendChild(typingIndicatorElement);
        chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
    }
}

function hideTypingIndicator() {
    if (typingIndicatorElement) {
        typingIndicatorElement.remove();
        typingIndicatorElement = null;
    }
}

// --- 发送消息函数 (保持不变) ---
async function sendMessage() {
    const userMessage = chatInput.value.trim();
    if (userMessage === '') return;

    displayMessage('user', userMessage);
    chatHistory.push({ role: 'user', parts: [{ text: userMessage }] });
    chatInput.value = '';
    chatSendBtn.disabled = true;
    showTypingIndicator();

    try {
        const response = await fetch('http://localhost:5000/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: chatHistory }),
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const aiReply = data.text;

        hideTypingIndicator();
        displayMessage('ai', aiReply);
        chatHistory.push({ role: 'model', parts: [{ text: aiReply }] });

    } catch (error) {
        console.error('Error during AI chat:', error);
        hideTypingIndicator();
        displayMessage('ai', `<span style="color: red;">AI回复失败: ${error.message}</span>`);
    } finally {
        chatSendBtn.disabled = false;
        chatInput.focus();
    }
}

// --- 事件监听器 ---
chatCloseBtn.addEventListener('click', function() {
    chatPanel.classList.remove('visible');
});

chatNewBtn.addEventListener('click', function() {
    // 重置对话历史为初始系统消息
    chatHistory = [{ role: 'model', parts: [{ text: initialAiMessage }] }];
    chatMessagesDiv.innerHTML = ''; // 清空显示
    displayMessage('ai', initialAiMessage); // 显示欢迎消息
});

chatSendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keypress', function(event) {
    if (event.key === 'Enter' && !chatSendBtn.disabled) {
        sendMessage();
    }
});

// --- 初始显示欢迎消息 ---
// 页面加载时显示初始欢迎消息
document.addEventListener('DOMContentLoaded', () => {
    // 检查chatMessagesDiv是否为空，避免重复添加
    if (chatMessagesDiv.children.length === 0) {
        displayMessage('ai', initialAiMessage);
    }
});


// --- 全局函数：打开对话框 (供其他脚本调用) ---
function openChatPanel() {
    chatPanel.classList.add('visible');
    chatInput.focus();
}

