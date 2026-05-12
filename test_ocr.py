import base64
import requests

# 读取图片文件
with open(r'e:\工作\file-compliance-web\ocr测试.jpg', 'rb') as f:
    image_data = f.read()

print(f'图片大小: {len(image_data)} 字节')

# 转换为 base64
base64_img = base64.b64encode(image_data).decode('utf-8')

# 调用 OCR API
response = requests.post('http://localhost:8001/api/ocr/base64', json={'image': base64_img})

print('=== OCR 识别结果 ===')
print(f'状态码: {response.status_code}')
print(f'响应: {response.text}')
