import os
import google.generativeai as genai
from flask import Flask, request, jsonify
from flask_cors import CORS
import time
import json
import traceback # 导入 traceback 用于打印详细错误信息

# --- 在这里粘贴您从Google获取的API密钥 ---
GEMINI_API_KEY = "Gemini密钥"

### --- 代理配置 (根据您的Clash配置) ---
os.environ['HTTP_PROXY'] = '自己代理地址'
os.environ['HTTPS_PROXY'] = '自己代理地址'
### --- 代理配置结束 ---


# 配置AI模型
try:
    genai.configure(api_key=GEMINI_API_KEY)
    model = genai.GenerativeModel('gemini-2.0-flash')
    print("AI模型初始化成功。")
except Exception as e:
    print(f"API密钥配置或模型初始化失败，请检查您的密钥是否正确或网络是否畅通: {e}")
    model = None

# 创建Flask后端应用
app = Flask(__name__)
CORS(app)


# 定义一个API接口，路径为 /api/get-ai-description (用于地图讲解)
@app.route('/api/get-ai-description', methods=['POST'])
def get_ai_description():
    if not model:
        return jsonify({"error": "AI模型未能成功初始化，请检查服务器端的API密钥或网络连接。"}), 500

    data = request.json
    name = data.get('name')
    year = data.get('year')

    if not name or not year:
        return jsonify({"error": "请求中缺少地点名称或年份信息"}), 400

    prompt = f"请你扮演一位博学的历史导游，用生动、引人入胜的语言，为游客详细介绍一下与“{name}”相关的、在{year}年前后发生的历史事件、背景和意义。语言要流畅，内容要有深度，大约200字左右。"

    print(f"正在为“{name}”生成AI讲解...")

    try:
        start_time = time.time()
        response = model.generate_content(prompt)
        end_time = time.time()
        print(f"Gemini API 讲解调用耗时: {end_time - start_time:.2f} 秒")

        formatted_text = response.text.replace('\n', '<br>')
        print("AI讲解生成成功！")
        return jsonify({"text": formatted_text})
    except Exception as e:
        print(f"AI讲解内容生成失败: {e}")
        return jsonify({"error": f"AI讲解内容生成失败: {str(e)}。请检查网络连接和API密钥。"}), 500


# 对话API接口，路径为 /api/chat
@app.route('/api/chat', methods=['POST'])
def chat_with_ai():
    if not model:
        return jsonify({"error": "AI模型未能成功初始化，请检查服务器端的API密钥或网络连接。"}), 500

    data = request.json
    messages = data.get('messages')

    if not messages:
        return jsonify({"error": "请求中缺少对话消息历史"}), 400

    print(f"正在进行AI对话，当前消息数: {len(messages)}...")

    try:
        start_time = time.time()
        response = model.generate_content(messages)
        end_time = time.time()
        print(f"Gemini API 对话调用耗时: {end_time - start_time:.2f} 秒")

        ai_reply = response.text
        print("AI对话回复生成成功！")
        return jsonify({"text": ai_reply})
    except Exception as e:
        print(f"AI对话回复生成失败: {e}")
        return jsonify({"error": f"AI对话回复生成失败: {str(e)}。请检查网络连接和API密钥。"}), 500


# 用户行为日志接口 (用于记录离散事件，如AI讲解点击、聊天消息发送)
@app.route('/api/log_behavior', methods=['POST'])
def log_behavior():
    try:
        behavior_data = request.json
        behavior_data['timestamp'] = time.time()  # 添加服务器时间戳

        log_file_path = 'user_behavior_log.json'

        if not os.path.exists(log_file_path) or os.path.getsize(log_file_path) == 0:
            with open(log_file_path, 'w', encoding='utf-8') as f:
                json.dump([], f, ensure_ascii=False, indent=4)

        with open(log_file_path, 'r+', encoding='utf-8') as f:
            f.seek(0)
            try:
                logs = json.load(f)
            except json.JSONDecodeError:
                logs = []
            logs.append(behavior_data)
            f.seek(0)
            f.truncate()
            json.dump(logs, f, ensure_ascii=False, indent=4)

        print(f"用户行为已记录: {behavior_data['event']}")
        return jsonify({"status": "success", "message": "行为已记录"}), 200
    except Exception as e:
        print(f"记录用户行为失败: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


# 保存会话数据接口 (用于在用户退出时保存光标追踪数据)
@app.route('/api/save_session_data', methods=['POST'])
def save_session_data():
    try:
        session_data = request.json
        # 打印收到的数据，用于调试
        print(f"\n--- 收到前端发送的会话数据 ---")
        # 核心改动：这里现在期望接收 'location_history' 键
        print(f"光标事件数量: {len(session_data.get('location_history', []))}")
        # print(json.dumps(session_data, indent=2, ensure_ascii=False)) # 如果数据量大，这行可能打印很多

        # 为每个会话生成一个唯一ID，如果前端没有提供的话
        if 'session_id' not in session_data:
            session_data['session_id'] = str(time.time())
        session_data['end_timestamp'] = time.time()  # 记录会话结束时间

        session_file_path = 'user_sessions_data.json'

        if not os.path.exists(session_file_path) or os.path.getsize(session_file_path) == 0:
            with open(session_file_path, 'w', encoding='utf-8') as f:
                json.dump([], f, ensure_ascii=False, indent=4)

        with open(session_file_path, 'r+', encoding='utf-8') as f:
            f.seek(0)
            try:
                sessions = json.load(f)
            except json.JSONDecodeError:
                print(f"警告: user_sessions_data.json 文件为空或格式错误，将重新初始化。")
                sessions = []
            sessions.append(session_data)
            f.seek(0)
            f.truncate()
            json.dump(sessions, f, ensure_ascii=False, indent=4)

        print(f"会话数据已保存到 '{session_file_path}'，ID: {session_data['session_id']}")
        return jsonify({"status": "success", "message": "会话数据已保存"}), 200
    except Exception as e:
        print(f"保存会话数据失败: {e}")
        # 打印完整的错误堆栈，帮助诊断
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


# 启动这个后端服务
if __name__ == '__main__':
    print("--- AI讲解后端服务已启动 ---")
    print("服务运行在 http://localhost:5000")
    print("请保持此窗口运行，要停止请按 Ctrl+C")
    app.run(port=5000)
