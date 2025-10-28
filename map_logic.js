// This script contains the core logic for map interactions, including
// dropdown selection, timeline playback, and custom UI element positioning.

// --- Global Variables ---
let playbackTimer = null; // 全局定时器变量，用于控制自动播放
let playbackSpeed = 4000; // 4 seconds per marker (在标记点停留的时间)
let isPlaying = false;
let map; // A global reference to the Leaflet map object
let allPlaybackMarkers = []; // An ordered list of all markers for playback
let currentPlaybackIndex = 0; // 当前播放的标记点索引，用于全局播放
let isProgrammaticMove = false; // Flag for programmatic map movements
let currentAnimationId = null; // For requestAnimationFrame
let currentPathLine = null; // To track the red dashed line
let pathLineStartLatLng = null; // Start coordinates for the dashed line
let pathLineTargetLatLng = null; // Target coordinates for the dashed line
let animationStartTime = 0;
let totalAnimationDuration = 0;
let currentAnimationPromiseResolve = null;
let manualMoveThreshold = 500; // Distance threshold for manual move detection (meters)
let lineSpeedPxPerSecond = 1000; // Speed of the dashed line extension (pixels/second)
let playbackZoomLevel = 17; // Standard zoom level during playback
let longDistanceThreshold = 6000; // Long-distance threshold (meters)
let longDistanceZoomOutLevel = 13; // Long-distance zoom-out level
let lastManualMoveCheckCenter = null;
let lastMKeyTime = 0; // 修复: 重新添加 M 键的冷却时间变量

// 强制停止 Leaflet 地图上的所有动画和相关状态
function stopMapAnimation() {
    if (currentAnimationId) {
        cancelAnimationFrame(currentAnimationId);
        currentAnimationId = null;
        console.log("强制停止了动画循环。");
    }
    if (currentAnimationPromiseResolve) {
        currentAnimationPromiseResolve();
        currentAnimationPromiseResolve = null;
    }
    isProgrammaticMove = false; // Reset the flag
    removePathLine(); // Always remove the line when stopping
    pathLineStartLatLng = null;
    pathLineTargetLatLng = null;
}

// 移除路径线
function removePathLine() {
    if (map && currentPathLine) {
        map.removeLayer(currentPathLine);
        currentPathLine = null;
        console.log("路径线已移除。");
    }
}

// 核心动画循环：使用 requestAnimationFrame 控制平移和虚线延伸
function animatePanAndLine(timestamp) {
    if (!isProgrammaticMove) {
        stopMapAnimation();
        return;
    }

    if (!animationStartTime) {
        animationStartTime = timestamp;
    }
    let elapsedTime = timestamp - animationStartTime;
    let progress = Math.min(1, elapsedTime / totalAnimationDuration);

    if (!pathLineStartLatLng || !pathLineTargetLatLng) {
        console.error("路径线坐标未设置，停止动画循环。");
        stopMapAnimation();
        return;
    }

    const startPoint = map.latLngToLayerPoint(pathLineStartLatLng);
    const targetPoint = map.latLngToLayerPoint(pathLineTargetLatLng);

    const interpolatedX = startPoint.x + (targetPoint.x - startPoint.x) * progress;
    const interpolatedY = startPoint.y + (targetPoint.y - startPoint.y) * progress;

    const interpolatedLatLng = map.layerPointToLatLng(L.point(interpolatedX, interpolatedY));

    map.panTo(interpolatedLatLng, { animate: false });

    if (currentPathLine) {
        currentPathLine.setLatLngs([pathLineStartLatLng, interpolatedLatLng]);
    }

    if (progress < 1) {
        currentAnimationId = requestAnimationFrame(animatePanAndLine);
    } else {
        isProgrammaticMove = false;
        removePathLine();
        if (currentAnimationPromiseResolve) {
            currentAnimationPromiseResolve();
            currentAnimationPromiseResolve = null;
        }
        console.log("平移动画已完成。");
    }
}

// 重构 animateToMarker，区分是播放动画还是点击跳转
async function animateToMarker(markerData, duration = 3, prevMarkerData = null, isPlayback = false, initialZoom = null) {
    if (!markerData || !markerData.location) {
        console.error("animateToMarker: 无效的标记点数据或位置。");
        return Promise.resolve();
    }

    const newCenter = L.latLng(markerData.location[0], markerData.location[1]);

    stopMapAnimation(); // 在开始新动画前强制停止任何旧动画

    const currentCenter = map.getCenter();
    const distance = currentCenter.distanceTo(newCenter);
    if (distance < 1 && (initialZoom === null || map.getZoom() >= initialZoom - 1)) {
        return Promise.resolve();
    }

    if (isPlayback) {
        console.log(`播放中，正在平移到: ${markerData.name} (${markerData.year})`);

        if (currentPlaybackIndex === 0 || distance < 50) {
            console.log("播放第一个标记点或距离很近，直接平移不绘制红线。");
            return new Promise(resolve => {
                isProgrammaticMove = true;
                map.flyTo(newCenter, playbackZoomLevel, {
                    duration: 1.5
                });
                map.once('moveend', () => {
                    isProgrammaticMove = false;
                    resolve();
                });
            });
        }

        const startPointForAnimation = map.getCenter();
        const moveDistance = startPointForAnimation.distanceTo(newCenter);

        if (moveDistance > longDistanceThreshold) {
            console.log(`检测到长距离移动 (${moveDistance.toFixed(0)}米 > ${longDistanceThreshold}米)，先缩小地图。`);
            await new Promise(resolve => {
                isProgrammaticMove = true;
                map.flyTo(map.getCenter(), longDistanceZoomOutLevel, {
                    duration: 1.5
                });
                map.once('moveend', () => {
                    isProgrammaticMove = false;
                    resolve();
                });
            });
        }

        await new Promise(resolve => {
            currentAnimationPromiseResolve = resolve;
            removePathLine();

            pathLineStartLatLng = map.getCenter();
            pathLineTargetLatLng = newCenter;

            const startPoint = map.latLngToLayerPoint(pathLineStartLatLng);
            const targetPoint = map.latLngToLayerPoint(pathLineTargetLatLng);
            const pixelDistance = startPoint.distanceTo(targetPoint);
            totalAnimationDuration = (pixelDistance / lineSpeedPxPerSecond) * 1000;
            animationStartTime = 0;

            currentPathLine = L.polyline([pathLineStartLatLng, pathLineStartLatLng], {
                color: 'red',
                weight: 4,
                opacity: 0.8,
                dashArray: '10, 10'
            }).addTo(map);

            console.log(`已绘制动态延伸路径线并开始动态更新，预计时长: ${(totalAnimationDuration/1000).toFixed(1)}秒。`);

            isProgrammaticMove = true;
            currentAnimationId = requestAnimationFrame(animatePanAndLine);

            setTimeout(() => {
                if(isProgrammaticMove) {
                    console.warn("动画超时，强制停止。");
                    stopMapAnimation();
                }
            }, totalAnimationDuration + 2000);
        });

        await new Promise(resolve => {
            console.log(`平移完成，正在缩放回标准级别 ${playbackZoomLevel}。`);
            isProgrammaticMove = true;
            map.flyTo(newCenter, playbackZoomLevel, {
                duration: 1
            });
            map.once('moveend', () => {
                isProgrammaticMove = false;
                resolve();
            });
        });
    } else {
        console.log(`点击跳转，正在缩放平移到: ${markerData.name} (${markerData.year})，动画持续 ${duration} 秒。`);
        removePathLine();
        isProgrammaticMove = true;
        return new Promise(resolve => {
            map.flyTo(newCenter, initialZoom || playbackZoomLevel, {
                duration: duration
            });
            map.once('moveend', () => {
                isProgrammaticMove = false;
                resolve();
            });
        });
    }
}

function findMarkerByLatLon(lat, lon) {
    let foundMarker = null;
    if (!map) {
        console.error("Map object is not initialized.");
        return null;
    }
    map.eachLayer(layer => {
        if (layer instanceof L.Marker) {
            if (Math.abs(layer.getLatLng().lat - lat) < 0.000001 && Math.abs(layer.getLatLng().lng - lon) < 0.000001) {
                foundMarker = layer;
            }
        }
    });
    return foundMarker;
}

function updateActiveTimelineItem(year) {
    const timelineItems = document.querySelectorAll('.timeline-item');
    timelineItems.forEach(item => {
        if (item.dataset.year === year) {
            item.classList.add('active');
            const timelineScroll = document.getElementById('map-timeline');
            if (timelineScroll) {
                const itemRect = item.getBoundingClientRect();
                const containerRect = timelineScroll.getBoundingClientRect();
                const scrollLeft = itemRect.left - containerRect.left + timelineScroll.scrollLeft - (containerRect.width / 2) + (itemRect.width / 2);
                timelineScroll.scrollTo({
                    left: scrollLeft,
                    behavior: 'smooth'
                });
            }
        } else {
            item.classList.remove('active');
        }
    });
}

function pausePlayback() {
    if (!isPlaying) return;
    clearTimeout(playbackTimer);
    isPlaying = false;
    document.getElementById('playback-start-btn').style.display = 'block';
    document.getElementById('playback-stop-btn').style.display = 'none';
    stopMapAnimation();
    console.log("播放已暂停。");
}

function resetPlayback() {
    pausePlayback();
    currentPlaybackIndex = 0;
    document.querySelectorAll('.timeline-item').forEach(item => {
        item.classList.remove('active');
    });
    removePathLine();
    pathLineStartLatLng = null;
    pathLineTargetLatLng = null;
}

async function startGlobalPlayback() {
    if (isPlaying) return;

    isPlaying = true;
    document.getElementById('playback-start-btn').style.display = 'none';
    document.getElementById('playback-stop-btn').style.display = 'block';

    if (currentPlaybackIndex >= allPlaybackMarkers.length) {
        currentPlaybackIndex = 0;
        document.querySelectorAll('.timeline-item').forEach(item => item.classList.remove('active'));
    }

    removePathLine();

    const playNextMarker = async () => {
        if (!isPlaying) {
            console.log("播放已暂停。");
            return;
        }

        if (currentPlaybackIndex < allPlaybackMarkers.length) {
            const marker = allPlaybackMarkers[currentPlaybackIndex];
            const currentYear = marker.year;
            updateActiveTimelineItem(currentYear);

            const prevMarker = currentPlaybackIndex > 0 ? allPlaybackMarkers[currentPlaybackIndex - 1] : null;

            await animateToMarker(marker, 5, prevMarker, true);

            const markerObject = findMarkerByLatLon(marker.location[0], marker.location[1]);
            if (markerObject) {
                markerObject.openPopup();
            }

            console.log(`在 ${marker.name} 停留 ${playbackSpeed / 1000} 秒...`);

            playbackTimer = setTimeout(() => {
                let lastMarkerIndexForYear = currentPlaybackIndex;
                while (lastMarkerIndexForYear + 1 < allPlaybackMarkers.length && allPlaybackMarkers[lastMarkerIndexForYear + 1].year === currentYear) {
                    lastMarkerIndexForYear++;
                }

                if (currentPlaybackIndex === lastMarkerIndexForYear) {
                    let nextMarkerIndex = lastMarkerIndexForYear + 1;
                    while (nextMarkerIndex < allPlaybackMarkers.length && allPlaybackMarkers[nextMarkerIndex].year === null) {
                        nextMarkerIndex++;
                    }
                    if (nextMarkerIndex < allPlaybackMarkers.length) {
                        currentPlaybackIndex = nextMarkerIndex;
                        playNextMarker();
                    } else {
                        resetPlayback();
                        console.log("所有标记点播放完毕。");
                    }
                } else {
                    currentPlaybackIndex++;
                    playNextMarker();
                }
            }, playbackSpeed);
        } else {
            resetPlayback();
            console.log("所有标记点播放完毕。");
        }
    };

    playNextMarker();
}

function playMarkersForYear(year) {
    pausePlayback();
    const startIndexForYear = allPlaybackMarkers.findIndex(marker => marker.year === year);
    if (startIndexForYear === -1) {
        console.warn(`未找到 ${year} 年的标记点。`);
        return;
    }
    currentPlaybackIndex = startIndexForYear;
    const markerToAnimate = allPlaybackMarkers[currentPlaybackIndex];
    const currentCenter = map.getCenter();
    const targetLatLng = L.latLng(markerToAnimate.location[0], markerToAnimate.location[1]);
    const distance = currentCenter.distanceTo(targetLatLng);

    if (distance > 50 || map.getZoom() < 15) {
        animateToMarker(markerToAnimate, 1.5, null, false, 17).then(() => {
            const markerObject = findMarkerByLatLon(markerToAnimate.location[0], markerToAnimate.location[1]);
            if (markerObject) {
                markerObject.openPopup();
            }
        });
    } else {
        console.log(`点击年份，已在目标位置 (${markerToAnimate.name})，跳过平移动画。`);
        const markerObject = findMarkerByLatLon(markerToAnimate.location[0], markerToAnimate.location[1]);
        if (markerObject) {
            markerObject.openPopup();
        }
    }
    updateActiveTimelineItem(markerToAnimate.year);
    console.log(`已跳转到 ${year} 年的第一个标记点，播放已暂停。请点击播放按钮继续。`);
}

document.addEventListener('DOMContentLoaded', function() {
    var mapContainer = document.querySelector('.folium-map');
    if (!mapContainer) {
        console.error("Map container not found in the DOM.");
        return;
    }

    var mapId = mapContainer.id;
    var mainMap = window[mapId];

    if (!mainMap) {
        console.error("Leaflet map object not found in the global scope.");
        return;
    }

    map = mainMap;

    mainMap.whenReady(function() {
        removePathLine();

        if (window.allMarkersWithYear) {
            allPlaybackMarkers = window.allMarkersWithYear.slice().sort((a, b) => {
                const yearA = parseInt(a.year);
                const yearB = parseInt(b.year);
                if (yearA === yearB) {
                    return window.allMarkersWithYear.indexOf(a) - window.allMarkersWithYear.indexOf(b);
                }
                return yearA - yearB;
            });

            const uniqueYears = [...new Set(allPlaybackMarkers.map(marker => marker.year))].filter(year => year !== null).sort((a, b) => parseInt(a) - parseInt(b));
            const timelineContainer = document.getElementById('timeline-container');
            if (timelineContainer) {
                timelineContainer.innerHTML = '';
                uniqueYears.forEach((year, index) => {
                    const item = document.createElement('div');
                    item.className = 'timeline-item';
                    item.dataset.year = year;
                    item.innerHTML = `
                        <div class="timeline-dot"></div>
                        <div class="timeline-year">${year}</div>
                    `;
                    item.addEventListener('click', () => {
                        const selectedYear = item.dataset.year;
                        playMarkersForYear(selectedYear);
                    });
                    timelineContainer.appendChild(item);

                    if (index < uniqueYears.length - 1) {
                        const connector = document.createElement('div');
                        connector.className = 'timeline-connector';
                        timelineContainer.appendChild(connector);
                    }
                });
            }
        }

        // --- 悬停弹窗容器 ---
        var hoverPopup = L.DomUtil.create('div', 'custom-hover-popup');
        hoverPopup.style.cssText = `
            position: absolute;
            display: none;
            z-index: 99999;
            background-color: rgba(255, 255, 255, 0.75);
            color: black;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 14px;
            max-width: 400px;
            pointer-events: none;
            transform: translate(-50%, -100%);
            box-shadow: 0 2px 8px rgba(0,0,0,0.4);
            transition: opacity 0.2s ease-in-out;
            opacity: 0;
            user-select: none;
        `;
        mapContainer.appendChild(hoverPopup);

        var hoverTimer;

        function stripHtml(html) {
            var doc = new DOMParser().parseFromString(html, 'text/html');
            return doc.body.textContent || "";
        }

        function getMarkerName(marker) {
            if (marker._tooltip && marker._tooltip._content) {
                return stripHtml(marker._tooltip._content);
            }
            if (marker._popup && marker._popup._content) {
                const content = marker._popup._content;
                if (typeof content === 'string') {
                    const match = content.match(/<b>(.*?)<\/b>/);
                    if (match && match[1]) {
                        return stripHtml(match[1]);
                    }
                }
            }
            return null;
        }

        function showHoverPopup(latlng, layer) {
            var content = '';
            var names = [];
            if (layer.getAllChildMarkers) {
                var childMarkers = layer.getAllChildMarkers();
                childMarkers.forEach(function(marker) {
                    const name = getMarkerName(marker);
                    if (name) {
                        names.push(name.trim());
                    }
                });
            } else if (layer instanceof L.Marker) {
                const name = getMarkerName(layer);
                if (name) {
                    names.push(name.trim());
                }
            }

            if (names.length > 0) {
                content = [...new Set(names)].join(', ');
            } else {
                content = '名称信息缺失';
            }
            hoverPopup.innerHTML = content;
            var pixelPoint = mainMap.latLngToContainerPoint(latlng);
            hoverPopup.style.left = pixelPoint.x + 'px';
            hoverPopup.style.top = pixelPoint.y + 'px';
            hoverPopup.style.display = 'block';
            hoverPopup.style.opacity = '1';
        }

        function hideHoverPopup() {
            hoverPopup.style.opacity = '0';
            setTimeout(function() {
                hoverPopup.style.display = 'none';
            }, 200);
        }

        mainMap.eachLayer(function(layer) {
            if (layer instanceof L.Marker) {
                layer.on('click', function(e) {
                    pausePlayback();
                    const markerLocation = [e.latlng.lat, e.latlng.lng];
                    const markerData = allPlaybackMarkers.find(m => m.location[0] === markerLocation[0] && m.location[1] === markerLocation[1]);
                    if (markerData) {
                        const index = allPlaybackMarkers.indexOf(markerData);
                        if (index !== -1) {
                            currentPlaybackIndex = index;
                            const currentCenter = map.getCenter();
                            const targetLatLng = L.latLng(markerData.location[0], markerData.location[1]);
                            const distance = currentCenter.distanceTo(targetLatLng);
                            if (distance > 50 || map.getZoom() < 15) {
                                animateToMarker(markerData, 1.5, null, false, 17).then(() => {
                                    const markerObject = findMarkerByLatLon(markerData.location[0], markerData.location[1]);
                                    if (markerObject) {
                                        markerObject.openPopup();
                                    }
                                });
                            } else {
                                console.log(`点击Marker，已在目标位置 (${markerData.name})，跳过平移动画。`);
                                const markerObject = findMarkerByLatLon(markerData.location[0], markerData.location[1]);
                                if (markerObject) {
                                    markerObject.openPopup();
                                }
                            }
                            updateActiveTimelineItem(markerData.year);
                        }
                    }
                });
                layer.on('mouseover', function(e) {
                    clearTimeout(hoverTimer);
                    hoverTimer = setTimeout(function() {
                        showHoverPopup(e.latlng, e.target);
                    }, 500);
                });
                layer.on('mouseout', function() {
                    clearTimeout(hoverTimer);
                    hideHoverPopup();
                });
            } else if (layer instanceof L.MarkerClusterGroup) {
                layer.on('click', function(e) {
                    pausePlayback();
                    let clickedMarkerData = null;
                    if (e.layer && e.layer.getAllChildMarkers) {
                        const childMarkers = e.layer.getAllChildMarkers();
                        if (childMarkers.length > 0) {
                            const firstChildLatLng = childMarkers[0].getLatLng();
                            clickedMarkerData = allPlaybackMarkers.find(m => m.location[0] === firstChildLatLng.lat && m.location[1] === firstChildLatLng.lng);
                        }
                    } else {
                        clickedMarkerData = allPlaybackMarkers.find(m => m.location[0] === e.latlng.lat && m.location[1] === e.latlng.lng);
                    }

                    if (clickedMarkerData) {
                        const index = allPlaybackMarkers.indexOf(clickedMarkerData);
                        if (index !== -1) {
                            currentPlaybackIndex = index;
                            const currentCenter = map.getCenter();
                            const targetLatLng = L.latLng(clickedMarkerData.location[0], clickedMarkerData.location[1]);
                            const distance = currentCenter.distanceTo(targetLatLng);
                            if (distance > 50 || map.getZoom() < 15) {
                                animateToMarker(clickedMarkerData, 1.5, null, false, 17).then(() => {
                                    const markerObject = findMarkerByLatLon(clickedMarkerData.location[0], clickedMarkerData.location[1]);
                                    if (markerObject) {
                                        markerObject.openPopup();
                                    }
                                });
                            } else {
                                console.log(`点击Cluster，已在目标位置 (${clickedMarkerData.name})，跳过平移动画。`);
                                const markerObject = findMarkerByLatLon(clickedMarkerData.location[0], clickedMarkerData.location[1]);
                                if (markerObject) {
                                    markerObject.openPopup();
                                }
                            }
                            updateActiveTimelineItem(clickedMarkerData.year);
                        }
                    }
                });
                layer.on('clustermouseover', function(e) {
                    clearTimeout(hoverTimer);
                    hoverTimer = setTimeout(function() {
                        showHoverPopup(e.latlng, e.layer);
                    }, 500);
                });
                layer.on('clustermouseout', function() {
                    clearTimeout(hoverTimer);
                    hideHoverPopup();
                });
            }
        });

        // --- 整合播放按钮逻辑 ---
        const playbackStartBtn = document.getElementById('playback-start-btn');
        const playbackStopBtn = document.getElementById('playback-stop-btn');
        if (playbackStartBtn && playbackStopBtn) {
            playbackStartBtn.addEventListener('click', () => startGlobalPlayback());
            playbackStopBtn.addEventListener('click', pausePlayback);
        } else {
            console.error("Playback buttons not found.");
        }

        // --- 监听地图缩放事件并暂停播放 ---
        mainMap.on('zoomstart', function() {
            if (isPlaying && !isProgrammaticMove) {
                pausePlayback();
                console.log("检测到手动缩放操作（如鼠标滚轮），自动播放已暂停。");
            }
        });

        mainMap.on('movestart', function() {
            if (isPlaying && !isProgrammaticMove) {
                lastManualMoveCheckCenter = map.getCenter();
            }
        });

        mainMap.on('move', function() {
            if (isPlaying && !isProgrammaticMove && lastManualMoveCheckCenter) {
                const currentCenter = map.getCenter();
                const distanceMoved = currentCenter.distanceTo(lastManualMoveCheckCenter);
                if (distanceMoved > manualMoveThreshold) {
                    pausePlayback();
                    stopMapAnimation();
                    console.log(`检测到手动平移操作，移动距离: ${distanceMoved.toFixed(2)}米，已超过阈值 ${manualMoveThreshold}米，自动播放已暂停。`);
                }
            }
        });

        mainMap.on('moveend', function() {
            lastManualMoveCheckCenter = null;
        });

        // --- 现有功能的整合 ---
        var customSelectContainer = document.getElementById('custom-select');
        var dynamicLegend = document.getElementById('dynamic-legend');
        var globalViewButton = document.querySelector('.global-view-button');
        var devInfoButton = document.querySelector('.dev-info-button');
        var guideButton = document.querySelector('.guide-button');
        var overviewMapContainer = document.querySelector('.overview-map-container');
        var mapTimeline = document.getElementById('map-timeline');
        var playbackButtonContainer = document.querySelector('.playback-button-container');

        var guideModal = document.querySelector('.guide-modal');
        var guideCloseButton = guideModal ? guideModal.querySelector('.close-button') : null;

        if (guideButton) {
            guideButton.addEventListener('click', function() {
                if (guideModal) guideModal.style.display = 'flex';
            });
        } else {
            console.error("Guide button not found.");
        }

        if (guideCloseButton) {
            guideCloseButton.addEventListener('click', function() {
                if (guideModal) guideModal.style.display = 'none';
            });
        }

        if (guideModal) {
            guideModal.addEventListener('click', function(event) {
                if (event.target == guideModal) {
                    guideModal.style.display = 'none';
                }
            });
        }

        mainMap.on('enterFullscreen', function() {
            if (guideButton) {
                guideButton.originalStyle = guideButton.style.cssText;
                mapContainer.appendChild(guideButton);
                guideButton.style.top = '10px';
                guideButton.style.right = '320px';
            }
            if (customSelectContainer) mapContainer.appendChild(customSelectContainer);
            if (dynamicLegend) mapContainer.appendChild(dynamicLegend);
            if (globalViewButton) mapContainer.appendChild(globalViewButton);
            if (devInfoButton) mapContainer.appendChild(devInfoButton);
            if (overviewMapContainer) mapContainer.appendChild(overviewMapContainer);
            if (mapTimeline) mapContainer.appendChild(mapTimeline);
            if (playbackButtonContainer) {
                mapContainer.appendChild(playbackButtonContainer);
                playbackButtonContainer.style.position = 'fixed';
                playbackButtonContainer.style.top = '50%';
                playbackButtonContainer.style.right = '20px';
                playbackButtonContainer.style.transform = 'translateY(-50%)';
                playbackButtonContainer.style.zIndex = '10000000';
            }

            if (customSelectContainer) { customSelectContainer.style.top = '10px'; customSelectContainer.style.left = '50%'; }
            if (dynamicLegend) { dynamicLegend.style.bottom = '50px'; dynamicLegend.style.left = '10px'; }
            if (globalViewButton) { globalViewButton.style.top = '10px'; globalViewButton.style.right = '210px'; }
            if (devInfoButton) { devInfoButton.style.top = '10px'; devInfoButton.style.right = '100px'; }
            if (overviewMapContainer) { overviewMapContainer.style.top = '10px'; overviewMapContainer.style.left = '10px'; }
            if (mapTimeline) { mapTimeline.style.bottom = '20px'; mapTimeline.style.left = '50%'; }
        });

        mainMap.on('exitFullscreen', function() {
            if (customSelectContainer) document.body.appendChild(customSelectContainer);
            if (dynamicLegend) document.body.appendChild(dynamicLegend);
            if (globalViewButton) document.body.appendChild(globalViewButton);
            if (devInfoButton) document.body.appendChild(devInfoButton);
            if (overviewMapContainer) document.body.appendChild(overviewMapContainer);
            if (mapTimeline) document.body.appendChild(mapTimeline);

            if (playbackButtonContainer) {
                document.body.appendChild(playbackButtonContainer);
                playbackButtonContainer.style.position = 'fixed';
                playbackButtonContainer.style.top = '50%';
                playbackButtonContainer.style.right = '10px';
                playbackButtonContainer.style.transform = 'translateY(-50%)';
                playbackButtonContainer.style.zIndex = '10000000';
            }

            if (guideButton) {
                document.body.appendChild(guideButton);
                if (guideButton.originalStyle) {
                    guideButton.style.cssText = guideButton.originalStyle;
                }
            }
        });

        // 限制地图边界
        var changsha_bounds = [[27.6, 111.6], [29.0, 114.6]];
        var southWest = L.latLng(changsha_bounds[0][0], changsha_bounds[0][1]);
        var northEast = L.latLng(changsha_bounds[1][0], changsha_bounds[1][1]);
        var bounds = L.latLngBounds(southWest, northEast);
        mainMap.setMaxBounds(bounds);
        mainMap.on('move', function() {
            var currentCenter = mainMap.getCenter();
            if (!bounds.contains(currentCenter)) {
                mainMap.panInsideBounds(bounds, { animate: false });
            }
        });

        // 图例显示/隐藏逻辑
        var legendGeojsonItem = document.getElementById('legend-item-geojson');
        var geojsonLayerName = '长沙市行政区划边界';

        mainMap.on('overlayadd', function(event) {
            if (event.name === geojsonLayerName) {
                if (legendGeojsonItem) legendGeojsonItem.style.display = 'block';
            }
        });
        mainMap.on('overlayremove', function(event) {
            if (event.name === geojsonLayerName) {
                if (legendGeojsonItem) legendGeojsonItem.style.display = 'none';
            }
        });

        mainMap.whenReady(function() {
            if (legendGeojsonItem) {
                var isGeojsonLayerInitiallyVisible = false;
                mainMap.eachLayer(function(layer) {
                    if (layer.options && layer.options.name === geojsonLayerName) {
                        if (mainMap.hasLayer(layer)) {
                            isGeojsonLayerInitiallyVisible = true;
                        }
                    }
                });
                legendGeojsonItem.style.display = isGeojsonLayerInitiallyVisible ? 'block' : 'none';
            }
        });

        // 弹窗打开时平移缩放
        mainMap.on('popupopen', function(e) {
            if (e.popup._source instanceof L.Marker) {
                var marker = e.popup._source;
                var newCenter = marker.getLatLng();
                var newZoom = 18;
                if (mainMap.getZoom() < newZoom) {
                    isProgrammaticMove = true;
                    mainMap.flyTo(newCenter, newZoom, {
                        duration: 1.5
                    });
                    mainMap.once('moveend', () => {
                        isProgrammaticMove = false;
                    });
                }
            }
        });

        // --- 概览小地图逻辑 ---
        var overviewMapContainer = document.querySelector('.overview-map-container');
        if (overviewMapContainer) {
            var overviewMap = L.map(overviewMapContainer, {
                zoomControl: false,
                attributionControl: false,
                dragging: false,
                scrollWheelZoom: false,
                doubleClickZoom: false,
                boxZoom: false,
                keyboard: false,
                tap: false,
                touchZoom: false,
            });
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
                attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions">CARTO</a>',
                maxZoom: 18,
                minZoom: 10
            }).addTo(overviewMap);
            var centerMarker = L.circleMarker([0, 0], {
                radius: 5,
                color: 'red',
                fillColor: 'red',
                fillOpacity: 1,
                weight: 2
            }).addTo(overviewMap);
            if (window.allMarkersData && window.allMarkersData.length > 0) {
                window.allMarkersData.forEach(function(markerData) {
                    L.circleMarker(markerData.location, {
                        radius: 3,
                        color: 'blue',
                        fillColor: 'blue',
                        fillOpacity: 1,
                        weight: 1
                    }).addTo(overviewMap);
                });
            } else {
                console.warn('未找到标记点原始数据 (window.allMarkersData) 来初始化小地图上的标记。');
            }
            mainMap.on('mousemove', function(e) {
                overviewMap.setView(e.latlng, 13);
                centerMarker.setLatLng(e.latlng);
            });
            mainMap.on('zoom', function() {
                overviewMap.setView(mainMap.getCenter(), 12);
            });
        } else {
            console.error("Overview map container not found in the DOM.");
        }

        // 全局显示按钮逻辑
        var globalViewButton = document.querySelector('.global-view-button');
        if (globalViewButton) {
            globalViewButton.onclick = function() {
                pausePlayback();
                isProgrammaticMove = true;
                if (window.clusteredLocations && window.clusteredLocations.length > 0) {
                    var allLatLngs = window.clusteredLocations.map(function(loc) {
                        return L.latLng(loc[0], loc[1]);
                    });
                    var boundsToFit = L.latLngBounds(allLatLngs);
                    mainMap.flyToBounds(boundsToFit, { padding: L.point(50, 50), maxZoom: 15, duration: 1.5 });
                }
                mainMap.once('moveend', () => {
                    isProgrammaticMove = false;
                });
            };
        }

        // 开发者介绍弹窗逻辑
        var devInfoButton = document.querySelector('.dev-info-button');
        if (devInfoButton) {
            var devInfoModal = L.DomUtil.create('div', 'dev-info-modal');
            devInfoModal.style.cssText = `
                display: none; position: fixed; z-index: 1001; left: 0; top: 0;
                width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.4);
                justify-content: center; align-items: center;
            `;
            document.body.appendChild(devInfoModal);
            var devInfoContent = L.DomUtil.create('div', 'dev-info-content');
            devInfoContent.style.cssText = `
                background-color: #fefefe; margin: auto; padding: 20px; border: 1px solid #888;
                border-radius: 8px; width: 80%; max-width: 400px; box-shadow: 0 4px 8px 0 rgba(0,0,0,0.2), 0 6px 20px 0 rgba(0,0,0,0.19);
                position: relative; text-align: center;
            `;
            devInfoContent.innerHTML = `
                <span class="close-button" style="
                    color: #aaa; float: right; font-size: 28px; font-weight: bold;
                    cursor: pointer; position: absolute; top: 5px; right: 15px;
                ">×</span>
                <h2 style="margin-top: 10px;">开发者介绍</h2>
                <p style="font-size: 16px; color: #555;">制作人：一袋子面<br>数据来源：茶呆呆 牢劉<br>底图：OpenStreetMap</p>
            `;
            devInfoModal.appendChild(devInfoContent);
            devInfoButton.onclick = function() { devInfoModal.style.display = 'flex'; };
            var closeButton = devInfoContent.querySelector('.close-button');
            closeButton.onclick = function() { devInfoModal.style.display = 'none'; };
            devInfoModal.onclick = function(event) {
                if (event.target == devInfoModal) {
                    devInfoModal.style.display = 'none';
                }
            };
        }

        // 使用说明按钮和弹窗逻辑
        var guideButton = document.querySelector('.guide-button');
        var guideModal = document.querySelector('.guide-modal');
        if (!guideModal) {
            guideModal = L.DomUtil.create('div', 'guide-modal');
            guideModal.style.cssText = `
                display: none; position: fixed; z-index: 1001; left: 0; top: 0;
                width: 100%; height: 100%; overflow: auto; background-color: rgba(0,0,0,0.4);
                justify-content: center; align-items: center;
            `;
            document.body.appendChild(guideModal);
            var guideContent = L.DomUtil.create('div', 'guide-content');
            guideContent.style.cssText = `
                background-color: #fefefe; margin: auto; padding: 20px; border: 1px solid #888;
                border-radius: 8px; width: 80%; max-width: 400px; box-shadow: 0 4px 8px 0 rgba(0,0,0,0.2), 0 6px 20px 0 rgba(0,0,0,0.19);
                position: relative; text-align: center;
            `;
            guideContent.innerHTML = `
                <span class="close-button" style="
                    color: #aaa; float: right; font-size: 28px; font-weight: bold;
                    cursor: pointer; position: absolute; top: 5px; right: 15px;
                ">×</span>
                <h2 style="margin-top: 10px;">使用说明</h2>
                <p style="font-size: 16px; color: #555;">点击标记可查看景点介绍，并缩放至最佳视角。
                <br>左上角小地图会跟随鼠标位置移动。
                <br>点击右侧的全屏按钮可进入全屏模式。
                <br>点击全局显示按钮缩放至景点聚集处。
                <br>点击键盘M键缩放至全图。
                <br>点击键盘I键调出使用说明。
                <br>点击键盘E键退出播放。
                <br>播放功能非常脆弱，播放的时候不要用其他按钮。
                <br>AI导游功能需要联网。</p>
            `;
            guideModal.appendChild(guideContent);
        }
        var guideCloseButton = guideModal.querySelector('.close-button');

        if (guideButton) {
            guideButton.addEventListener('click', function() { guideModal.style.display = 'flex'; });
        } else {
            console.error("Guide button not found.");
        }
        if (guideCloseButton) {
            guideCloseButton.addEventListener('click', function() { guideModal.style.display = 'none'; });
        }
        guideModal.addEventListener('click', function(event) {
            if (event.target == guideModal) {
                guideModal.style.display = 'none';
            }
        });

        // --- 自定义下拉框逻辑（从 600 行版本整合） ---
        var customSelectContainer = document.getElementById('custom-select');
        var selectHeader = customSelectContainer.querySelector('.select-header');
        var selectedValueSpan = customSelectContainer.querySelector('#selected-value');
        var optionsContainer = customSelectContainer.querySelector('#select-options');
        if (window.allMarkersData && optionsContainer) {
            window.allMarkersData.forEach(function(marker, index) {
                var optionDiv = document.createElement('div');
                optionDiv.classList.add('select-option');
                optionDiv.textContent = marker.name;
                optionDiv.dataset.index = index;
                optionsContainer.appendChild(optionDiv);
                optionDiv.addEventListener('click', function() {
                    resetPlayback(); // 重置播放状态和时间轴
                    document.querySelectorAll('.timeline-item').forEach(item => {
                        item.classList.remove('active'); // 重置时间轴高亮
                    });
                    var selectedIndex = parseInt(this.dataset.index);
                    var selectedMarker = window.allMarkersData[selectedIndex];
                    if (selectedMarker) {
                        selectedValueSpan.textContent = selectedMarker.name;
                        const currentCenter = mainMap.getCenter();
                        const targetLatLng = L.latLng(selectedMarker.location[0], selectedMarker.location[1]);
                        const distance = currentCenter.distanceTo(targetLatLng);
                        const isZoomCorrect = mainMap.getZoom() >= 17;
                        const isAtMarker = distance < 50;

                        if (!isAtMarker || !isZoomCorrect) {
                            animateToMarker(selectedMarker, 1.5, null, false, 17).then(() => {
                                const markerObject = findMarkerByLatLon(selectedMarker.location[0], selectedMarker.location[1]);
                                if (markerObject) {
                                    markerObject.openPopup();
                                }
                            });
                        } else {
                            console.log(`点击下拉菜单，已在目标位置 (${selectedMarker.name})，跳过平移动画。`);
                            const markerObject = findMarkerByLatLon(selectedMarker.location[0], selectedMarker.location[1]);
                            if (markerObject) {
                                markerObject.openPopup();
                            }
                        }
                    }
                    optionsContainer.classList.remove('visible');
                    selectHeader.classList.remove('active');
                });
            });
        } else {
            console.error('自定义下拉框元素或标记点数据未找到，无法初始化自定义下拉框功能。');
        }
        selectHeader.addEventListener('click', function(event) {
            event.stopPropagation();
            optionsContainer.classList.toggle('visible');
            selectHeader.classList.toggle('active');
        });
        document.addEventListener('click', function(event) {
            if (optionsContainer.classList.contains('visible') && !customSelectContainer.contains(event.target)) {
                optionsContainer.classList.remove('visible');
                selectHeader.classList.remove('active');
            }
        });

        document.addEventListener('keydown', function(event) {
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') {
                return;
            }

            if (event.key === 'e' || event.key === 'E') {
                if (isPlaying) {
                    console.log("检测到 'E' 键，正在强制停止播放和动画...");
                    stopMapAnimation();
                    resetPlayback();
                    document.querySelectorAll('.timeline-item').forEach(item => {
                        item.classList.remove('active');
                    });
                }
                return;
            }

            if (event.key === 'i' || event.key === 'I') {
                const guideModal = document.querySelector('.guide-modal');
                if (guideModal) {
                    if (guideModal.style.display === 'flex') {
                        guideModal.style.display = 'none';
                    } else {
                        guideModal.style.display = 'flex';
                    }
                }
                return;
            }

            if (event.key === 'm' || event.key === 'M') {
                const now = Date.now();
                const M_KEY_COOLDOWN = 1500;
                if (now - lastMKeyTime > M_KEY_COOLDOWN) {
                    lastMKeyTime = now;
                    pausePlayback();
                    isProgrammaticMove = true;
                    mainMap.flyTo(mainMap.getCenter(), mainMap.getMinZoom(), {
                        duration: 1.5
                    });
                    mainMap.once('moveend', () => {
                        isProgrammaticMove = false;
                    });
                } else {
                    const toast = L.DomUtil.create('div', 'cooldown-toast');
                    toast.style.cssText = `
                        position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
                        background: rgba(0,0,0,0.7); color: white; padding: 8px 16px; border-radius: 4px;
                        z-index: 10000; font-family: Arial, sans-serif; font-size: 14px;
                        animation: fadeIn 0.3s;
                    `;
                    const remainingTime = Math.ceil((M_KEY_COOLDOWN - (now - lastMKeyTime))/1000);
                    toast.textContent = `请等待 ${remainingTime} 秒后再试`;
                    document.body.appendChild(toast);
                    setTimeout(() => {
                        toast.style.animation = 'fadeOut 0.3s';
                        setTimeout(() => toast.remove(), 300);
                    }, 2000);
                    const styleId = 'cooldown-toast-styles';
                    if (!document.getElementById(styleId)) {
                        const style = document.createElement('style');
                        style.id = styleId;
                        style.textContent = `
                            @keyframes fadeIn { from { opacity: 0; transform: translateX(-50%) translateY(10px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
                            @keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }
                        `;
                        document.head.appendChild(style);
                    }
                }
            }
        });
    });
});