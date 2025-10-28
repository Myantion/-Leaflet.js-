window.onload = function() {
    // 1. 解析URL参数
    const params = new URLSearchParams(window.location.search);
    const lng = parseFloat(params.get('lng'));
    const lat = parseFloat(params.get('lat'));
    const name = decodeURIComponent(params.get('name') || '未知地点');
    const index = parseInt(params.get('index'), 10);

    // 2. 更新标题栏和创建悬停提示框
    document.getElementById('title-bar').textContent = name;
    const hoverPopup = document.createElement('div');
    hoverPopup.style.cssText = `
        position: absolute; display: none; background-color: rgba(0, 0, 0, 0.65);
        color: white; padding: 8px 12px; border-radius: 6px; font-size: 14px;
        white-space: nowrap; pointer-events: none; z-index: 100;
    `;
    hoverPopup.innerHTML = name;
    document.body.appendChild(hoverPopup);

    // 3. 检查坐标
    if (isNaN(lng) || isNaN(lat)) {
        document.getElementById('title-bar').textContent = '错误：缺少经纬度参数！';
        return;
    }

    const position = [lng, lat];
    const centerPoint = new AMap.LngLat(lng, lat);

    // 4. 创建主地图实例
    const map = new AMap.Map('container', {
        viewMode: '3D',
        pitch: 60,
        zoom: 17,
        center: position,
        isHotspot: true,
    });
    AMap.plugin('AMap.Scale', function(){
        const scale = new AMap.Scale();
        map.addControl(scale);
    });

    // 5. 创建右上角静态小地图
    const overviewMap = new AMap.Map('overview-map', {
        center: position,
        zoom: 12,
        dragEnable: false,
        zoomEnable: false,
        scrollWheel: false,
        doubleClickZoom: false,
        keyboardEnable: false,
        jogEnable: false,
        showIndoorMap: false,
        showLabel: false,
    });

    // 6. 在小地图上标注景点
    if (window.allMarkerLocations) {
        window.allMarkerLocations.forEach(function(markerData, markerIndex) {
            const point = new AMap.LngLat(markerData.location[1], markerData.location[0]);
            const distance = centerPoint.distance(point);

            if (distance <= 5000) {
                let markerColor = "#007BFF";
                let markerRadius = 4;
                if (markerIndex === index) {
                    markerColor = "#FF3333";
                    markerRadius = 6;
                }

                new AMap.CircleMarker({
                    center: point,
                    map: overviewMap,
                    radius: markerRadius,
                    strokeWeight: 0,
                    fillColor: markerColor,
                    fillOpacity: 0.9
                });
            }
        });
    }


    // --- 新增：动态创建并绑定“回到当前位置”按钮 ---
    const recenterBtn = document.createElement('button');
    recenterBtn.textContent = '回到当前位置';
    recenterBtn.style.cssText = `
        position: absolute;
        bottom: 20px;
        right: 20px; /* 定位在右下角 */
        z-index: 9999;
        padding: 8px 15px;
        font-size: 14px;
        background-color: rgba(255, 255, 255, 0.8);
        border: 1px solid #ccc;
        border-radius: 5px;
        cursor: pointer;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
    `;
    // 将按钮添加到页面
    document.body.appendChild(recenterBtn);

    // 为按钮绑定点击事件
    recenterBtn.addEventListener('click', function() {
        map.setZoomAndCenter(17, centerPoint, false, 1000);
    });
    // --- 新增功能结束 ---


    // 7. 主地图的图标判断和创建逻辑
    let markerIcon;
    const customIconPath = `icon/${index}.png`;
    const imgTest = new Image();
    imgTest.src = customIconPath;

    imgTest.onload = function() {
        markerIcon = new AMap.Icon({
            size: new AMap.Size(60, 60),
            image: customIconPath,
            imageSize: new AMap.Size(60, 60)
        });
        createMarker(markerIcon, new AMap.Pixel(-30, -60));
    };

    imgTest.onerror = function() {
        markerIcon = null;
        createMarker(markerIcon, new AMap.Pixel(-12, -34));
    };

    function createMarker(iconObject, offsetObject) {
        const marker = new AMap.Marker({
            position: position, map: map, icon: iconObject, offset: offsetObject
        });
        marker.on('mouseover', function(e) {
            try {
                const pixel = map.lngLatToContainer(e.lnglat);
                hoverPopup.style.left = pixel.getX() + 'px';
                hoverPopup.style.top = (pixel.getY() - 50) + 'px';
                hoverPopup.style.display = 'block';
            } catch(err) {
                console.error("设置悬停提示框位置时出错: ", err);
            }
        });
        marker.on('mouseout', function() {
            hoverPopup.style.display = 'none';
        });

        marker.on('click', function() {
            map.setZoomAndCenter(18, position, false, 1000);
        });
    }
};