"""OCR Service — Vision LLM primary + PaddleOCR fallback + Tesseract fallback"""
from __future__ import annotations

import base64
import io
import json
import os
import tempfile
import traceback
from typing import Any, Dict, List, Optional
from urllib import error, request

from fastapi import FastAPI, File, HTTPException, UploadFile
from pdf2image import convert_from_bytes
from PIL import Image

# ---- Lazy-loaded OCR engines ----
_ocr = None
_layout_pipeline = None

def _get_paddleocr():
    """Lazy-init PaddleOCR — may fail on some platforms."""
    global _ocr
    if _ocr is None:
        try:
            from paddleocr import PaddleOCR
            _ocr = PaddleOCR(use_textline_orientation=True, lang='ch')
        except Exception as e:
            log_to_file(f'PaddleOCR init failed (will use fallbacks): {e}')
            _ocr = False  # sentinel: tried and failed
    return _ocr if _ocr is not False else None

def _get_layout_pipeline():
    global _layout_pipeline
    if _layout_pipeline is None:
        try:
            from paddleocr import PPStructureV3
            _layout_pipeline = PPStructureV3()
        except Exception as e:
            log_to_file(f'PPStructureV3 init failed: {e}')
            _layout_pipeline = False
    return _layout_pipeline if _layout_pipeline is not False else None

app = FastAPI(title="OCR Service", version="2.0")

DEFAULT_TIMEOUT_MS = 300000
MAX_PAGES = 100
VISION_MAX_DIM = 1200        # max longest side for vision model images
VISION_JPEG_QUALITY = 80
OCR_DPI = 100                # DPI for PDF→image conversion (lower = faster)
PADDLE_DPI = 200             # DPI for PaddleOCR (needs higher res)


# ==================== Utilities ====================

def log_to_file(message: str) -> None:
    try:
        with open('/app/ocr_logs.txt', 'a', encoding='utf-8') as f:
            f.write(f'[{__import__("datetime").datetime.now().isoformat()}] {message}\n')
    except Exception:
        pass


def infer_file_type(file_type: str | None, file_name: str | None = None) -> str:
    value = (file_type or "").strip().lower()
    name = (file_name or "").strip().lower()
    if value.startswith('data:image/'):
        return 'image'
    FILE_TYPE_MAP = {
        'application/pdf': 'pdf', 'pdf': 'pdf',
        'application/msword': 'doc', 'doc': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'docx': 'docx',
        'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'jpg': 'jpg', 'jpeg': 'jpeg',
        'image/png': 'png', 'png': 'png',
        'image/gif': 'gif', 'gif': 'gif',
        'image/webp': 'webp', 'webp': 'webp',
        'image/bmp': 'bmp', 'bmp': 'bmp',
        'image/tiff': 'tiff', 'tiff': 'tiff',
    }
    SPECIAL = {'doc': 'docx'}
    normalized = FILE_TYPE_MAP.get(value, value)
    if normalized == value and '.' in name:
        ext = name.split('.')[-1]
        normalized = FILE_TYPE_MAP.get(ext, ext)
    return SPECIAL.get(normalized, normalized)


def load_pdf_images(file_bytes: bytes, dpi: int = OCR_DPI) -> List[Image.Image]:
    """Convert PDF bytes to PIL images at the given DPI."""
    try:
        return list(convert_from_bytes(file_bytes, dpi=dpi, first_page=1, last_page=MAX_PAGES))
    except Exception as e:
        log_to_file(f'pdf2image failed (dpi={dpi}): {e}')
        return []


def load_source_images(file_bytes: bytes, file_type: str | None, file_name: str | None = None, dpi: int = OCR_DPI) -> List[Image.Image]:
    ftype = infer_file_type(file_type, file_name)
    if ftype == 'pdf':
        return load_pdf_images(file_bytes, dpi=dpi)
    try:
        return [Image.open(io.BytesIO(file_bytes)).convert('RGB')]
    except Exception as e:
        log_to_file(f'Image open failed: {e}')
        return []


def resize_for_vision(image: Image.Image) -> Image.Image:
    """Resize image to fit within VISION_MAX_DIM, preserving aspect ratio."""
    w, h = image.size
    if max(w, h) <= VISION_MAX_DIM:
        return image
    ratio = VISION_MAX_DIM / max(w, h)
    new_size = (int(w * ratio), int(h * ratio))
    return image.resize(new_size, Image.LANCZOS)


def image_to_jpeg_data_url(image: Image.Image, quality: int = VISION_JPEG_QUALITY) -> str:
    """Convert PIL Image to JPEG base64 data URL (much smaller than PNG)."""
    buf = io.BytesIO()
    image.save(buf, format='JPEG', quality=quality)
    b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
    return f"data:image/jpeg;base64,{b64}"


# ==================== PaddleOCR ====================

def extract_text_from_paddle_result(result: Any) -> str:
    text = ""
    def append_from_items(items):
        nonlocal text
        if not isinstance(items, list):
            return
        for item in items:
            if isinstance(item, list) and len(item) >= 2:
                value = item[1]
                if isinstance(value, (list, tuple)) and value:
                    text += str(value[0]) + "\n"
    if result and isinstance(result, list):
        for page in result:
            if isinstance(page, list):
                if page and isinstance(page[0], list) and len(page[0]) >= 2:
                    append_from_items(page)
                else:
                    for item in page:
                        if isinstance(item, list) and len(item) >= 2:
                            append_from_items([item])
    return text.strip()


def recognize_via_paddleocr(file_bytes: bytes, file_type: str | None, file_name: str | None = None) -> str:
    engine = _get_paddleocr()
    if engine is None:
        log_to_file('PaddleOCR unavailable, skipping')
        return ''
    import numpy as np
    source_images = load_source_images(file_bytes, file_type, file_name, dpi=PADDLE_DPI)
    if not source_images:
        return ''
    results: List[str] = []
    for image in source_images[:MAX_PAGES]:
        try:
            ocr_result = engine.ocr(np.array(image))
            text = extract_text_from_paddle_result(ocr_result)
            if text:
                results.append(text)
        except Exception as e:
            log_to_file(f'PaddleOCR page failed: {e}')
    return '\n'.join(results).strip()


# ==================== Vision LLM ====================

def call_vision_model(image_data_url: str, config: Dict[str, Any], page_num: int, total_pages: int) -> str:
    page_hint = f"（第{page_num}/{total_pages}页）" if total_pages > 1 else ""
    prompt = f"请识别并完整提取图片中的所有文字内容{page_hint}，保持原有格式和换行。只输出识别到的文字，不要添加任何说明。"
    payload = {
        'model': config['modelName'],
        'messages': [{
            'role': 'user',
            'content': [
                {'type': 'image_url', 'image_url': {'url': image_data_url, 'detail': 'high'}},
                {'type': 'text', 'text': prompt},
            ],
        }],
        'max_tokens': 8192,
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
    timeout_sec = int(config.get('timeoutMs') or DEFAULT_TIMEOUT_MS) / 1000
    with request.urlopen(req, timeout=timeout_sec) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        return data.get('choices', [{}])[0].get('message', {}).get('content', '') or ''


def recognize_via_vision_model(file_bytes: bytes, file_type: str | None, file_name: str | None, config: Dict[str, Any]) -> str:
    source_images = load_source_images(file_bytes, file_type, file_name, dpi=OCR_DPI)
    if not source_images:
        raise HTTPException(status_code=400, detail='无法从文件中提取图像')
    results: List[str] = []
    total_pages = len(source_images)
    for index, image in enumerate(source_images[:MAX_PAGES], start=1):
        resized = resize_for_vision(image)
        data_url = image_to_jpeg_data_url(resized)
        log_to_file(f'Vision page {index}/{total_pages}: {resized.size}, data_url={len(data_url)//1024}KB')
        try:
            text = call_vision_model(data_url, config, index, total_pages)
            if text:
                results.append(text)
        except error.HTTPError as e:
            detail = e.read().decode('utf-8', errors='ignore') if e.fp else str(e)
            log_to_file(f'Vision API error page {index}: {e.code} {detail[:300]}')
        except Exception as e:
            log_to_file(f'Vision OCR page {index} failed: {e}')
    return '\n'.join(results).strip()


# ==================== Tesseract fallback ====================

def recognize_via_tesseract(file_bytes: bytes, file_type: str | None, file_name: str | None = None) -> str:
    """Last-resort OCR using Tesseract (chi_sim+eng)."""
    try:
        import pytesseract
    except ImportError:
        log_to_file('pytesseract not installed')
        return ''
    ftype = infer_file_type(file_type, file_name)
    images = load_pdf_images(file_bytes, dpi=150) if ftype == 'pdf' else load_source_images(file_bytes, file_type, file_name)
    if not images:
        return ''
    results: List[str] = []
    for image in images[:MAX_PAGES]:
        try:
            text = pytesseract.image_to_string(image, lang='chi_sim+eng')
            if text and text.strip():
                results.append(text.strip())
        except Exception as e:
            log_to_file(f'Tesseract page failed: {e}')
    return '\n'.join(results).strip()


# ==================== Document orchestrator ====================

def recognize_document(
    file_bytes: bytes,
    file_type: str | None,
    file_name: str | None = None,
    config: Dict[str, Any] | None = None,
) -> str:
    """Three-tier OCR: Vision LLM > PaddleOCR > Tesseract."""
    # Tier 1: Vision LLM (highest quality)
    if config and config.get('apiKey') and config.get('modelName'):
        if not config.get('apiBaseUrl'):
            raise HTTPException(status_code=400, detail='缺少视觉模型 API 地址')
        try:
            text = recognize_via_vision_model(file_bytes, file_type, file_name, config)
            if text:
                log_to_file(f'Vision OCR succeeded: {len(text)} chars')
                return text
            log_to_file('Vision OCR returned empty, falling back')
        except Exception as e:
            log_to_file(f'Vision OCR failed: {e}')

    # Tier 2: PaddleOCR (local)
    try:
        text = recognize_via_paddleocr(file_bytes, file_type, file_name)
        if text:
            log_to_file(f'PaddleOCR succeeded: {len(text)} chars')
            return text
        log_to_file('PaddleOCR returned empty, falling back')
    except Exception as e:
        log_to_file(f'PaddleOCR failed: {e}')

    # Tier 3: Tesseract (last resort)
    try:
        text = recognize_via_tesseract(file_bytes, file_type, file_name)
        if text:
            log_to_file(f'Tesseract succeeded: {len(text)} chars')
            return text
    except Exception as e:
        log_to_file(f'Tesseract failed: {e}')

    log_to_file('All OCR engines failed or returned empty')
    return ''


# ==================== Endpoints ====================

@app.post('/api/ocr')
async def ocr_image(file: UploadFile = File(...)):
    contents = await file.read()
    try:
        return {'text': recognize_document(contents, file.content_type or file.filename, file.filename)}
    except HTTPException:
        raise
    except Exception as e:
        log_to_file(f'Error: {traceback.format_exc()}')
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
        config = None
        if api_key and model_name:
            config = {
                'apiBaseUrl': api_base_url or 'https://api.siliconflow.cn/v1',
                'apiKey': api_key,
                'modelName': model_name,
                'timeoutMs': timeout_ms,
            }
        result = recognize_document(file_bytes, file_type, file_name, config)
        return {'text': result}
    except HTTPException:
        raise
    except Exception as e:
        log_to_file(f'Error: {traceback.format_exc()}')
        raise HTTPException(status_code=500, detail=str(e))


@app.get('/health')
async def health_check():
    engines = ['pdf2image']
    if _get_paddleocr():
        engines.append('paddleocr')
    try:
        import pytesseract
        engines.append('tesseract')
    except ImportError:
        pass
    return {'status': 'healthy', 'service': 'OCR', 'engines': engines}


@app.get('/models')
async def get_models():
    return {
        'models': ['PaddleOCR', 'Tesseract', 'Vision-LLM'],
        'engines': ['pdf2image + vision LLM (primary)', 'PaddleOCR (fallback)', 'Tesseract (last resort)'],
    }


@app.post('/api/layout')
async def layout_analysis(file: UploadFile = File(...)):
    contents = await file.read()
    try:
        return _do_layout(contents, file.content_type or file.filename, file.filename)
    except HTTPException:
        raise
    except Exception as e:
        log_to_file(f'Layout error: {traceback.format_exc()}')
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/api/layout/base64')
async def layout_analysis_base64(data: dict):
    base64_data = data.get('image', '')
    file_type = data.get('fileType', 'pdf')
    file_name = data.get('fileName', '')
    if not base64_data:
        raise HTTPException(status_code=400, detail='缺少图片数据')
    try:
        if 'data:image/' in base64_data:
            base64_data = base64_data.split(',', 1)[1]
        file_bytes = base64.b64decode(base64_data)
        return _do_layout(file_bytes, file_type, file_name)
    except HTTPException:
        raise
    except Exception as e:
        log_to_file(f'Layout error: {traceback.format_exc()}')
        raise HTTPException(status_code=500, detail=str(e))


def _do_layout(file_bytes: bytes, file_type: str | None, file_name: str | None) -> dict:
    pipeline = _get_layout_pipeline()
    if pipeline is None:
        raise HTTPException(status_code=503, detail='PPStructureV3 不可用')
    ext = '.pdf' if infer_file_type(file_type, file_name) == 'pdf' else '.png'
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
        f.write(file_bytes)
        temp_path = f.name
    try:
        output = pipeline.predict(input=temp_path)
        layout_blocks = []
        markdown_texts = []
        for page_res in output:
            md_info = getattr(page_res, 'markdown', None)
            if isinstance(md_info, dict):
                md_text = md_info.get('markdown_text', '')
                if md_text:
                    markdown_texts.append(md_text)
            page_data = getattr(page_res, 'res', None)
            if not isinstance(page_data, list):
                continue
            for block in page_data:
                if not isinstance(block, dict):
                    continue
                raw = block.get('res')
                content = None
                if isinstance(raw, dict):
                    content = raw.get('html') or raw
                elif isinstance(raw, list):
                    texts = [str(i[1][0]) if isinstance(i, list) and len(i) >= 2 and isinstance(i[1], (list, tuple)) and i[1] else str(i[1]) if isinstance(i, list) and len(i) >= 2 else '' for i in raw]
                    content = '\n'.join(t for t in texts if t) or None
                elif raw is not None:
                    content = str(raw)
                layout_blocks.append({
                    'type': block.get('type', 'unknown'),
                    'bbox': block.get('bbox', [0, 0, 0, 0]),
                    'confidence': block.get('confidence', 0.0),
                    'content': content,
                })
        result = {'layout': layout_blocks}
        if markdown_texts:
            result['markdown'] = '\n'.join(markdown_texts)
        return result
    finally:
        os.unlink(temp_path)


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
