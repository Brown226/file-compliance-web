"""OCR Service — Vision LLM primary + PaddleOCR fallback + Tesseract fallback"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import tempfile
import traceback
from html.parser import HTMLParser
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


# ==================== Table KV Extraction (PP-Structure) ====================

class _HtmlTableParser(HTMLParser):
    """从 HTML 表格中提取行数据（每行是一个单元格文本列表）。"""

    def __init__(self) -> None:
        super().__init__()
        self.rows: List[List[str]] = []
        self._cur_row: Optional[List[str]] = None
        self._cur_cell: Optional[List[str]] = None
        # 标签栈用于过滤 <td>/<th> 内部的嵌套标签（如 <span>、<p>）
        self._in_cell = False

    def handle_starttag(self, tag: str, attrs):
        if tag in ('tr',):
            self._cur_row = []
        elif tag in ('td', 'th'):
            self._cur_cell = []
            self._in_cell = True

    def handle_endtag(self, tag: str):
        if tag in ('tr',) and self._cur_row is not None:
            self.rows.append(self._cur_row)
            self._cur_row = None
        elif tag in ('td', 'th') and self._cur_cell is not None:
            text = ''.join(self._cur_cell).strip()
            # 把 <br> 转换后的换行、多空格压缩
            text = re.sub(r'\s+', ' ', text)
            if self._cur_row is not None:
                self._cur_row.append(text)
            self._cur_cell = None
            self._in_cell = False

    def handle_data(self, data: str):
        if self._in_cell and self._cur_cell is not None:
            self._cur_cell.append(data)


def _parse_html_table(html: str) -> List[List[str]]:
    """解析 HTML 表格，返回行列表（每行是单元格文本列表）。"""
    if not html:
        return []
    parser = _HtmlTableParser()
    try:
        parser.feed(html)
    except Exception as e:
        log_to_file(f'HTML table parse failed: {e}')
    return [row for row in parser.rows if row]


def _rows_to_kv_pairs(rows: List[List[str]]) -> List[Dict[str, str]]:
    """
    把表格行转换为键值对：
    - 二列表格：第一列=键，第二列=值
    - 多列表格：第一列=键，其余列用空格拼接为值
    - 跳过空行/空键
    """
    pairs: List[Dict[str, str]] = []
    for row in rows:
        if not row or len(row) < 2:
            continue
        key = (row[0] or '').strip()
        if not key:
            continue
        # 二列表格直接取第二列；多列表格把剩余列拼接
        if len(row) == 2:
            value = (row[1] or '').strip()
        else:
            value = ' '.join((c or '').strip() for c in row[1:] if (c or '').strip())
        if not value:
            continue
        pairs.append({'key': key, 'value': value})
    return pairs


def _extract_tables_from_layout(output: Any) -> List[Dict[str, Any]]:
    """
    从 PPStructureV3 的输出中提取所有表格块，解析为 KV 对。
    返回：[{ rows: [[c1, c2, ...], ...], kv_pairs: [{key, value}, ...] }]
    """
    tables: List[Dict[str, Any]] = []
    if not output:
        return tables

    for page_res in output:
        page_data = getattr(page_res, 'res', None)
        if not isinstance(page_data, list):
            continue
        for block in page_data:
            if not isinstance(block, dict):
                continue
            if block.get('type') != 'table':
                continue
            raw = block.get('res')
            html = None
            if isinstance(raw, dict):
                html = raw.get('html')
            elif isinstance(raw, str):
                html = raw
            if not html:
                continue
            rows = _parse_html_table(html)
            if not rows:
                continue
            kv_pairs = _rows_to_kv_pairs(rows)
            tables.append({'rows': rows, 'kv_pairs': kv_pairs})

    return tables


def _do_table_extraction(file_bytes: bytes, file_type: str | None, file_name: str | None) -> dict:
    """使用 PPStructureV3 提取表格 KV 对。"""
    pipeline = _get_layout_pipeline()
    if pipeline is None:
        raise HTTPException(status_code=503, detail='PPStructureV3 不可用，无法识别表格')

    ext = '.pdf' if infer_file_type(file_type, file_name) == 'pdf' else '.png'
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
        f.write(file_bytes)
        temp_path = f.name
    try:
        output = pipeline.predict(input=temp_path)
        tables = _extract_tables_from_layout(output)
        # 扁平化所有表格的 KV 对到一个列表
        all_kv_pairs: List[Dict[str, str]] = []
        for t in tables:
            all_kv_pairs.extend(t['kv_pairs'])
        log_to_file(f'Table extraction: {len(tables)} tables, {len(all_kv_pairs)} kv pairs')
        return {'tables': tables, 'kv_pairs': all_kv_pairs}
    finally:
        os.unlink(temp_path)


@app.post('/api/ocr/table')
async def ocr_table(file: UploadFile = File(...)):
    """
    使用 PP-Structure 识别文件中的表格，输出二列键值对。
    输出格式: { tables: [{ rows, kv_pairs }], kv_pairs: [{key, value}] }
    仅处理 PPStructureV3 识别到的 type='table' 块。
    """
    contents = await file.read()
    try:
        return _do_table_extraction(contents, file.content_type or file.filename, file.filename)
    except HTTPException:
        raise
    except Exception as e:
        log_to_file(f'Table OCR error: {traceback.format_exc()}')
        raise HTTPException(status_code=500, detail=str(e))


@app.post('/api/ocr/table/base64')
async def ocr_table_base64(data: dict):
    """Base64 输入的表格识别端点（与 /api/ocr/table 等价）。"""
    base64_data = data.get('image', '')
    file_type = data.get('fileType', 'pdf')
    file_name = data.get('fileName', '')
    if not base64_data:
        raise HTTPException(status_code=400, detail='缺少图片数据')
    try:
        if 'data:image/' in base64_data:
            base64_data = base64_data.split(',', 1)[1]
        file_bytes = base64.b64decode(base64_data)
        return _do_table_extraction(file_bytes, file_type, file_name)
    except HTTPException:
        raise
    except Exception as e:
        log_to_file(f'Table OCR base64 error: {traceback.format_exc()}')
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Batch Layout Analysis (Task 38) ====================

def _do_layout_single(file_bytes: bytes, file_type: str | None, file_name: str | None) -> dict:
    """单张图片的版面分析（复用 _do_layout 逻辑，错误时返回 error 字段而非抛异常）。

    用于批量接口内部调用，避免单张失败影响整批。
    """
    try:
        return _do_layout(file_bytes, file_type, file_name)
    except HTTPException as e:
        return {'error': e.detail if hasattr(e, 'detail') else str(e), 'fileName': file_name}
    except Exception as e:
        return {'error': str(e), 'fileName': file_name}


@app.post('/api/layout/batch')
async def layout_analysis_batch(files: List[UploadFile] = File(...)):
    """
    Task 38: 批量版面分析接口

    接收多张图片（multipart/form-data，字段名 files），复用 PaddleOCR PPStructureV3 实例
    串行批推理（PaddleOCR 实例非线程安全，避免并发调用），返回与输入顺序一致的结果数组。

    - 单张失败不影响其他图片，失败项返回 { error, fileName }
    - 全部失败时仍返回 200，结果数组中每项都含 error 字段
    - 单次最多 20 张图片（防止内存爆炸）

    返回格式: { results: [{ layout, markdown } | { error, fileName }, ...], total, succeeded, failed }
    """
    if not files:
        raise HTTPException(status_code=400, detail='缺少图片文件')

    BATCH_LIMIT = 20
    if len(files) > BATCH_LIMIT:
        raise HTTPException(status_code=400, detail=f'批量接口单次最多 {BATCH_LIMIT} 张图片，本次提交 {len(files)} 张')

    # 一次性读取所有文件内容（避免 upload file 句柄在异步循环中过期）
    payloads: List[tuple] = []
    for f in files:
        contents = await f.read()
        payloads.append((contents, f.content_type or f.filename, f.filename))

    # PaddleOCR 实例非线程安全，串行处理
    results: List[dict] = []
    succeeded = 0
    failed = 0
    for file_bytes, file_type, file_name in payloads:
        if not file_bytes:
            results.append({'error': '空文件', 'fileName': file_name})
            failed += 1
            continue
        r = _do_layout_single(file_bytes, file_type, file_name)
        if 'error' in r:
            failed += 1
        else:
            succeeded += 1
        if file_name:
            r.setdefault('fileName', file_name)
        results.append(r)

    log_to_file(f'Batch layout: total={len(results)}, succeeded={succeeded}, failed={failed}')
    return {
        'results': results,
        'total': len(results),
        'succeeded': succeeded,
        'failed': failed,
    }


@app.post('/api/layout/batch/base64')
async def layout_analysis_batch_base64(data: dict):
    """
    Task 38: 批量版面分析接口（base64 输入版本）

    请求体格式: { images: [{ image: '<base64>', fileType: 'png', fileName: 'x.png' }, ...] }
    返回格式与 /api/layout/batch 一致

    适用于前端已将图片转为 base64 的场景（如 DWG 渲染后的 PNG 直接送审）。
    """
    images = data.get('images', [])
    if not images or not isinstance(images, list):
        raise HTTPException(status_code=400, detail='缺少 images 数组')

    BATCH_LIMIT = 20
    if len(images) > BATCH_LIMIT:
        raise HTTPException(status_code=400, detail=f'批量接口单次最多 {BATCH_LIMIT} 张图片，本次提交 {len(images)} 张')

    results: List[dict] = []
    succeeded = 0
    failed = 0
    for idx, item in enumerate(images):
        if not isinstance(item, dict):
            results.append({'error': f'第 {idx + 1} 项格式错误', 'fileName': None})
            failed += 1
            continue
        base64_data = item.get('image', '')
        file_type = item.get('fileType', 'png')
        file_name = item.get('fileName', f'image_{idx + 1}')
        if not base64_data:
            results.append({'error': '缺少图片数据', 'fileName': file_name})
            failed += 1
            continue
        try:
            if 'data:image/' in base64_data:
                base64_data = base64_data.split(',', 1)[1]
            file_bytes = base64.b64decode(base64_data)
        except Exception as e:
            results.append({'error': f'base64 解码失败: {e}', 'fileName': file_name})
            failed += 1
            continue
        r = _do_layout_single(file_bytes, file_type, file_name)
        if 'error' in r:
            failed += 1
        else:
            succeeded += 1
        r.setdefault('fileName', file_name)
        results.append(r)

    log_to_file(f'Batch layout base64: total={len(results)}, succeeded={succeeded}, failed={failed}')
    return {
        'results': results,
        'total': len(results),
        'succeeded': succeeded,
        'failed': failed,
    }


if __name__ == '__main__':
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)
