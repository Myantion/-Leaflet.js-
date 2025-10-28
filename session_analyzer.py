import json
import os
import time
from collections import defaultdict
import numpy as np
from sklearn.preprocessing import MinMaxScaler
from sklearn.svm import SVR
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error
import random
import folium
from folium.plugins import HeatMap
import math
import requests
import re
from branca.colormap import LinearColormap


# Haversine 公式计算两点间距离（米）
def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371000  # 地球半径（米）
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = math.sin(delta_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    distance = R * c
    return distance


# 定义亲近等级及其对应的分数贡献值，已根据您的最新指示修正
PROXIMITY_LEVELS = [
    {"min": 0, "max": 200, "score": 10},  # 1级: 0-200米，10分
    {"min": 201, "max": 600, "score": 5},  # 2级: 201-600米，5分
    {"min": 601, "max": 1500, "score": 3},  # 3级: 601-1500米，3分
    {"min": 1501, "max": float('inf'), "score": 1}  # 超出1500米，1分 (默认值)
]


# 根据距离获取亲近等级的分数贡献值
def get_proximity_level_score(distance_m):
    for level in PROXIMITY_LEVELS:
        if level["min"] <= distance_m <= level["max"]:
            return level["score"]
    return 1  # 默认最低等级 (理论上不会执行到这里，因为有 float('inf'))


# 获取地图地点数据 (保持原样，未做任何修改)
def get_all_locations_data_from_source():
    all_markers_data = [
        {'name': '湖南全省高等中学校', 'location': [28.2051, 112.9821], 'year': '1913'},
        {'name': '湖南省立图书馆', 'location': [28.1916, 112.9925], 'year': '1913'},
        {'name': '湖南省立第一师范学校', 'location': [28.1792, 112.9670], 'year': '1914'},
        {'name': '新民学会', 'location': [28.1969, 112.9467], 'year': '1918'},
        {'name': '修业小学', 'location': [28.1928, 112.9772], 'year': '1919'},
        {'name': '潮宗街文化书社', 'location': [28.2065, 112.9668], 'year': '1921'},
        {'name': '湖南自修大学', 'location': [28.2030, 112.9763], 'year': '1921'},
        {'name': '清水塘毛泽东杨开慧故居', 'location': [28.2026, 112.9834], 'year': '1921'},
        {'name': '橘子洲头', 'location': [28.1691, 112.9547], 'year': '1925'},
        {'name': '湖南省教育会坪旧址', 'location': [28.2076, 112.9746], 'year': '1926'},
        {'name': '八角亭', 'location': [28.1976, 112.9706], 'year': '1927'},
        {'name': '文家市镇', 'location': [28.0495, 113.9261], 'year': '1927'},
        {'name': '湖南大学', 'location': [28.1806, 112.9411], 'year': '1950'},
        {'name': '岳麓山', 'location': [28.1885, 112.9280], 'year': '1955'},
        {'name': '岳麓书院', 'location': [28.1836, 112.9361], 'year': '1955'},
        {'name': '九所宾馆', 'location': [28.2056, 112.9907], 'year': '1974'},
        {'name': '火宫殿', 'location': [28.1938, 112.9683], 'year': '1958'},
    ]
    return all_markers_data


# 计算用户对每个地点的实际兴趣分数（作为SVM的训练目标）
def calculate_actual_interest_scores(session_file='user_sessions_data.json'):
    print(f"--- 开始计算实际兴趣分数 ---")
    all_locations = get_all_locations_data_from_source()
    attraction_coords_map = {loc['name']: loc['location'] for loc in all_locations}

    # 初始化每个地点的总兴趣分数
    interest_scores = defaultdict(float)

    if not os.path.exists(session_file) or os.path.getsize(session_file) == 0:
        print(f"警告: 会话文件 '{session_file}' 不存在或为空，无法计算兴趣分数。")
        print(f"--- 实际兴趣分数计算结束 (无数据) ---")
        return {}

    try:
        with open(session_file, 'r', encoding='utf-8') as f:
            sessions = json.load(f)
        print(f"成功加载 {len(sessions)} 个用户会话。")
    except json.JSONDecodeError:
        print(f"错误: 解析会话文件 '{session_file}' 失败，请检查JSON格式。")
        print(f"--- 实际兴趣分数计算结束 (解析失败) ---")
        return {}

    total_points_processed = 0
    for session_idx, session in enumerate(sessions):
        location_history = session.get('location_history', [])

        for data_point_idx, data_point in enumerate(location_history):
            user_lat = data_point.get('latitude')
            user_lon = data_point.get('longitude')

            if user_lat is None or user_lon is None:
                continue

            total_points_processed += 1

            # 对于每个用户位置点，计算其与所有景点的亲近度分数并累加
            for attraction_name, attraction_loc in attraction_coords_map.items():
                attraction_lat, attraction_lon = attraction_loc
                distance = haversine_distance(user_lat, user_lon, attraction_lat, attraction_lon)
                score = get_proximity_level_score(distance)
                interest_scores[attraction_name] += score

    print(f"总共处理了 {total_points_processed} 个有效用户位置点。")
    print(f"计算出 {len(interest_scores)} 个地点的原始兴趣分数。")

    # 对兴趣分数进行归一化处理，以便作为SVM的训练目标
    if interest_scores:
        scores_array = np.array(list(interest_scores.values())).reshape(-1, 1)
        if scores_array.shape[0] > 0 and np.max(scores_array) > np.min(scores_array):
            scaler = MinMaxScaler()
            normalized_scores = scaler.fit_transform(scores_array)

            for i, (loc_name, _) in enumerate(interest_scores.items()):
                interest_scores[loc_name] = normalized_scores[i][0]
            print(f"兴趣分数已归一化。")
        else:
            print("警告: 原始兴趣分数数组为空或所有值相同，无法进行归一化。所有地点分数将保持为0或其原始值。")
            for loc_name in interest_scores.keys():
                interest_scores[loc_name] = float(interest_scores[loc_name])
    else:
        print("警告: 没有计算出任何原始兴趣分数。")

    print(f"--- 实际兴趣分数计算结束 ---")
    return dict(interest_scores)


# 使用SVM训练模型并预测兴趣分数
def train_and_predict_interest_with_svm(actual_interest_scores):
    print(f"--- 开始训练SVM模型并预测兴趣分数 ---")
    all_locations = get_all_locations_data_from_source()

    # 准备特征 (X) 和目标 (y)
    X = []  # 特征: [纬度, 经度, 年份]
    y = []  # 目标: 实际兴趣分数
    location_names_for_training = []

    location_data_map = {loc['name']: loc for loc in all_locations}

    for loc_name, loc_data in location_data_map.items():
        if loc_name in actual_interest_scores and actual_interest_scores[loc_name] is not None:
            try:
                year_numeric = int(loc_data['year'])
            except ValueError:
                print(f"警告: 地点 '{loc_name}' 的年份 '{loc_data['year']}' 无法转换为数值，跳过该地点。")
                continue

            X.append([loc_data['location'][0], loc_data['location'][1], year_numeric])
            y.append(actual_interest_scores[loc_name])
            location_names_for_training.append(loc_name)

    print(f"用于SVM训练的数据点数量 (X, y): {len(X)}")

    if not X or len(X) < 2:
        print("错误: 没有足够的有效数据来训练SVM模型 (至少需要2个样本)。")
        print(f"--- SVM模型训练和预测结束 (数据不足) ---")
        return {}

    X = np.array(X)
    y = np.array(y)

    feature_scaler = MinMaxScaler()
    X_scaled = feature_scaler.fit_transform(X)
    print(f"训练特征已缩放。X_scaled 形状: {X_scaled.shape}")

    svm_model = SVR(kernel='rbf', C=1.0, gamma='scale')
    svm_model.fit(X_scaled, y)
    print(f"SVM模型训练完成。")

    all_locations_features = []
    all_locations_names = []
    for loc in all_locations:
        try:
            year_numeric = int(loc['year'])
        except ValueError:
            print(f"警告: 地点 '{loc['name']}' 的年份 '{loc['year']}' 无法转换为数值，跳过预测。")
            continue
        all_locations_features.append([loc['location'][0], loc['location'][1], year_numeric])
        all_locations_names.append(loc['name'])

    print(f"准备为 {len(all_locations_features)} 个地点进行预测。")

    if not all_locations_features:
        print("错误: 无法为任何地点准备预测特征。")
        print(f"--- SVM模型训练和预测结束 (无预测特征) ---")
        return {}

    all_locations_features_scaled = feature_scaler.transform(np.array(all_locations_features))
    predicted_scores_array = svm_model.predict(all_locations_features_scaled)
    print(f"SVM预测完成。预测分数数组形状: {predicted_scores_array.shape}")

    predicted_interest_scores = {}
    for i, loc_name in enumerate(all_locations_names):
        predicted_interest_scores[loc_name] = predicted_scores_array[i]

    if predicted_interest_scores:
        scores_array_final = np.array(list(predicted_interest_scores.values())).reshape(-1, 1)
        if scores_array_final.shape[0] > 0 and np.max(scores_array_final) > np.min(scores_array_final):
            scaler_final = MinMaxScaler()
            normalized_predicted_scores = scaler_final.fit_transform(scores_array_final)

            for i, (loc_name, _) in enumerate(predicted_interest_scores.items()):
                predicted_interest_scores[loc_name] = normalized_predicted_scores[i][0]
            print(f"预测兴趣分数已归一化。")
        else:
            print("警告: SVM预测结果数组为空或所有值相同，无法进行最终归一化。")
            for loc_name in predicted_interest_scores.keys():
                predicted_interest_scores[loc_name] = float(predicted_interest_scores[loc_name])
    else:
        print("警告: 没有计算出任何预测兴趣分数。")

    print(f"--- SVM模型训练和预测结束 ---")
    return predicted_interest_scores


# 生成基于SVM预测的景点兴趣热力图
def generate_attraction_interest_heatmap_html(interest_scores, output_filename='attraction_interest_heatmap.html'):
    print(f"--- 开始生成景点兴趣热力图HTML ({output_filename}) ---")
    all_locations = get_all_locations_data_from_source()

    heatmap_data = []
    location_coords_map = {loc['name']: loc['location'] for loc in all_locations}

    for loc_name, score in interest_scores.items():
        if score > 0 and loc_name in location_coords_map:
            heatmap_data.append([location_coords_map[loc_name][0], location_coords_map[loc_name][1], score])

    print(f"准备了 {len(heatmap_data)} 个点用于景点兴趣热力图。")

    map_center = [28.2282, 112.9389]  # 长沙市中心大致坐标
    m = folium.Map(location=map_center, zoom_start=14, tiles='CartoDB Voyager')

    if heatmap_data:
        HeatMap(heatmap_data, radius=60, blur=40, max_zoom=18).add_to(m)
        print("景点兴趣热力图层已添加到地图。")
    else:
        print("没有景点兴趣热力图数据可供添加。热力图将为空。")

    colormap = LinearColormap(
        colors=['#0000FF', '#00FFFF', '#00FF00', '#FFFF00', '#FF8C00', '#FF4500', '#8B0000'],
        vmin=0.0,
        vmax=1.0,
        caption='景点兴趣热度 (SVM预测)'
    )
    m.add_child(colormap)
    print("色带图例已添加到地图。")

    map_html = m._repr_html_()
    with open(output_filename, 'w', encoding='utf-8') as f:
        f.write(map_html)
    print(f"--- 景点兴趣热力图HTML生成完成并保存到 '{output_filename}' ---")
    return map_html


# 生成基于用户活动密度的热力图
def generate_user_activity_density_heatmap_html(session_file='user_sessions_data.json',
                                                output_filename='user_activity_density_heatmap.html'):
    print(f"--- 开始生成用户活动密度热力图HTML ({output_filename}) ---")
    heatmap_data = []

    if not os.path.exists(session_file) or os.path.getsize(session_file) == 0:
        print(f"警告: 会话文件 '{session_file}' 不存在或为空，无法生成用户活动密度热力图。")
        m = folium.Map(location=[28.2282, 112.9389], zoom_start=13, tiles='CartoDB Voyager')
        map_html = m._repr_html_()
        with open(output_filename, 'w', encoding='utf-8') as f:
            f.write(map_html)
        return map_html

    try:
        with open(session_file, 'r', encoding='utf-8') as f:
            sessions = json.load(f)
        print(f"成功加载 {len(sessions)} 个用户会话用于密度热力图。")
    except json.JSONDecodeError:
        print(f"错误: 解析会话文件 '{session_file}' 失败，请检查JSON格式。无法生成用户活动密度热力图。")
        m = folium.Map(location=[28.2282, 112.9389], zoom_start=13, tiles='CartoDB Voyager')
        map_html = m._repr_html_()
        with open(output_filename, 'w', encoding='utf-8') as f:
            f.write(map_html)
        return map_html

    total_density_points = 0
    for session in sessions:
        location_history = session.get('location_history', [])
        for data_point in location_history:
            user_lat = data_point.get('latitude')
            user_lon = data_point.get('longitude')
            if user_lat is not None and user_lon is not None:
                heatmap_data.append([user_lat, user_lon, 1])  # 每个点权重为1
                total_density_points += 1

    print(f"准备了 {total_density_points} 个点用于用户活动密度热力图。")

    map_center = [28.2282, 112.9389]  # 长沙市中心大致坐标
    m = folium.Map(location=map_center, zoom_start=14, tiles='CartoDB Voyager')

    if heatmap_data:
        # 调整radius和blur以更好地显示密度，可以根据实际数据和效果进行微调
        HeatMap(heatmap_data, radius=25, blur=15, max_zoom=18).add_to(m)
        print("用户活动密度热力图层已添加到地图。")
    else:
        print("没有用户活动密度热力图数据可供添加。热力图将为空。")

    # 添加色带图例
    colormap = LinearColormap(
        colors=['#0000FF', '#00FFFF', '#00FF00', '#FFFF00', '#FF8C00', '#FF4500', '#8B0000'],
        vmin=0.0,  # 假设最低密度
        vmax=1.0,  # 假设最高密度，HeatMap会自动根据数据范围调整颜色，这里只是给图例一个参考范围
        caption='用户活动密度'
    )
    m.add_child(colormap)
    print("色带图例已添加到地图。")

    map_html = m._repr_html_()
    with open(output_filename, 'w', encoding='utf-8') as f:
        f.write(map_html)
    print(f"--- 用户活动密度热力图HTML生成完成并保存到 '{output_filename}' ---")
    return map_html


# 主函数，用于分析会话数据并生成两种热力图
def analyze_and_generate_heatmaps():
    print("--- 主函数开始 ---")

    # 1. 生成景点兴趣热力图 (基于SVM预测)
    print("\n--- 开始生成景点兴趣热力图 (基于SVM预测) ---")
    actual_interest_scores = calculate_actual_interest_scores()

    if not actual_interest_scores:
        print("没有计算出实际兴趣分数，景点兴趣热力图将为空。")
        generate_attraction_interest_heatmap_html({}, 'attraction_interest_heatmap.html')  # 生成空地图
    else:
        predicted_interest_scores = train_and_predict_interest_with_svm(actual_interest_scores)
        if not predicted_interest_scores:
            print("SVM模型未能预测出兴趣分数，景点兴趣热力图将为空。")
            generate_attraction_interest_heatmap_html({}, 'attraction_interest_heatmap.html')  # 生成空地图
        else:
            generate_attraction_interest_heatmap_html(predicted_interest_scores, 'attraction_interest_heatmap.html')
    print("--- 景点兴趣热力图生成流程结束 ---")

    # 2. 生成用户活动密度热力图 (基于原始用户轨迹)
    print("\n--- 开始生成用户活动密度热力图 (基于原始用户轨迹) ---")
    generate_user_activity_density_heatmap_html(output_filename='user_activity_density_heatmap.html')
    print("--- 用户活动密度热力图生成流程结束 ---")

    print("\n--- 主函数结束 ---")


# 如果需要，可以在这里调用主函数来测试或生成HTML
if __name__ == '__main__':
    analyze_and_generate_heatmaps()
    print(
        "\n两种热力图已生成：'attraction_interest_heatmap.html' (景点兴趣) 和 'user_activity_density_heatmap.html' (用户活动密度)。")
