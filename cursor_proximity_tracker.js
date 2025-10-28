// cursor_proximity_tracker.js

// --- CSS 样式用于实时显示当前关注点 ---
// 这个UI元素依然保留，因为它能给用户提供即时反馈，显示离鼠标最近的“已知”POI。
// 这与后端识别“新热点”的目标不冲突，只是前端的即时反馈。
const cursorTrackerStyles = `
    #current-focus-display {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(0, 0, 0, 0.6);
        color: white;
        padding: 8px 15px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 1500; /* 确保在地图上方但低于其他主要UI */
        display: none; /* 初始隐藏 */
        pointer-events: none; /* 允许鼠标事件穿透 */
    }
`;
const cursorTrackerStyleSheet = document.createElement("style");
cursorTrackerStyleSheet.type = "text/css";
cursorTrackerStyleSheet.innerText = cursorTrackerStyles;
document.head.appendChild(cursorTrackerStyleSheet);

// --- 创建HTML元素用于实时显示 ---
const currentFocusDisplay = document.createElement('div');
currentFocusDisplay.id = 'current-focus-display';
document.body.appendChild(currentFocusDisplay);


// --- 全局变量和配置 ---
// 存储发送失败的数据点，作为重试缓冲区
let failedProximityDataBuffer = [];
const SAMPLE_INTERVAL_MS = 100; // 0.1秒采样间隔

// 定义亲近等级及其对应的分数贡献值 (这些等级现在主要用于前端UI显示，后端不依赖它们)
const PROXIMITY_LEVELS = [
    { min: 0, max: 200, score: 10 },    // 等级1: 0-200米，10分
    { min: 201, max: 600, score: 5 },   // 等级2: 201-600米，5分
    { min: 601, max: 1500, score: 3 }   // 等级3: 601-1500米，3分
    // 任何大于1500米的距离，将由 getProximityLevelScore 函数的默认值处理，返回1分
];

// 存储地图上所有标记点的数据，从 map.py 注入的全局变量 allMarkersData 获取
let mapLocations = [];
// DOMContentLoaded 确保 allMarkersData 在这里可用
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOMContentLoaded: Map locations loading...");
    // 假设 allMarkersData 是由 Python 脚本在生成 HTML 时注入到全局作用域的
    if (typeof allMarkersData !== 'undefined' && allMarkersData.length > 0) {
        mapLocations = allMarkersData.map(marker => ({
            name: marker.name,
            lat: marker.location[0],
            lon: marker.location[1]
        }));
        console.log("DOMContentLoaded: Map locations loaded:", mapLocations.length, "locations.");
    } else {
        console.warn("DOMContentLoaded: allMarkersData 未定义或为空，光标追踪器无法获取地图地点信息。");
    }
    // 初始隐藏显示框，直到鼠标移动
    currentFocusDisplay.style.display = 'none';
});


let lastClosestLocationName = null; // 用于UI显示，记录上次最近的地点名称
let currentSessionStartTime = Date.now(); // 记录会话开始时间
let sessionId = "user_session_" + Date.now(); // 会话ID，在整个会话中保持不变

// --- 辅助函数：计算两点之间的Haversine距离（米） ---
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // 地球半径，单位米
    const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // in meters
}

// --- 辅助函数：根据距离获取亲近等级的分数贡献值 (仅用于前端UI显示) ---
function getProximityLevelScore(distance_m) {
    for (const level of PROXIMITY_LEVELS) {
        if (distance_m >= level.min && distance_m <= level.max) {
            return level.score;
        }
    }
    // 如果距离超过所有定义等级的最大值，返回最低分数
    return 1;
}

// --- 异步函数：发送单个原始数据点到后端 ---
async function sendSingleRawDataPoint(dataPoint) {
    // 这里的 payload 结构现在更简单，只包含原始经纬度、时间戳和会话信息
    const payload = {
        session_id: sessionId,
        start_time: new Date(currentSessionStartTime).toISOString(), // 会话开始时间
        // 注意：这里 location_history 仍然是一个数组，但只包含一个数据点
        location_history: [{
            timestamp: dataPoint.timestamp,
            latitude: dataPoint.latitude,
            longitude: dataPoint.longitude
        }]
    };

    const jsonString = JSON.stringify(payload);

    // console.log(`Attempting to send single raw data point via fetch.`);
    // console.log("Single point payload size (chars):", jsonString.length);

    try {
        const controller = new AbortController();
        // 缩短超时时间，因为是实时发送，希望快速响应
        const id = setTimeout(() => controller.abort(), 2000); // 2秒超时

        const responsePromise = fetch('http://localhost:5000/api/save_session_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: jsonString,
            keepalive: true, // 尝试使用 keepalive，以增加在页面卸载时发送成功的可能性
            signal: controller.signal
        });

        const response = await Promise.race([
            responsePromise,
            new Promise((resolve, reject) => setTimeout(() => reject(new Error('Fetch timeout'))))
        ]);

        clearTimeout(id); // 清除超时定时器

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Single raw data point send failed:', response.status, errorText);
            // 如果发送失败，将原始数据点添加到重试缓冲区
            failedProximityDataBuffer.push(dataPoint);
            console.log(`Raw data point added to retry buffer. Buffer size: ${failedProximityDataBuffer.length}`);
        } else {
            const result = await response.json();
            // console.log('Single raw data point sent successfully:', result);
        }
    } catch (error) {
        console.error('Error sending single raw data point:', error.message);
        if (error.name === 'AbortError') {
            console.error('Fetch was aborted due to timeout.');
        }
        // 如果发送失败，将原始数据点添加到重试缓冲区
        failedProximityDataBuffer.push(dataPoint);
        console.log(`Raw data point added to retry buffer. Buffer size: ${failedProximityDataBuffer.length}`);
    }
}


// --- 核心：等待地图实例可用并直接附加事件监听器 ---
let mapInstanceCheckInterval = null;
const MAP_CHECK_INTERVAL_MS = 100; // 每100毫秒检查一次地图实例

function initializeCursorTracker() {
    let actualMapInstance = null;
    // 遍历 window 对象查找 folium 生成的地图实例 (通常以 map_ 开头)
    for (const key in window) {
        if (key.startsWith('map_') && typeof window[key] === 'object' && window[key].on) {
            actualMapInstance = window[key];
            break;
        }
    }

    if (actualMapInstance) {
        clearInterval(mapInstanceCheckInterval); // 找到地图实例，清除检查定时器
        console.log("Found map instance:", actualMapInstance.getContainer().id, ". Directly attaching mousemove listener.");

        let mouseMoveTimer = null; // 确保定时器是局部的，不会被外部覆盖

        actualMapInstance.on('mousemove', function(e) {
            // 清除之前的定时器，确保每 SAMPLE_INTERVAL_MS 触发一次
            if (mouseMoveTimer) {
                clearTimeout(mouseMoveTimer);
            }
            mouseMoveTimer = setTimeout(() => {
                const currentLat = e.latlng.lat;
                const currentLon = e.latlng.lng;
                const currentTimestamp = Date.now();

                let closestLocationName = "浏览中"; // 默认状态
                let minDistanceOverall = Infinity;

                // 这里的循环仅用于更新前端UI显示，不影响后端数据发送
                if (mapLocations.length > 0) {
                    mapLocations.forEach(loc => {
                        const dist = haversineDistance(currentLat, currentLon, loc.lat, loc.lon);
                        if (dist < minDistanceOverall) {
                            minDistanceOverall = dist;
                            closestLocationName = loc.name;
                        }
                    });
                } else {
                    console.warn("mapLocations is empty, cannot determine closest location for UI.");
                }

                // --- 核心逻辑：创建原始数据点并立即尝试发送 ---
                const currentRawDataPoint = {
                    timestamp: currentTimestamp,
                    latitude: currentLat,
                    longitude: currentLon
                    // 注意：这里不再包含 proximity_scores_at_this_point
                };

                sendSingleRawDataPoint(currentRawDataPoint); // 立即发送此原始数据点

                // --- 更新实时显示 UI ---
                let displayMessage = `当前关注: ${closestLocationName} (${minDistanceOverall.toFixed(0)}m)`;
                currentFocusDisplay.textContent = displayMessage;
                currentFocusDisplay.style.display = 'block';

            }, SAMPLE_INTERVAL_MS);
        });
    }
}

// 启动周期性检查，直到找到地图实例
mapInstanceCheckInterval = setInterval(initializeCursorTracker, MAP_CHECK_INTERVAL_MS);


// --- 页面卸载时发送剩余数据 (作为最后保障) ---
window.addEventListener('beforeunload', async function(e) {
    console.log("beforeunload event triggered. Attempting to send remaining data from buffer.");

    if (failedProximityDataBuffer.length === 0) {
        console.warn("failedProximityDataBuffer is empty, no remaining data to send on unload.");
        return; // 没有数据可发送
    }

    // 格式化数据以匹配 Python 后端期望的 JSON 结构
    // 这里的 location_history 包含所有发送失败的原始数据点
    const sessionData = {
        session_id: sessionId, // 使用会话开始时生成的唯一ID
        start_time: new Date(currentSessionStartTime).toISOString(),
        end_time: new Date(Date.now()).toISOString(),
        location_history: failedProximityDataBuffer // 发送所有剩余的原始数据
    };

    const jsonString = JSON.stringify(sessionData);

    console.log("Attempting to send remaining session data on unload via blocking fetch.");
    console.log("Remaining payload size (chars):", jsonString.length);

    try {
        // 卸载时的超时可以稍微长一点，但仍需谨慎
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 5000); // 5秒超时

        const responsePromise = fetch('http://localhost:5000/api/save_session_data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: jsonString,
            keepalive: true, // 仍然使用 keepalive
            signal: controller.signal
        });

        const response = await Promise.race([
            responsePromise,
            new Promise((resolve, reject) => setTimeout(() => reject(new Error('Fetch timeout'))))
        ]);

        clearTimeout(id); // 清除超时定时器

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Remaining data send failed on unload:', response.status, errorText);
        } else {
            const result = await response.json();
            console.log('Remaining data sent successfully on unload:', result);
        }
    } catch (error) {
        console.error('Error sending remaining data on unload:', error.message);
        if (error.name === 'AbortError') {
            console.error('Fetch was aborted due to timeout.');
        }
    }
});
