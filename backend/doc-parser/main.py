"""
文档解析服务 - FastAPI 应用
支持格式：DOCX / XLSX / PDF / PPTX → Markdown + 结构化数据
DWG 文件已改为前端 WASM 解析（@mlightcad/libredwg-web），后端不再处理

解析策略：MarkItDown 为主力引擎，现有增强解析器为 fallback。
"""

import os
import re
import time
import base64
import logging
import subprocess
import tempfile
from io import BytesIO
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("doc-parser-service")

app = FastAPI(
    title="文档解析服务",
    description="将 DOCX/XLSX/PDF/PPTX 文档转换为 Markdown 格式 + 结构化解析数据。DWG 文件已改为前端 WASM 解析。",
    version="4.0.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==================== 常量 ====================

SUPPORTED_EXTENSIONS = {".doc", ".docx", ".xlsx", ".pdf", ".pptx"}

# 文件类型 → 扩展名映射
FILE_TYPE_MAP = {
    "docx": ".docx",
    "doc": ".docx",
    "xlsx": ".xlsx",
    "xls": ".xlsx",
    "pdf": ".pdf",
    "pptx": ".pptx",
    "ppt": ".pptx",
}


# ==================== 响应模型 ====================

class ConvertResult(BaseModel):
    success: bool
    markdown: str = ""
    extension: str = ""
    filename: str = ""
    char_count: int = 0
    duration_ms: int = 0
    error: str = ""


class VisionOCRConfig(BaseModel):
    apiBaseUrl: str
    apiKey: str
    modelName: str
    timeoutSec: int = 300


class HealthResult(BaseModel):
    status: str = "ok"
    version: str = "4.0.0"
    supported_formats: list[str] = list(SUPPORTED_EXTENSIONS)


# ==================== 增强解析器调度 ====================

def convert_doc_to_docx(content: bytes, filename: str) -> Optional[bytes]:
    """
    使用 LibreOffice 将 .doc 文件转换为 .docx
    返回转换后的 .docx 内容，失败时返回 None
    """
    with tempfile.TemporaryDirectory() as tmp_dir:
        doc_path = os.path.join(tmp_dir, filename)
        with open(doc_path, 'wb') as f:
            f.write(content)

        try:
            subprocess.run(
                ['soffice', '--headless', '--convert-to', 'docx', '--outdir', tmp_dir, doc_path],
                timeout=60,
                check=True,
                capture_output=True,
            )

            base_name = os.path.splitext(filename)[0]
            docx_path = os.path.join(tmp_dir, f'{base_name}.docx')

            if not os.path.exists(docx_path):
                logger.error(f"LibreOffice 转换失败：未生成 .docx 文件")
                return None

            with open(docx_path, 'rb') as f:
                return f.read()
        except subprocess.TimeoutExpired:
            logger.error("LibreOffice 转换超时")
            return None
        except subprocess.CalledProcessError as e:
            logger.error(f"LibreOffice 转换失败: {e.stderr.decode('utf-8', errors='ignore')}")
            return None
        except Exception as e:
            logger.error(f"转换异常: {e}")
            return None


def _parse_with_markitdown(content: bytes, ext: str, filename: str) -> Optional[dict]:
    """
    使用 MarkItDown 统一引擎解析文档，返回与现有格式兼容的结构。
    MarkItDown 输出结构化 Markdown（标题/表格/列表），天然适合 LLM 审查。
    """
    try:
        from markitdown import MarkItDown

        md = MarkItDown()

        # MarkItDown 需要文件路径，写入临时文件
        suffix = ext if ext.startswith('.') else f'.{ext}'
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        try:
            result = md.convert(tmp_path)
            markdown_text = result.text_content if result else ''
        finally:
            os.unlink(tmp_path)

        if not markdown_text or not markdown_text.strip():
            return None

        # 构建与现有格式兼容的响应结构
        lines = markdown_text.split('\n')
        paragraphs = []
        headers = []
        for i, line in enumerate(lines):
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith('#'):
                level = len(stripped) - len(stripped.lstrip('#'))
                headers.append({'text': stripped.lstrip('#').strip(), 'level': level, 'line': i})
            paragraphs.append({'text': stripped, 'style': 'Heading' if stripped.startswith('#') else 'Normal', 'page': 0})

        return {
            'text': markdown_text,
            'pages': [markdown_text],
            'metadata': {
                'page_count': 1,
                'has_tables': '|' in markdown_text,
                'has_images': False,
                'parse_error': None,
                'engine': 'markitdown',
            },
            'structure': {
                'paragraphs': paragraphs,
                'tables': [],
                'headers': headers,
                'dimensions': [],
            },
            'markdown': markdown_text,
        }
    except ImportError:
        logger.warning("MarkItDown 未安装，跳过")
        return None
    except Exception as e:
        logger.warning(f"MarkItDown 解析失败: {filename} - {e}")
        return None


def _parse_with_enhanced(content: bytes, ext: str, filename: str, vision_config: Optional[dict] = None) -> Optional[dict]:
    """
    统一解析调度：MarkItDown 为主力引擎，现有增强解析器为 fallback。
    """
    # .doc 文件需要先转换为 .docx
    if ext == ".doc":
        logger.info(f"检测到 .doc 文件，使用 LibreOffice 转换为 .docx: {filename}")
        docx_content = convert_doc_to_docx(content, filename)
        if docx_content:
            content = docx_content
            ext = ".docx"
        else:
            logger.error(f".doc 文件转换失败: {filename}")
            return None

    # === 主力引擎：MarkItDown ===
    result = _parse_with_markitdown(content, ext, filename)
    if result:
        logger.info(f"MarkItDown 解析成功: {filename} ({len(result['text'])} chars)")
        return result

    # === Fallback：现有增强解析器 ===
    logger.info(f"MarkItDown 未产出结果，降级到增强解析器: {filename}")

    if ext == ".pdf":
        try:
            from pdf_enhanced import enhanced_pdf_parse
            result = enhanced_pdf_parse(content, filename)
            if result:
                return result
        except Exception as e:
            logger.warning(f"PDF 增强解析失败: {e}")

        # 扫描件 PDF 降级：文本提取为空时尝试视觉模型 OCR
        if vision_config and vision_config.get('apiKey') and vision_config.get('modelName'):
            try:
                from vision_ocr import recognize_with_vision
                ocr_text = recognize_with_vision(content, 'pdf', filename, vision_config)
                if ocr_text:
                    logger.info(f"视觉模型 OCR 识别成功: {filename}, {len(ocr_text)} 字符")
                    return {
                        'text': ocr_text,
                        'pages': [ocr_text],
                        'metadata': {
                            'page_count': 1,
                            'has_tables': False,
                            'has_images': True,
                            'parse_error': None,
                            'ocr_engine': 'vision-llm',
                        },
                        'structure': {
                            'paragraphs': [{'text': line, 'style': 'Normal', 'page': 0}
                                           for line in ocr_text.split('\n') if line.strip()],
                            'tables': [],
                            'headers': [],
                            'dimensions': [],
                        },
                        'markdown': ocr_text,
                    }
            except Exception as e:
                logger.error(f"视觉模型 OCR 失败: {filename} - {e}")

    elif ext == ".docx":
        try:
            from docx_enhanced import enhanced_docx_parse
            result = enhanced_docx_parse(content, filename)
            if result:
                return result
        except Exception as e:
            logger.warning(f"DOCX 增强解析失败: {e}")

    elif ext == ".xlsx":
        try:
            from xlsx_enhanced import enhanced_xlsx_parse
            result = enhanced_xlsx_parse(content, filename)
            if result:
                return result
        except Exception as e:
            logger.warning(f"XLSX 增强解析失败: {e}")
            raise HTTPException(status_code=500, detail=f"XLSX 文件解析失败: {filename}。{e}")

    elif ext == ".pptx":
        try:
            from pptx_enhanced import enhanced_pptx_parse
            result = enhanced_pptx_parse(content, filename)
            if result:
                return result
        except Exception as e:
            logger.warning(f"PPTX 增强解析失败: {e}")

    return None


# ==================== API 路由 ====================

@app.get("/health", response_model=HealthResult, summary="健康检查")
async def health_check():
    return HealthResult()


@app.post("/api/parse", summary="文件解析")
async def parse_file(
    file: UploadFile = File(..., description="待解析的文档文件"),
    file_type: str = Form("", description="文件类型（docx/xlsx/pdf/pptx）"),
    vision_api_key: str = Form("", description="视觉模型 API Key（可选，用于扫描件 OCR）"),
    vision_model_name: str = Form("", description="视觉模型名称（可选）"),
    vision_base_url: str = Form("", description="视觉模型 API 地址（可选）"),
):
    """
    解析文档文件，返回结构化解析结果 + Markdown。
    各格式使用独立的增强解析器（原生 Python 库）。
    """
    filename = file.filename or "unknown"
    ext = FILE_TYPE_MAP.get(file_type.lower())
    if not ext:
        ext = os.path.splitext(filename)[1].lower()

    # DWG/DXF 不再支持后端解析
    if file_type.lower() in ("dwg", "dxf") or ext in (".dwg", ".dxf"):
        raise HTTPException(
            status_code=400,
            detail="DWG/DXF 文件已改为前端 WASM 解析，后端不再提供解析服务。",
        )

    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件格式: {ext}。支持: {', '.join(sorted(SUPPORTED_EXTENSIONS))}",
        )

    start_time = time.time()
    try:
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="文件内容为空")

        logger.info(f"开始解析: {filename} ({len(content)} bytes, type={file_type or ext})")

        # 构建 vision_config（可选，用于扫描件 PDF OCR 降级）
        vision_config = None
        if vision_api_key and vision_model_name:
            vision_config = {
                'apiKey': vision_api_key,
                'modelName': vision_model_name,
                'baseUrl': vision_base_url or None,
            }

        result = _parse_with_enhanced(content, ext, filename, vision_config=vision_config)
        if result:
            duration_ms = int((time.time() - start_time) * 1000)
            logger.info(f"解析完成: {filename} → {len(result['text'])} chars, {duration_ms}ms")
            return {"code": 200, "message": "success", "data": result}

        # 所有解析器均失败
        raise HTTPException(
            status_code=500,
            detail=f"文件解析失败: {filename}。请确认文件格式正确且未损坏（可能是旧版 .xls 格式但扩展名为 .xlsx）。",
        )

    except HTTPException:
        raise
    except ImportError as e:
        logger.error(f"依赖缺失: {e}")
        raise HTTPException(status_code=500, detail=f"服务配置错误，缺少依赖: {str(e)}")
    except Exception as e:
        logger.error(f"解析失败: {filename} - {e}", exc_info=True)
        return {
            "code": 500,
            "message": str(e),
            "data": {
                "text": "",
                "pages": [],
                "metadata": {"parse_error": str(e)},
                "structure": {"paragraphs": [], "tables": [], "headers": [], "dimensions": []},
                "markdown": "",
            },
        }


@app.post("/api/convert", response_model=ConvertResult, summary="文件转换（仅 Markdown）")
async def convert_file(
    file: UploadFile = File(..., description="待转换的文档文件"),
):
    """上传文档文件，仅返回 Markdown 格式内容。"""
    filename = file.filename or "unknown"
    ext = os.path.splitext(filename)[1].lower()

    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {ext}")

    start_time = time.time()
    try:
        content = await file.read()
        if len(content) == 0:
            raise HTTPException(status_code=400, detail="文件内容为空")

        result = _parse_with_enhanced(content, ext, filename)
        if result:
            duration_ms = int((time.time() - start_time) * 1000)
            return ConvertResult(
                success=True,
                markdown=result.get("markdown", ""),
                extension=ext,
                filename=filename,
                char_count=len(result.get("markdown", "")),
                duration_ms=duration_ms,
            )

        duration_ms = int((time.time() - start_time) * 1000)
        return ConvertResult(
            success=False, extension=ext, filename=filename,
            duration_ms=duration_ms, error="文件解析失败",
        )

    except HTTPException:
        raise
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return ConvertResult(
            success=False, extension=ext, filename=filename,
            duration_ms=duration_ms, error=str(e),
        )


@app.post("/api/convert/base64", response_model=ConvertResult, summary="Base64 文件转换")
async def convert_base64(
    data: str = Query(..., description="Base64 编码的文件内容"),
    filename: str = Query(..., description="文件名（含扩展名）"),
):
    """Base64 编码文件转换。"""
    ext = os.path.splitext(filename)[1].lower()
    if ext not in SUPPORTED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"不支持的文件格式: {ext}")

    start_time = time.time()
    try:
        content = base64.b64decode(data)
        result = _parse_with_enhanced(content, ext, filename)
        if result:
            duration_ms = int((time.time() - start_time) * 1000)
            return ConvertResult(
                success=True,
                markdown=result.get("markdown", ""),
                extension=ext,
                filename=filename,
                char_count=len(result.get("markdown", "")),
                duration_ms=duration_ms,
            )

        duration_ms = int((time.time() - start_time) * 1000)
        return ConvertResult(
            success=False, extension=ext, filename=filename,
            duration_ms=duration_ms, error="文件解析失败",
        )

    except HTTPException:
        raise
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return ConvertResult(
            success=False, extension=ext, filename=filename,
            duration_ms=duration_ms, error=str(e),
        )


@app.post("/api/ocr/scan", summary="扫描件 OCR（视觉模型）")
async def ocr_scan(
    file: UploadFile = File(..., description="待识别的文件（PDF/图片）"),
    apiBaseUrl: str = Form(..., description="视觉模型 API 地址"),
    apiKey: str = Form(..., description="API Key"),
    modelName: str = Form(..., description="模型名称"),
    timeoutSec: int = Form(300, description="超时秒数"),
):
    """
    使用视觉大模型识别扫描件/图片中的文字。
    纯 PDF 无文本层时由后端 OcrService 自动调用此端点。
    """
    from vision_ocr import recognize_with_vision
    filename = file.filename or "unknown"
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="文件内容为空")

    # 确定文件类型
    ext = os.path.splitext(filename)[1].lower().lstrip('.')
    file_type = ext if ext else 'pdf'

    config = {
        'apiBaseUrl': apiBaseUrl,
        'apiKey': apiKey,
        'modelName': modelName,
        'timeoutSec': timeoutSec,
    }

    try:
        text = recognize_with_vision(content, file_type, filename, config)
        return {"code": 200, "message": "success", "data": {"text": text, "char_count": len(text)}}
    except Exception as e:
        logger.error(f"视觉模型 OCR 失败: {filename} - {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"OCR 识别失败: {str(e)}")


@app.post("/api/convert/doc-to-docx", summary="将 .doc 转换为 .docx 返回二进制")
async def convert_doc_to_docx_binary(
    file: UploadFile = File(..., description="上传的 .doc 文件"),
):
    """将 .doc 旧格式文件转换为 .docx，返回转换后的 .docx 二进制文件。"""
    filename = file.filename or 'document.doc'
    ext = os.path.splitext(filename)[1].lower()

    if ext != '.doc':
        raise HTTPException(status_code=400, detail=f"仅支持 .doc 格式，当前: {ext}")

    content = await file.read()
    docx_bytes = convert_doc_to_docx(content, filename)

    if docx_bytes is None:
        raise HTTPException(status_code=500, detail="LibreOffice 转换失败，请稍后重试")

    docx_filename = os.path.splitext(filename)[0] + '.docx'
    from urllib.parse import quote
    encoded_filename = quote(docx_filename, safe='().-_')
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"},
    )


# ==================== 启动事件 ====================

@app.on_event("startup")
async def startup():
    logger.info("文档解析服务启动中（各格式独立增强解析器，无 markitdown 依赖）...")
    # 预热各解析器的 import
    try:
        from pdf_enhanced import enhanced_pdf_parse
        from docx_enhanced import enhanced_docx_parse
        from xlsx_enhanced import enhanced_xlsx_parse
        from pptx_enhanced import enhanced_pptx_parse
        logger.info("所有增强解析器加载完成")
    except ImportError as e:
        logger.warning(f"部分解析器加载失败（将在首次请求时重试）: {e}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        workers=1,
        log_level="info",
    )
