// --- 动态创建AI面板和其样式 ---

// 1. 创建CSS样式并注入到<head>
const aiPanelStyles = `
    #ai-panel {
        position: fixed;
        top: 0;
        right: -100%; /* 默认隐藏在屏幕右侧 */
        width: 100%;
        height: 100%;
        background-color: rgba(0, 0, 0, 0.5); /* 半透明黑色背景 */
        z-index: 2000;
        transition: right 0.5s ease-in-out; /* 滑动动画 */
        display: flex;
        justify-content: center;
        align-items: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
    #ai-panel.visible {
        right: 0; /* 滑入屏幕 */
    }
    #ai-panel-content {
        background-color: white;
        color: #333;
        width: 80%;
        max-width: 800px;
        height: 80%;
        border-radius: 10px;
        padding: 20px 40px;
        box-shadow: 0 5px 15px rgba(0,0,0,0.3);
        position: relative;
        overflow-y: auto; /* 内容过多时可以滚动 */
        line-height: 1.7;
    }
    #ai-panel-close-btn {
        position: absolute;
        top: 15px;
        right: 20px;
        font-size: 30px;
        font-weight: bold;
        color: #aaa;
        cursor: pointer;
        border: none;
        background: none;
        padding: 0;
    }
    #ai-panel-close-btn:hover {
        color: #333;
    }
    #ai-panel-content h3 {
        text-align: center;
        margin-top: 10px;
    }
    #ai-panel-content p {
        font-size: 16px;
    }
`;
const styleSheet = document.createElement("style");
styleSheet.type = "text/css";
styleSheet.innerText = aiPanelStyles;
document.head.appendChild(styleSheet);

// 2. 创建HTML元素
const aiPanel = document.createElement('div');
aiPanel.id = 'ai-panel';

const aiPanelContent = document.createElement('div');
aiPanelContent.id = 'ai-panel-content';

const closeBtn = document.createElement('button');
closeBtn.id = 'ai-panel-close-btn';
closeBtn.innerHTML = '&times;'; // 一个漂亮的 "x" 叉

aiPanel.appendChild(aiPanelContent);
aiPanel.appendChild(closeBtn);
document.body.appendChild(aiPanel);


// --- AI交互逻辑 ---

// 3. 关闭按钮的点击事件
closeBtn.addEventListener('click', function() {
    aiPanel.classList.remove('visible');
});

// 点击半透明背景处也可以关闭面板
aiPanel.addEventListener('click', function(event) {
    if (event.target === aiPanel) {
        aiPanel.classList.remove('visible');
    }
});


// 4. “AI讲解”按钮的点击事件函数
// 修正参数顺序和名称，使其与map.py中onclick传递的参数一致
// map.py 传递的顺序是：索引 i, 地点名称 name, 年份 year
function getAiIntro(index, locationName, year) { // <-- 关键修正：参数列表现在是 (index, locationName, year)
    // a. 滑出面板并显示加载状态
    aiPanelContent.innerHTML = '<h4>AI导游正在思考中，请稍候...</h4>';
    aiPanel.classList.add('visible');

    // b. 调用后端获取AI讲解
    fetch('http://localhost:5000/api/get-ai-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 确保这里传递给后端的是正确的地点名称 (locationName) 和年份 (year)
        body: JSON.stringify({ name: locationName, year: year }), // <-- 关键修正：使用 locationName
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('服务器响应错误: ' + response.status);
        }
        return response.json();
    })
    .then(data => {
        if (data.error) {
            aiPanelContent.innerHTML = `<h3 style="color: red;">AI讲解失败</h3><hr><p>${data.error}</p>`;
        } else {
            // c. 将AI返回的文本填充到面板中
            // 显示时使用正确的地点名称 (locationName) 和年份 (year)
            aiPanelContent.innerHTML = `
                <h3>关于“${locationName}”(${year})</h3> <!-- <-- 关键修正：使用 locationName -->
                <hr>
                <p>${data.text}</p>
            `;
        }
    })
    .catch(error => {
        console.error('Error:', error);
        aiPanelContent.innerHTML = '<h3 style="color: red;">连接AI服务失败</h3><hr><p>请检查您的后端服务(ai.py)是否已启动，以及网络连接是否正常。</p>';
    });
}
