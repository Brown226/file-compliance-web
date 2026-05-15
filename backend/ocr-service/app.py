from __future__ import annotations

import base64
import io
import json
from typing import Any, Dict, List
from urllib import error, request

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from pdf2image import convert_from_bytes
from paddleocr import PaddleOCR
from PIL import Image

ocr = PaddleOCR(use_angle_cls=True, lang='ch')

app = FastAPI(title="PaddleOCR Service", version="1.0")

DEFAULT_TIMEOUT_MS = 180000
MAX_PAGES = 3


def extract_text_from_result(result: Any) -> str:
    text = ""
    if result and isinstance(result, list):
        for page in result:
            if page and isinstance(page, list):
                for item in page:
                    if isinstance(item, list) and len(item) >= 2:
                        text += str(item[1][0]) + "\n"
    return text.strip()


def infer_file_type(file_type: str | None, file_name: str | None = None) -> str:
    value = (file_type or "").strip().lower()
    name = (file_name or "").strip().lower()
    if value.startswith('data:image/'):
        return 'image'
    if value in {'application/pdf', 'pdf'} or value.endswith('.pdf') or name.endswith('.pdf'):
        return 'pdf'
    if 'jpeg' in value or value.endswith('.jpg') or value.endswith('.jpeg') or name.endswith(('.jpg', '.jpeg')):
        return 'jpg'
    if 'png' in value or value.endswith('.png') or name.endswith('.png'):
        return 'png'
    if 'gif' in value or value.endswith('.gif') or name.endswith('.gif'):
        return 'gif'
    if 'webp' in value or value.endswith('.webp') or name.endswith('.webp'):
        return 'webp'
    if 'bmp' in value or value.endswith('.bmp') or name.endswith('.bmp'):
        return 'bmp'
    if 'tiff' in value or value.endswith('.tif') or value.endswith('.tiff') or name.endswith(('.tif', '.tiff')):
        return 'tiff'
    return value or name


def load_source_images(file_bytes: bytes, file_type: str | None, file_name: str | None = None) -> List[Image.Image]:
    if infer_file_type(file_type, file_name) == 'pdf':
        return list(convert_from_bytes(file_bytes, dpi=200, first_page=1, last_page=MAX_PAGES))

    image = Image.open(io.BytesIO(file_bytes)).convert('RGB')
    return [image]


def image_to_data_url(image: Image.Image) -> str:
    buffer = io.BytesIO()
    image.save(buffer, format='PNG')
    return f"data:image/png;base64,{base64.b64encode(buffer.getvalue()).decode('utf-8')}"


def log_to_file(message: str) -> None:
    with open('/app/ocr_logs.txt', 'a', encoding='utf-8') as f:
        f.write(message + '\n')


def call_vision_model(image_data_url: str, config: Dict[str, Any], page_num: int, total_pages: int) -> str:
    page_hint = f"（第{page_num}/{total_pages}页）" if total_pages > 1 else ""
    prompt = f"请识别并完整提取图片中的所有文字内容{page_hint}，保持原有格式和换行。只输出识别到的文字，不要添加任何说明。"

    payload = {
        'model': config['modelName'],
        'messages': [
            {
                'role': 'user',
                'content': [
                    {
                        'type': 'image_url',
                        'image_url': {'url': image_data_url, 'detail': 'high'},
                    },
                    {'type': 'text', 'text': prompt},
                ],
            },
        ],
        'max_tokens': 4096,
        'temperature': 0.1,
    }

    req = request.Request(
        url=f"{config['apiBaseUrl'].rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {config['apiKey']}",
        },
        method='POST',
    )

    with request.urlopen(req, timeout=int(config.get('timeoutMs') or DEFAULT_TIMEOUT_MS) / 1000) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        return data.get('choices', [{}])[0].get('message', {}).get('content', '') or ''


def recognize_via_vision_model(file_bytes: bytes, file_type: str | None, config: Dict[str, Any]) -> str:
    source_images = load_source_images(file_bytes, file_type)
    if not source_images:
        raise HTTPException(status_code=400, detail='无法从文件中提取图像')

    results: List[str] = []
    total_pages = len(source_images)

    for index, image in enumerate(source_images[:MAX_PAGES], start=1):
        image_data_url = image_to_data_url(image)
        try:
            text = call_vision_model(image_data_url, config, index, total_pages)
            if text:
                results.append(text)
        except error.HTTPError as e:
            detail = e.read().decode('utf-8', errors='ignore') if e.fp else str(e)
            raise HTTPException(status_code=500, detail=f'Vision API 错误 ({e.code}): {detail}')
        except Exception as e:
            log_to_file(f'Vision OCR page {index} failed: {str(e)}')
            raise HTTPException(status_code=500, detail=str(e))

    return '\n'.join(results).strip()


def recognize_document(
    file_bytes: bytes,
    file_type: str | None,
    file_name: str | None = None,
    config: Dict[str, Any] | None = None,
) -> str:
    if config and config.get('apiKey') and config.get('modelName'):
        if not config.get('apiBaseUrl'):
            raise HTTPException(status_code=400, detail='缺少视觉模型 API 地址')
        return recognize_via_vision_model(file_bytes, file_type, config, file_name)
    return recognize_via_paddleocr(file_bytes, file_type, file_name)


@app.post('/api/ocr')
async def ocr_image(file: UploadFile = File(...)):
    contents = await file.read()
    try:
        return {'text': recognize_document(contents, file.content_type or file.filename, file.filename)}
    except Exception as e:
        log_to_file(f'Error: {str(e)}')
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/api/ocr/base64')
async def ocr_base64(data: dict):
    base64_data = data.get('image', '')
    file_type = data.get('fileType', 'pdf')
    file_name = data.get('fileName', '')
    api_base_url = data.get('apiBaseUrl')
    api_key = data.get('apiKey')
    model_name = data.get('modelName')
    timeout_ms = data.get('timeoutMs', DEFAULT_TIMEOUT_MS)

    if not base64_data:
        raise HTTPException(status_code=400, detail='缺少图片数据')

    try:
        if 'data:image/' in base64_data:
            base64_data = base64_data.split(',', 1)[1]

        file_bytes = base64.b64decode(base64_data)
        result = recognize_document(
            file_bytes,
            file_type,
            file_name,
            {
                'apiBaseUrl': api_base_url,
                'apiKey': api_key,
                'modelName': model_name,
                'timeoutMs': timeout_ms,
            },
        )
        return {'text': result}
    except HTTPException:
        raise
    except Exception as e:
        log_to_file(f'Error: {str(e)}')
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/health')
async def health_check():
    return {'status': 'healthy', 'service': 'PaddleOCR'}


@app.get('/models')
async def get_models():
    return {'models': ['PaddleOCR-v3.3.1 (ch)']}


if __name__ == '__main__':
    import uvicorn

    uvicorn.run(app, host='0.0.0.0', port=8000)