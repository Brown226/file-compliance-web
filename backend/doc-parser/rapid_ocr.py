"""
RapidOCR 本地 OCR 引擎 — 轻量、离线、纯 CPU
用于扫描件 PDF / 图片的文字识别，无需外网 API。
PDF 页面渲染使用 pdftoppm（poppler-utils，无需 PyMuPDF）。
"""

import io
import logging
import os
import time
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image

logger = logging.getLogger("doc-parser-service")

# 配置常量
OCR_DPI = 150                # PDF→图片渲染 DPI（平衡质量与速度）
MAX_PAGES = 100              # 最多处理页数
CONFIDENCE_THRESHOLD = 0.7   # 平均置信度阈值，低于此值视为识别质量不足

# RapidOCR 模型根目录（可被环境变量 RAPIDOCR_MODEL_DIR 覆盖，默认与脚本同目录的 models/ 子目录）
MODEL_ROOT_DIR = os.environ.get(
    "RAPIDOCR_MODEL_DIR",
    str(Path(__file__).resolve().parent / "models"),
)

# 延迟初始化 RapidOCR 实例（避免启动时加载模型耗时）
_ocr_engine = None


def _get_engine():
    """延迟初始化 RapidOCR 引擎（单例）"""
    global _ocr_engine
    if _ocr_engine is None:
        try:
            from rapidocr import RapidOCR
            # rapidocr>=3.9 配合 omegaconf 2.x 时，Global.model_root_dir 若为
            # PosixPath 会触发 "not a supported primitive type" 报错。
            # 必须显式传字符串路径（点分 key）绕过该兼容问题。
            _ocr_engine = RapidOCR(
                params={"Global.model_root_dir": MODEL_ROOT_DIR}
            )
            logger.info("RapidOCR 引擎初始化成功, model_root_dir=%s", MODEL_ROOT_DIR)
        except ImportError as e:
            logger.error(f"RapidOCR 未安装: {e}")
            raise
        except Exception as e:
            logger.error(f"RapidOCR 初始化失败: {e}")
            raise
    return _ocr_engine


def _pdf_to_images(file_bytes: bytes, dpi: int = OCR_DPI, max_pages: int = MAX_PAGES, pages: Optional[list] = None) -> list:
    """
    用 pdftoppm（poppler-utils）将 PDF 渲染为 PIL Image 列表。
    替代 PyMuPDF（已从依赖移除）。
    pages: 仅渲染指定页（1-indexed 页码列表，来自 pdf-inspector 的 pages_needing_ocr）；
           为 None 时渲染全部页（受 max_pages 限制）。
    """
    import subprocess
    import tempfile

    with tempfile.TemporaryDirectory() as tmp_dir:
        pdf_path = os.path.join(tmp_dir, 'input.pdf')
        with open(pdf_path, 'wb') as f:
            f.write(file_bytes)

        # 页范围：pages 非空则渲染 min~max（pdftoppm 按页号命名，渲染后筛选）
        if pages:
            f_page = max(1, min(pages))
            l_page = min(max(pages), max_pages)
        else:
            f_page, l_page = 1, max_pages

        out_prefix = os.path.join(tmp_dir, 'page')
        try:
            subprocess.run(
                ['pdftoppm', '-png', '-r', str(dpi), '-f', str(f_page), '-l', str(l_page),
                 pdf_path, out_prefix],
                check=True, capture_output=True, timeout=180,
            )
        except FileNotFoundError:
            logger.error("pdftoppm 未安装（需 poppler-utils 系统包）")
            return []
        except subprocess.TimeoutExpired:
            logger.error(f"pdftoppm 渲染超时（{l_page - f_page + 1} 页, DPI={dpi}）")
            return []
        except subprocess.CalledProcessError as e:
            logger.error(f"pdftoppm 渲染失败: {e.stderr.decode('utf-8', errors='ignore')[:200]}")
            return []

        images = []
        for fn in sorted(os.listdir(tmp_dir)):
            if not fn.startswith('page-'):
                continue
            try:
                page_num = int(fn.split('-')[1].split('.')[0])
            except (IndexError, ValueError):
                continue
            if pages and page_num not in pages:
                continue
            try:
                img = Image.open(os.path.join(tmp_dir, fn)).convert('RGB')
                images.append(img)
            except Exception as e:
                logger.warning(f"页面图片打开失败: {fn} - {e}")

    return images


def _ocr_single_image(engine, image: Image.Image) -> tuple:
    """
    对单张图片执行 OCR。
    返回 (识别文本, 平均置信度)
    """
    img_array = np.array(image)
    result = engine(img_array)

    # RapidOCR 3.x 返回 RapidOCROutput 对象或列表
    texts = []
    scores = []

    if result is None:
        return "", 0.0

    # 兼容 RapidOCR 3.8+ 的 RapidOCROutput 对象
    if hasattr(result, 'txts') and result.txts is not None:
        texts = list(result.txts)
        scores = [float(s) for s in result.scores] if result.scores else []
    elif isinstance(result, (list, tuple)):
        # 旧版格式: [[box, (text, score)], ...]
        for item in result:
            if isinstance(item, (list, tuple)) and len(item) >= 2:
                text_score = item[1]
                if isinstance(text_score, (list, tuple)) and len(text_score) >= 2:
                    texts.append(str(text_score[0]))
                    scores.append(float(text_score[1]))

    full_text = "\n".join(texts)
    avg_confidence = sum(scores) / len(scores) if scores else 0.0

    return full_text, avg_confidence


def recognize_with_rapidocr(
    file_bytes: bytes,
    file_type: str,
    file_name: str,
    pages: Optional[list] = None,
) -> Optional[dict]:
    """
    使用 RapidOCR 本地引擎识别文件中的文字。

    Args:
        file_bytes: 文件原始字节
        file_type: 文件类型 (pdf/png/jpg 等)
        file_name: 文件名（用于日志）
        pages: 仅识别指定页（1-indexed，来自 pdf-inspector 的 pages_needing_ocr）；
               为 None 时识别全部页。

    Returns:
        成功: {'text': str, 'confidence': float, 'engine': 'rapidocr'}
        失败: None
    """
    start_time = time.time()

    try:
        engine = _get_engine()
    except Exception:
        return None

    # PDF → 图片列表
    is_pdf = file_type.lower() in ('pdf',) or file_name.lower().endswith('.pdf')
    if is_pdf:
        try:
            images = _pdf_to_images(file_bytes, pages=pages)
        except Exception as e:
            logger.error(f"RapidOCR: PDF 渲染失败: {file_name} - {e}")
            return None
    else:
        # 单张图片
        try:
            images = [Image.open(io.BytesIO(file_bytes)).convert('RGB')]
        except Exception as e:
            logger.error(f"RapidOCR: 图片打开失败: {file_name} - {e}")
            return None

    if not images:
        logger.warning(f"RapidOCR: 未提取到页面: {file_name}")
        return None

    total_pages = len(images)
    if pages:
        logger.info(f"RapidOCR: 开始识别 {file_name}, 仅 {len(pages)} 页需 OCR: {pages}, DPI={OCR_DPI}")
    else:
        logger.info(f"RapidOCR: 开始识别 {file_name}, {total_pages} 页, DPI={OCR_DPI}")

    # 逐页识别
    page_texts = []
    all_scores = []

    for index, image in enumerate(images, start=1):
        try:
            text, confidence = _ocr_single_image(engine, image)
            if text.strip():
                page_texts.append(text)
                all_scores.append(confidence)
                logger.info(f"RapidOCR: 页 {index}/{total_pages} 识别完成, "
                           f"{len(text)} 字符, 置信度 {confidence:.3f}")
            else:
                logger.warning(f"RapidOCR: 页 {index}/{total_pages} 未识别到文字")
        except Exception as e:
            logger.error(f"RapidOCR: 页 {index}/{total_pages} 识别失败: {e}")

    if not page_texts:
        logger.warning(f"RapidOCR: 全部页面识别为空: {file_name}")
        return None

    full_text = "\n".join(page_texts).strip()
    avg_confidence = sum(all_scores) / len(all_scores) if all_scores else 0.0
    elapsed = time.time() - start_time

    logger.info(f"RapidOCR 完成: {file_name}, {len(full_text)} 字符, "
               f"平均置信度 {avg_confidence:.3f}, 耗时 {elapsed:.1f}s")

    return {
        'text': full_text,
        'confidence': avg_confidence,
        'engine': 'rapidocr',
    }
