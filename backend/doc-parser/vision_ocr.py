"""
视觉模型 OCR — 用于扫描件 PDF 文字提取
PDF → pdf2image 转图片 → 缩放 → JPEG 压缩 → 调视觉大模型 API → 返回文字
"""

import base64
import io
import json
import logging
import time
from typing import Any, Dict, List, Optional
from urllib import error, request

from PIL import Image
from pdf2image import convert_from_bytes

logger = logging.getLogger("doc-parser-service")

# 配置常量
VISION_MAX_DIM = 1200        # 图片最长边上限（像素）
VISION_JPEG_QUALITY = 80     # JPEG 压缩质量
OCR_DPI = 100                # PDF→图片 DPI（越低越快）
MAX_PAGES = 100              # 最多处理页数
DEFAULT_TIMEOUT_SEC = 300    # API 超时（秒）


def _resize_for_vision(image: Image.Image) -> Image.Image:
    """缩放图片到 VISION_MAX_DIM，保持纵横比。"""
    w, h = image.size
    if max(w, h) <= VISION_MAX_DIM:
        return image
    ratio = VISION_MAX_DIM / max(w, h)
    return image.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)


def _image_to_jpeg_data_url(image: Image.Image) -> str:
    """PIL Image → JPEG base64 data URL。"""
    buf = io.BytesIO()
    image.save(buf, format='JPEG', quality=VISION_JPEG_QUALITY)
    b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
    return f"data:image/jpeg;base64,{b64}"


def _call_vision_api(image_data_url: str, config: Dict[str, Any], page_num: int, total_pages: int) -> str:
    """调用视觉大模型 API 识别单页图片文字。"""
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

    timeout_sec = config.get('timeoutSec', DEFAULT_TIMEOUT_SEC)
    req = request.Request(
        url=f"{config['apiBaseUrl'].rstrip('/')}/chat/completions",
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f"Bearer {config['apiKey']}",
        },
        method='POST',
    )

    with request.urlopen(req, timeout=timeout_sec) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        return data.get('choices', [{}])[0].get('message', {}).get('content', '') or ''


def recognize_with_vision(
    file_bytes: bytes,
    file_type: str,
    file_name: str,
    config: Dict[str, Any],
) -> str:
    """
    使用视觉大模型识别文件中的文字。

    Args:
        file_bytes: 文件原始字节
        file_type: 文件类型 (pdf/png/jpg等)
        file_name: 文件名
        config: 视觉模型配置 {apiBaseUrl, apiKey, modelName, timeoutSec?}

    Returns:
        提取的文字内容，失败返回空字符串
    """
    if not config.get('apiKey') or not config.get('modelName'):
        logger.warning('Vision OCR: 缺少 apiKey 或 modelName')
        return ''

    if not config.get('apiBaseUrl'):
        logger.warning('Vision OCR: 缺少 apiBaseUrl')
        return ''

    start_time = time.time()

    # PDF → 图片
    is_pdf = file_type.lower() in ('pdf',) or file_name.lower().endswith('.pdf')
    if is_pdf:
        try:
            images = list(convert_from_bytes(file_bytes, dpi=OCR_DPI, first_page=1, last_page=MAX_PAGES))
        except Exception as e:
            logger.error(f'Vision OCR: pdf2image 转换失败: {e}')
            return ''
    else:
        # 单张图片
        try:
            images = [Image.open(io.BytesIO(file_bytes)).convert('RGB')]
        except Exception as e:
            logger.error(f'Vision OCR: 图片打开失败: {e}')
            return ''

    if not images:
        logger.warning('Vision OCR: 未提取到页面')
        return ''

    total_pages = len(images)
    logger.info(f'Vision OCR: {file_name}, {total_pages} 页, DPI={OCR_DPI}')

    results: List[str] = []
    for index, image in enumerate(images[:MAX_PAGES], start=1):
        resized = _resize_for_vision(image)
        data_url = _image_to_jpeg_data_url(resized)
        logger.info(f'Vision OCR: 页 {index}/{total_pages}, 尺寸 {resized.size}, data_url {len(data_url)//1024}KB')

        try:
            text = _call_vision_api(data_url, config, index, total_pages)
            if text:
                results.append(text)
                logger.info(f'Vision OCR: 页 {index} 识别成功, {len(text)} 字符')
            else:
                logger.warning(f'Vision OCR: 页 {index} 返回空文本')
        except error.HTTPError as e:
            detail = e.read().decode('utf-8', errors='ignore') if e.fp else str(e)
            logger.error(f'Vision OCR: 页 {index} API 错误 {e.code}: {detail[:300]}')
        except Exception as e:
            logger.error(f'Vision OCR: 页 {index} 失败: {e}')

    full_text = '\n'.join(results).strip()
    elapsed = time.time() - start_time
    logger.info(f'Vision OCR 完成: {file_name}, {len(full_text)} 字符, {elapsed:.1f}s')
    return full_text
