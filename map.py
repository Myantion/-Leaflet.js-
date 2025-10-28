import folium
import os
import folium.plugins as plugins
from folium.plugins import MarkerCluster, MeasureControl
import requests
import json
from coord_convert.transform import wgs2gcj
import re
from urllib.parse import quote
import http.server
import socketserver
import webbrowser
import time

# 地点数据
all_markers_data = [
    {'name': '点名称', 'location': [0,0 ], 'year': '年份',#填写经纬度
     'description': '介绍'},

]

# --- 以下为地图生成逻辑 ---

changsha_core_bounds = [28.0, 112.8, 28.3, 113.1]
clustered_markers_data = [
    marker for marker in all_markers_data
    if changsha_core_bounds[0] <= marker['location'][0] <= changsha_core_bounds[2] and
       changsha_core_bounds[1] <= marker['location'][1] <= changsha_core_bounds[3]
]

for folder in ['pic', 'icon']:
    if not os.path.exists(folder):
        os.makedirs(folder)
if not os.path.exists('map_logic.js'):
    print("错误：未找到 'map_logic.js' 文件。")
    exit(1)

m = folium.Map(tiles='CartoDB Voyager', min_zoom=10, max_zoom=18, zoom_control=True,control_scale=True)
plugins.Fullscreen(position='topright').add_to(m)
plugins.MeasureControl(position='topleft', primary_length_unit='meters', primary_area_unit='sqmeters').add_to(m)
plugins.MousePosition().add_to(m)

m.get_root().html.add_child(folium.Element("""
<style>
    .custom-select-container { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); z-index: 1000; }
    .select-header { padding: 8px 12px; font-size: 14px; border: 1px solid #ccc; border-radius: 5px; background: rgba(255,255,255,0.7); cursor: pointer; width: 400px; display: flex; justify-content: space-between; }
    .select-header .arrow { border: solid black; border-width: 0 2px 2px 0; display: inline-block; padding: 3px; transition: transform 0.3s; }
    .select-header.active .arrow { transform: rotate(-135deg); }
    .select-header .arrow.down { transform: rotate(45deg); }
    .select-options { display: none; position: absolute; top: calc(100% + 5px); left: 0; width: 100%; background: rgba(255,255,255,0.8); border: 1px solid #ccc; border-radius: 5px; max-height: 200px; overflow-y: auto; }
    .select-options.visible { display: block; }
    .select-option { padding: 10px; cursor: pointer; border-bottom: 1px solid #eee; }
    .select-option:hover { background: #f0f0f0; }
    .custom-hover-popup { position: absolute; display: none; z-index: 999; background: rgba(255,255,255,0.75); color: black; padding: 8px; border-radius: 6px; font-size: 14px; max-width: 400px; pointer-events: none; transform: translate(-50%, -100%); opacity: 0; transition: opacity 0.2s; }
    #dynamic-legend { position: fixed; bottom: 50px; left: 10px; z-index: 1000; background: rgba(255,255,255,0.7); padding: 12px; border: 2px solid #ccc; border-radius: 8px; font-size: 14px; }
    #map-timeline { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); z-index: 999; background: rgba(255,255,255,0.8); border-radius: 15px; padding: 10px; display: flex; overflow-x: auto; }
    .timeline-item { display: flex; flex-direction: column; align-items: center; margin: 0 20px; cursor: pointer; opacity: 0.7; }
    .timeline-item.active { opacity: 1; transform: scale(1.1); }
    .timeline-dot { width: 15px; height: 15px; background: #0078A8; border-radius: 50%; border: 3px solid #fff; }
    .timeline-item:hover .timeline-dot, .timeline-item.active .timeline-dot { background: #ff5722; }
    .timeline-year { margin-top: 8px; font-weight: bold; color: #333; }
    .timeline-item.active .timeline-year { color: #ff5722; }
    .timeline-connector { position: absolute; top: 7px; left: 100%; width: 40px; height: 2px; background: #ccc; z-index: -1; }
    .hidden-tooltip { display: none; }
    .leaflet-control-container .leaflet-right { right: 10px !important; left: auto !important; }
    .leaflet-control-fullscreen { top: 10px; }
    .leaflet-control-zoom { top: 60px; }
    .leaflet-control-measure { position: fixed; top: 50%; left: 10px; transform: translateY(-50%); z-index: 1000; }
    .popup-button-container { display: flex; justify-content: center; gap: 15px; margin-top: 10px; }
    .popup-button { display: inline-block; padding: 8px 12px; background: #007bff; color: white !important; text-decoration: none; border-radius: 5px; font-size: 14px; border: none; cursor: pointer; }
    .popup-button.secondary { background: #6c757d; }
</style>
"""))
m.get_root().html.add_child(folium.Element('<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.7.0/css/font-awesome.min.css">'))

m.get_root().html.add_child(folium.Element(f'<div id="custom-select" class="custom-select-container"><div class="select-header"><span id="selected-value">足迹</span><div class="arrow down"></div></div><div id="select-options" class="select-options"></div></div><script>var allMarkersData = {json.dumps(all_markers_data, ensure_ascii=False)};</script>'))
m.get_root().html.add_child(folium.Element('<div id="dynamic-legend"><h4>图例</h4><div><i class="fa fa-map-marker" style="color: #0078A8;"></i> 景点</div><div id="legend-item-geojson"><i style="background: red; width: 20px; height: 2px; display: inline-block;"></i> 长沙市行政区划边界</div></div>'))
m.get_root().html.add_child(folium.Element('<button class="guide-button" style="position: absolute; top: 10px; right: 305px; background: rgba(0,0,0,0.5); color: white; padding: 8px; border: none; border-radius: 5px; cursor: pointer; z-index: 1000;">使用说明</button>'))
m.get_root().html.add_child(folium.Element('<button class="global-view-button" style="position: absolute; top: 10px; right: 210px; background: rgba(0,0,0,0.5); color: white; padding: 8px; border: none; border-radius: 5px; cursor: pointer; z-index: 1000;">全局显示</button>'))
m.get_root().html.add_child(folium.Element('<button class="dev-info-button" style="position: absolute; top: 10px; right: 100px; background: rgba(0,0,0,0.5); color: white; padding: 8px; border: none; border-radius: 5px; cursor: pointer; z-index: 1000;">开发者介绍</button>'))
m.get_root().html.add_child(folium.Element('<div class="playback-button-container" style="position: fixed; top: 50%; right: 10px; z-index: 1000; transform: translateY(-50%); display: flex; flex-direction: column; gap: 10px; background: rgba(0,0,0,0.5); padding: 8px; border-radius: 5px;"><button id="playback-start-btn" style="background: transparent; color: white; border: none; cursor: pointer; font-size: 24px;"><i class="fa fa-play"></i></button><button id="playback-stop-btn" style="background: transparent; color: white; border: none; cursor: pointer; font-size: 24px; display: none;"><i class="fa fa-pause"></i></button></div>'))
m.get_root().html.add_child(folium.Element('<div class="overview-map-container" style="position: absolute; top: 10px; left: 10px; width: 250px; height: 250px; border-radius: 50%; border: 2px solid #333; z-index: 999; overflow: hidden;"></div>'))
m.get_root().html.add_child(folium.Element('<div id="map-timeline" style="max-width: 90%; white-space: nowrap; cursor: grab;"><div id="timeline-container" style="display: flex; align-items: center;"></div></div>'))
m.get_root().html.add_child(folium.Element('<button class="chat-button" style="position: fixed; top: 60%; left: 10px; background: rgba(0,0,0,0.5); color: white; padding: 8px; border: none; border-radius: 5px; cursor: pointer; z-index: 1000; transform: translateY(-50%);" onclick="openChatPanel()">AI助手</button>'))

popup_html = """
<div style="text-align: center; max-width: 300px;">
    <h4>{name}</h4>
    <img src="pic/{i}.jpg" alt="{name}" style="max-width:250px; height:auto; border-radius:8px; margin-bottom:10px;" onerror="this.style.display='none'">
    <p style="font-size:14px; color:#555; text-align: left;">{description}</p>

    <div id="ai-content-{i}" style="text-align: left; margin-top: 10px; padding: 8px; background: #f0f8ff; border-radius: 5px; display: none; border: 1px solid #e0e8ef;">
        <p>AI导游正在思考中，请稍候...</p>
    </div>

    <div class="popup-button-container">
        <a href="https://uri.amap.com/marker?position={gcj02_location[1]},{gcj02_location[0]}&name={name_encoded}&pano=1&src=yuelu_map" target="_blank" class="popup-button">官方实景</a>
        <a href="amap.html?lng={gcj02_location[1]}&lat={gcj02_location[0]}&name={name_encoded}&index={i}" target="_blank" class="popup-button secondary">3D模型</a>
        <button class="popup-button" onclick="getAiIntro({i}, '{name}', '{year}')" style="background: #28a745;">AI讲解</button>
    </div>
</div>
"""

marker_cluster = MarkerCluster(name='景点').add_to(m)
for i, marker_data in enumerate(all_markers_data):
    wgs84_lat, wgs84_lon = marker_data['location']
    gcj02_lon, gcj02_lat = wgs2gcj(wgs84_lon, wgs84_lat)
    name_encoded = quote(marker_data['name'])
    popup_content = popup_html.format(
        name=marker_data['name'], i=i, description=re.sub(r'\[Image \d+\]', '', marker_data.get('description', '')),
        gcj02_location=[gcj02_lat, gcj02_lon], name_encoded=name_encoded,year=marker_data['year']
    )
    icon_path = f'icon/{i}.png'
    icon = folium.CustomIcon(icon_path, icon_size=(48, 48)) if os.path.exists(icon_path) else None
    marker = folium.Marker(
        location=marker_data['location'], popup=folium.Popup(popup_content, max_width=300),
        icon=icon, tooltip=marker_data['name']
    )
    folium.Tooltip(
        text=marker_data['name'], sticky=False, permanent=False, direction='right',
        opacity=0, className='hidden-tooltip'
    ).add_to(marker)
    marker.add_to(marker_cluster)

lats = [marker['location'][0] for marker in clustered_markers_data]
lons = [marker['location'][1] for marker in clustered_markers_data]
m.fit_bounds([[min(lats), min(lons)], [max(lats), max(lons)]], padding=(50, 50))

geojson_file = 'changsha_geojson.json'
if not os.path.exists(geojson_file):
    response = requests.get('https://geo.datav.aliyun.com/areas_v3/bound/430000_full.json')
    geojson_data = response.json()
    with open(geojson_file, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f, ensure_ascii=False)
else:
    with open(geojson_file, 'r', encoding='utf-8') as f:
        geojson_data = json.load(f)
filtered_features = [f for f in geojson_data['features'] if f['properties'].get('name') == '长沙市']
if filtered_features:
    geojson_data['features'] = filtered_features
    folium.GeoJson(geojson_data, name='长沙市行政区划边界', style_function=lambda x: {'fillColor': 'none', 'color': 'red', 'weight': 3, 'fillOpacity': 0}, tooltip=folium.features.GeoJsonTooltip(fields=['name'], aliases=['城市名称'])).add_to(m)

m.get_root().html.add_child(folium.Element(f'<script>var allMarkersWithYear = {json.dumps(all_markers_data, ensure_ascii=False)};</script>'))
m.get_root().html.add_child(folium.Element(f'<script>var clusteredLocations = {json.dumps([marker["location"] for marker in clustered_markers_data], ensure_ascii=False)};</script>'))
m.get_root().html.add_child(folium.Element('<script src="map_logic.js"></script>'))
m.get_root().html.add_child(folium.Element(f'<script src="ai_logic.js?v={int(time.time())}"></script>'))
m.get_root().html.add_child(folium.Element(f'<script src="chat_logic.js?v={int(time.time())}"></script>'))

folium.Map.add_child(m, folium.LatLngPopup())
m.get_root().html.add_child(folium.Element(f'<script src="cursor_proximity_tracker.js?v={int(time.time())}"></script>'))

m.save('yuelu_academy_map.html')
print("成功生成 yuelu_academy_map.html 文件。")


# --- 为小地图准备一份所有坐标都转换好的数据 ---
all_markers_data_gcj02 = []
for marker in all_markers_data:
    new_marker = marker.copy()
    wgs_lat, wgs_lon = new_marker['location']
    gcj_lon, gcj_lat = wgs2gcj(wgs_lon, wgs_lat)
    new_marker['location'] = [gcj_lat, gcj_lon]
    all_markers_data_gcj02.append(new_marker)


# --- 定义 amap.html 的内容 ---
amap_html_content = f"""
<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="initial-scale=1.0, user-scalable=no, width=device-width">
    <title>3D城市地图</title>
    <style>
        html, body, #container {{
            height: 100%;
            width: 100%;
            margin: 0;
            padding: 0;
        }}
        #title-bar {{
            position: absolute; top: 20px; left: 20px; background-color: rgba(255, 255, 255, 0.8);
            padding: 10px 15px; border-radius: 5px; z-index: 10; font-size: 18px;
            font-weight: bold; box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }}
        #overview-map {{
            position: absolute;
            top: 20px;
            right: 20px;
            width: 200px;
            height: 200px;
            border: 2px solid #333;
            border-radius: 50%;
            overflow: hidden;
            z-index: 100;
            background-color: #f5f3f0;
        }}
    </style>
    <script>
        var allMarkerLocations = {json.dumps(all_markers_data_gcj02, ensure_ascii=False)};
    </script>
    <script type="text/javascript" src="https://webapi.amap.com/maps?v=2.0&key=高德api密钥"></script>
</head>
<body>
    <div id="container"></div>
    <div id="title-bar">正在加载...</div>
    <div id="overview-map"></div>
    <script src="amap_logic.js"></script>
</body>
</html>
"""

# 将 amap.html 内容写入文件
try:
    with open('amap.html', 'w', encoding='utf-8') as f:
        f.write(amap_html_content)
    print("成功创建 amap.html (已包含小地图和修正后坐标)。")
except IOError as e:
    print(f"写入 amap.html 文件时发生错误: {e}")

# --- 最终版：强行插入HTML标题 ---
try:
    with open('yuelu_academy_map.html', 'r', encoding='utf-8') as f:
        html_content = f.read()

    # 我们找到<head>标签，在它后面立刻插入我们的标题
    # 确保只替换第一个出现的<head>，以防万一
    html_content = html_content.replace('<head>', '<head>\n    <title>your_title</title>', 1)

    with open('yuelu_academy_map.html', 'w', encoding='utf-8') as f:
        f.write(html_content)

    print("已成功为地图文件添加标题“[你的标题]”。")

except Exception as e:
    print(f"添加HTML标题时出错: {e}")
# --- 新增：服务器启动代码 ---
PORT = 8000
Handler = http.server.SimpleHTTPRequestHandler

print("\n--- 启动本地HTTP服务器 ---")
try:
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        url_to_open = f"http://localhost:{PORT}/yuelu_academy_map.html"

        print(f"服务器已在 http://localhost:{PORT} 启动")
        print("您的浏览器将自动打开此页面。")
        print("要停止服务器，请在此命令行窗口按 Ctrl+C")

        webbrowser.open_new_tab(url_to_open)
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\n服务器已关闭。")
except Exception as e:
    print(f"启动服务器时出错: {e}")