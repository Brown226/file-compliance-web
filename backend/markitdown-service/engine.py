"""
精简版 MarkItDown 引擎
- 仅注册 DOCX / XLSX / PDF / PPTX 四种转换器
- 去除其他不必要格式支持
"""

import logging

logger = logging.getLogger("markitdown-service")


def create_engine():
    """
    创建精简版 MarkItDown 引擎，仅支持 DOCX/XLSX/PDF/PPTX
    """
    from markitdown import MarkItDown
    from markitdown.converters import (
        DocxConverter,
        XlsxConverter,
        PdfConverter,
        PptxConverter,
    )

    md = MarkItDown(enable_plugins=False)

    # 清除默认注册的所有转换器
    md._converters = []

    # 仅注册四种格式（专格式优先级 0.0）
    md.register_converter(DocxConverter(), priority=0.0)
    md.register_converter(XlsxConverter(), priority=0.0)
    md.register_converter(PdfConverter(), priority=0.0)
    md.register_converter(PptxConverter(), priority=0.0)

    logger.info("精简版 MarkItDown 引擎初始化完成（DOCX/XLSX/PDF/PPTX）")
    return md


# ==================== 支持的格式 ====================

SUPPORTED_EXTENSIONS = {".docx", ".xlsx", ".pdf", ".pptx"}


def convert_bytes(content: bytes, filename: str, engine=None) -> dict:
    """
    便捷函数：将文件字节内容转换为 Markdown

    Args:
        content: 文件字节内容
        filename: 文件名（含扩展名）
        engine: MarkItDown 引擎实例（可选，默认懒加载）

    Returns:
        dict: { success, markdown, extension, filename, char_count, error }
    """
    import os
    import time
    from io import BytesIO

    ext = os.path.splitext(filename)[1].lower()

    if ext not in SUPPORTED_EXTENSIONS:
        return {
            "success": False,
            "markdown": "",
            "extension": ext,
            "filename": filename,
            "char_count": 0,
            "error": f"不支持的文件格式: {ext}",
        }

    start_time = time.time()
    try:
        if engine is None:
            engine = create_engine()

        stream = BytesIO(content)
        result = engine.convert_stream(stream, file_extension=ext)
        markdown_text = result.text_content or ""

        duration_ms = int((time.time() - start_time) * 1000)
        logger.info(
            f"转换完成: {filename} → {len(markdown_text)} chars, {duration_ms}ms"
        )

        return {
            "success": True,
            "markdown": markdown_text,
            "extension": ext,
            "filename": filename,
            "char_count": len(markdown_text),
            "duration_ms": duration_ms,
            "error": "",
        }

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        logger.error(f"转换失败: {filename} - {e}", exc_info=True)
        return {
            "success": False,
            "markdown": "",
            "extension": ext,
            "filename": filename,
            "char_count": 0,
            "duration_ms": duration_ms,
            "error": str(e),
        }
