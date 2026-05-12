import requests
import json

# 测试健康检查
print('=== 健康检查 ===')
response = requests.get('http://localhost:8001/health')
print(f'状态码: {response.status_code}')
print(f'响应: {response.text}')

# 测试文件上传
print('\n=== 测试OCR识别 ===')
with open(r'e:\工作\file-compliance-web\ocr测试.jpg', 'rb') as f:
    files = {'file': ('test.jpg', f, 'image/jpeg')}
    try:
        response = requests.post('http://localhost:8001/api/ocr', files=files, timeout=60)
        print(f'状态码: {response.status_code}')
        print(f'响应: {response.text}')
        
        # 解析JSON
        try:
            data = response.json()
            print(f'文本内容长度: {len(data.get("text", ""))}')
        except:
            print('JSON解析失败')
    except Exception as e:
        print(f'请求失败: {e}')