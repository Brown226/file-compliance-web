import requests

with open(r'e:\工作\file-compliance-web\ocr测试.jpg', 'rb') as f:
    files = {'file': f}
    response = requests.post('http://localhost:8001/api/ocr', files=files)

print(f'状态码: {response.status_code}')
print(f'响应: {response.text}')