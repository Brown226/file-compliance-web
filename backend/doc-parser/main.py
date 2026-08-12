"""
文档解析服务 - FastAPI 应用
支持格式：DOCX / XLSX / PDF / PPTX / DOC / PPT / XLS / ODT / ODS / ODP / RTF / EPUB / CSV
→ Markdown + 结构化数据
DWG 文件已改为前端 WASM 解析（@mlightcad/libredwg-web），后端不再处理

解析策略：anydoc（Firecrawl，Rust）为主力引擎，pdf_enhanced 为 PDF 文本兜底，
扫描件 PDF 走 RapidOCR → Vision LLM 兜底。
（历史引擎 MarkItDown / antiword / LibreOffice 已移除，见 git 历史 b7c4f3c 之前）
"""

import os
import re
import time
import base64
import logging
import subprocess
import tempfile
from io import BytesIO
from typing import Any, Dict, List, Optional

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
    description="将 DOCX/XLSX/PDF/PPTX 等 14 种格式文档转换为 Markdown 格式 + 结构化解析数据（anydoc 引擎）。DWG 文件已改为前端 WASM 解析。",
    version="5.0.0",
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

# anydoc 支持的 14 种格式全部开放（含老格式 .doc/.ppt/.xls 及 ODF/RTF/EPUB/CSV）
SUPPORTED_EXTENSIONS = {
    ".doc", ".docm", ".docx",
    ".ppt", ".pps", ".pot", ".pptx", ".pptm", ".ppsx", ".ppsm",
    ".xls", ".xlsx", ".xlsm", ".xlsb",
    ".odt", ".ods", ".odp",
    ".rtf", ".epub", ".csv",
    ".pdf",
}

# 文件类型 → 扩展名映射
# 注意：.doc 是 Word 97-2003 老格式（与 .docx 不同），映射为 .doc。
# anydoc 原生支持全部老格式，无需 antiword/LibreOffice。
FILE_TYPE_MAP = {
    "docx": ".docx",
    "doc": ".doc",
    "docm": ".docm",
    "xlsx": ".xlsx",
    "xls": ".xls",
    "xlsm": ".xlsm",
    "xlsb": ".xlsb",
    "pdf": ".pdf",
    "pptx": ".pptx",
    "ppt": ".ppt",
    "pptm": ".pptm",
    "pps": ".pps",
    "pot": ".pot",
    "ppsx": ".ppsx",
    "ppsm": ".ppsm",
    "odt": ".odt",
    "ods": ".ods",
    "odp": ".odp",
    "rtf": ".rtf",
    "epub": ".epub",
    "csv": ".csv",
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
    version: str = "5.0.0"
    supported_formats: list[str] = list(SUPPORTED_EXTENSIONS)


# ==================== 增强解析器调度 ====================

def _parse_markdown_table_kv_pairs(markdown_text: str) -> List[Dict[str, str]]:
    """
    从 Markdown 文本中解析表格键值对。
    仅处理二列表格（第一列=键，第二列=值），或更多列时把第一列作键、其余列拼接为值。
    Markdown 表格语法示例：
        | 参数名 | 值 |
        |---|---|
        | 设计温度 | 350°C |
        | 设计压力 | 17.5MPa |
    """
    if not markdown_text:
        return []

    pairs: List[Dict[str, str]] = []
    lines = markdown_text.split('\n')
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i].strip()
        # 找到表格起始行：以 | 开头且包含至少一个 |
        if not line.startswith('|') or '|' not in line[1:]:
            i += 1
            continue

        # 收集连续的表格行
        table_lines: List[str] = []
        while i < n and lines[i].strip().startswith('|'):
            table_lines.append(lines[i].strip())
            i += 1

        if len(table_lines) < 2:
            continue

        # 解析每行为单元格列表
        def parse_row(row_line: str) -> List[str]:
            # 去掉首尾的 |，然后按 | 分隔
            inner = row_line.strip()
            if inner.startswith('|'):
                inner = inner[1:]
            if inner.endswith('|'):
                inner = inner[:-1]
            return [c.strip() for c in inner.split('|')]

        rows = [parse_row(tl) for tl in table_lines]
        # 第二行是分隔符行（|---|---|），跳过
        if len(rows) >= 2 and all(re.fullmatch(r':?-{2,}:?', c or '') for c in rows[1]):
            rows = [rows[0]] + rows[2:]

        for row in rows:
            if not row or len(row) < 2:
                continue
            key = (row[0] or '').strip()
            if not key:
                continue
            if len(row) == 2:
                value = (row[1] or '').strip()
            else:
                value = ' '.join((c or '').strip() for c in row[1:] if (c or '').strip())
            if not value:
                continue
            pairs.append({'key': key, 'value': value})

    return pairs


def _extract_table_kv_from_structure_tables(tables: List[dict]) -> List[Dict[str, str]]:
    """
    从增强解析器的 structure.tables 中提取键值对。
    tables: [{ page, rows: [[c1, c2, ...], ...], caption }]
    """
    pairs: List[Dict[str, str]] = []
    if not tables:
        return pairs
    for table in tables:
        rows = table.get('rows') or []
        for row in rows:
            if not row or len(row) < 2:
                continue
            key = (row[0] or '').strip() if isinstance(row[0], str) else ''
            if not key:
                continue
            if len(row) == 2:
                value = (row[1] or '').strip() if isinstance(row[1], str) else ''
            else:
                value = ' '.join(
                    (c or '').strip() if isinstance(c, str) else ''
                    for c in row[1:]
                    if (c if isinstance(c, str) else '').strip()
                )
            if not value:
                continue
            pairs.append({'key': key, 'value': value})
    return pairs


def _enrich_result_table_kv(result: Optional[dict]) -> Optional[dict]:
    """为解析结果补充 table_kv_pairs 字段（若已存在则不覆盖）。"""
    if result is None:
        return None
    if 'table_kv_pairs' not in result:
        structure = result.get('structure') or {}
        tables = structure.get('tables') or []
        result['table_kv_pairs'] = _extract_table_kv_from_structure_tables(tables)
    return result


def _parse_with_anydoc(content: bytes, ext: str, filename: str) -> Optional[dict]:
    """
    anydoc 统一解析引擎（Firecrawl，Rust 实现，14 格式覆盖，中位 <5ms）。
    格式按文件内容识别（非扩展名）；CSV 等无内容签名的格式需显式指定。
    返回与现有格式兼容的结构（text/pages/metadata/structure/markdown/table_kv_pairs）。
    扫描件 PDF 会抛 UnsupportedError（无文本层），返回 None 交由 OCR 链路处理。
    """
    # 变体扩展名归一化为 anydoc 基础格式（.docm→docx、.pptm→pptx、.xlsm→xlsx 等）
    _ANYDOC_FMT_MAP = {
        '.doc': 'doc', '.docx': 'docx', '.docm': 'docx',
        '.ppt': 'ppt', '.pps': 'ppt', '.pot': 'ppt',
        '.pptx': 'pptx', '.pptm': 'pptx', '.ppsx': 'pptx', '.ppsm': 'pptx',
        '.xls': 'xls', '.xlsx': 'xlsx', '.xlsm': 'xlsx', '.xlsb': 'xlsb',
        '.odt': 'odt', '.ods': 'ods', '.odp': 'odp',
        '.rtf': 'rtf', '.epub': 'epub', '.csv': 'csv', '.pdf': 'pdf',
    }
    try:
        import anydoc

        fmt = _ANYDOC_FMT_MAP.get(ext.lower(), ext.lstrip('.').lower())
        try:
            markdown_text = anydoc.to_markdown_bytes(content, fmt)
        except TypeError:
            # 旧版 API 不支持格式参数
            markdown_text = anydoc.to_markdown_bytes(content)

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

        # 表格 KV 抽取（供一致性检查服务消费）
        table_kv_pairs = _parse_markdown_table_kv_pairs(markdown_text)
        if table_kv_pairs:
            logger.info(f"anydoc 表格 KV 抽取: {filename}, {len(table_kv_pairs)} 对")

        return {
            'text': markdown_text,
            'pages': [markdown_text],
            'metadata': {
                'page_count': 1,
                'has_tables': '|' in markdown_text,
                'has_images': False,
                'parse_error': None,
                'engine': 'anydoc',
            },
            'structure': {
                'paragraphs': paragraphs,
                'tables': [],
                'headers': headers,
                'dimensions': [],
            },
            'markdown': markdown_text,
            'table_kv_pairs': table_kv_pairs,
        }
    except ImportError:
        logger.warning("anydoc 未安装，跳过")
        return None
    except Exception as e:
        # 扫描件 PDF（UnsupportedError）等一切失败 → None，交由 fallback/OCR 链路
        logger.warning(f"anydoc 解析失败: {filename} - {e}")
        return None


def _parse_with_enhanced(content: bytes, ext: str, filename: str, vision_config: Optional[dict] = None) -> Optional[dict]:
    """
    统一解析调度：anydoc 为主力引擎（Rust，14 格式覆盖）。
    PDF fallback：pdf_enhanced（文本兜底 + 页眉页脚过滤）；
    扫描件 PDF（anydoc 拒绝）走 RapidOCR → Vision LLM 兜底。
    """
    # === 主力引擎：anydoc ===
    result = _parse_with_anydoc(content, ext, filename)
    if result:
        logger.info(f"anydoc 解析成功: {filename} ({len(result['text'])} chars)")
        return result

    # === PDF fallback：增强解析器（文本兜底 + 页眉页脚过滤） ===
    if ext == ".pdf":
        logger.info(f"anydoc 未产出结果，降级到 PDF 增强解析器: {filename}")
        try:
            from pdf_enhanced import enhanced_pdf_parse
            result = enhanced_pdf_parse(content, filename)
            if result:
                return _enrich_result_table_kv(result)
        except Exception as e:
            logger.warning(f"PDF 增强解析失败: {e}")

        # 扫描件 PDF 降级：文本提取为空时尝试 OCR
        # 策略：RapidOCR（本地、快速）优先 → Vision LLM（内网 API）兜底
        ocr_text = None
        ocr_engine = None

        # 第一优先：RapidOCR 本地识别
        try:
            from rapid_ocr import recognize_with_rapidocr, CONFIDENCE_THRESHOLD
            ocr_result = recognize_with_rapidocr(content, 'pdf', filename)
            if ocr_result and ocr_result['text']:
                if ocr_result['confidence'] >= CONFIDENCE_THRESHOLD:
                    ocr_text = ocr_result['text']
                    ocr_engine = 'rapidocr'
                    logger.info(f"RapidOCR 识别成功: {filename}, "
                               f"{len(ocr_text)} 字符, 置信度 {ocr_result['confidence']:.3f}")
                else:
                    logger.info(f"RapidOCR 置信度不足 ({ocr_result['confidence']:.3f} < {CONFIDENCE_THRESHOLD}), "
                               f"尝试 Vision LLM 兜底")
        except Exception as e:
            logger.warning(f"RapidOCR 识别失败: {filename} - {e}")

        # 第二优先：Vision LLM 兜底（需配置有效）
        if not ocr_text and vision_config and vision_config.get('apiKey') and vision_config.get('modelName'):
            try:
                from vision_ocr import recognize_with_vision
                vision_text = recognize_with_vision(content, 'pdf', filename, vision_config)
                if vision_text:
                    ocr_text = vision_text
                    ocr_engine = 'vision-llm'
                    logger.info(f"视觉模型 OCR 识别成功: {filename}, {len(ocr_text)} 字符")
            except Exception as e:
                logger.error(f"视觉模型 OCR 失败: {filename} - {e}")

        # 返回 OCR 结果
        if ocr_text:
            return {
                'text': ocr_text,
                'pages': [ocr_text],
                'metadata': {
                    'page_count': 1,
                    'has_tables': False,
                    'has_images': True,
                    'parse_error': None,
                    'ocr_engine': ocr_engine,
                },
                'structure': {
                    'paragraphs': [{'text': line, 'style': 'Normal', 'page': 0}
                                   for line in ocr_text.split('\n') if line.strip()],
                    'tables': [],
                    'headers': [],
                    'dimensions': [],
                },
                'markdown': ocr_text,
                'table_kv_pairs': [],
            }

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
    主力引擎 anydoc（Rust），增强解析器/OCR 为 fallback。
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


@app.post("/api/ocr/scan", summary="扫描件 OCR（RapidOCR 本地优先 → 视觉模型兜底）")
async def ocr_scan(
    file: UploadFile = File(..., description="待识别的文件（PDF/图片）"),
    apiBaseUrl: str = Form(..., description="视觉模型 API 地址（兜底用）"),
    apiKey: str = Form(..., description="API Key"),
    modelName: str = Form(..., description="模型名称"),
    timeoutSec: int = Form(300, description="超时秒数"),
):
    """
    识别扫描件/图片中的文字。
    策略：RapidOCR 本地识别优先（离线、免费、无需 key）→ 视觉大模型兜底。
    纯 PDF 无文本层时由后端 OcrService 自动调用此端点。
    """
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

    # 第一优先：RapidOCR 本地识别（无需任何外部 API）
    try:
        from rapid_ocr import recognize_with_rapidocr, CONFIDENCE_THRESHOLD
        ocr_result = recognize_with_rapidocr(content, file_type, filename)
        if ocr_result and ocr_result['text']:
            if ocr_result['confidence'] >= CONFIDENCE_THRESHOLD:
                text = ocr_result['text']
                logger.info(f"RapidOCR 识别成功: {filename}, "
                           f"{len(text)} 字符, 置信度 {ocr_result['confidence']:.3f}")
                return {"code": 200, "message": "success",
                        "data": {"text": text, "char_count": len(text),
                                 "engine": "rapidocr", "confidence": ocr_result['confidence']}}
            else:
                logger.info(f"RapidOCR 置信度不足 ({ocr_result['confidence']:.3f}), 尝试视觉模型兜底")
    except Exception as e:
        logger.warning(f"RapidOCR 识别失败: {filename} - {e}")

    # 第二优先：视觉大模型兜底
    try:
        from vision_ocr import recognize_with_vision
        text = recognize_with_vision(content, file_type, filename, config)
        return {"code": 200, "message": "success",
                "data": {"text": text or "", "char_count": len(text or ""), "engine": "vision-llm"}}
    except Exception as e:
        logger.error(f"视觉模型 OCR 失败: {filename} - {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"OCR 识别失败: {str(e)}")


# ==================== Task 38: 批量扫描件 OCR（视觉模型） ====================

def _do_ocr_scan_single(
    content: bytes,
    file_type: str,
    filename: str,
    config: Dict[str, Any],
) -> Dict[str, Any]:
    """单张文件的视觉 OCR 内部调用（错误时返回 error 字段而非抛异常）。

    用于批量接口内部调用，避免单张失败影响整批。
    """
    try:
        from vision_ocr import recognize_with_vision
        text = recognize_with_vision(content, file_type, filename, config)
        return {"text": text, "charCount": len(text), "fileName": filename}
    except HTTPException as e:
        return {"error": e.detail if hasattr(e, 'detail') else str(e), "fileName": filename}
    except Exception as e:
        return {"error": str(e), "fileName": filename}


@app.post("/api/ocr/scan/batch", summary="Task 38: 批量扫描件 OCR（multipart 上传）")
async def ocr_scan_batch(
    files: List[UploadFile] = File(..., description="待识别的文件列表（PDF/图片）"),
    apiBaseUrl: str = Form(..., description="视觉模型 API 地址"),
    apiKey: str = Form(..., description="API Key"),
    modelName: str = Form(..., description="模型名称"),
    timeoutSec: int = Form(300, description="单张超时秒数"),
):
    """
    Task 38: 批量扫描件 OCR（视觉模型路径）

    接收多文件（multipart/form-data，字段名 files），复用 vision_ocr.recognize_with_vision
    串行批推理（视觉模型 API 多为并发受限，串行更稳定），返回与输入顺序一致的结果数组。

    - 单张失败不影响其他文件，失败项返回 { error, fileName }
    - 全部失败时仍返回 200，结果数组中每项都含 error 字段
    - 单次最多 20 个文件（防止 API 配额耗尽）

    返回格式: { code, data: { results, total, succeeded, failed } }
    """
    if not files:
        raise HTTPException(status_code=400, detail="缺少文件")

    BATCH_LIMIT = 20
    if len(files) > BATCH_LIMIT:
        raise HTTPException(status_code=400, detail=f"批量接口单次最多 {BATCH_LIMIT} 个文件，本次提交 {len(files)} 个")

    config = {
        'apiBaseUrl': apiBaseUrl,
        'apiKey': apiKey,
        'modelName': modelName,
        'timeoutSec': timeoutSec,
    }

    # 一次性读取所有文件内容（避免 upload file 句柄在异步循环中过期）
    payloads: List[tuple] = []
    for f in files:
        contents = await f.read()
        payloads.append((contents, f.filename or "unknown"))

    # 串行处理（视觉模型 API 并发受限，串行更稳定）
    results: List[dict] = []
    succeeded = 0
    failed = 0
    for file_bytes, filename in payloads:
        if not file_bytes:
            results.append({"error": "空文件", "fileName": filename})
            failed += 1
            continue

        ext = os.path.splitext(filename)[1].lower().lstrip('.')
        file_type = ext if ext else 'pdf'

        r = _do_ocr_scan_single(file_bytes, file_type, filename, config)
        if 'error' in r:
            failed += 1
        else:
            succeeded += 1
        results.append(r)

    logger.info(f"Batch OCR scan: total={len(results)}, succeeded={succeeded}, failed={failed}")
    return {
        "code": 200,
        "message": "success",
        "data": {
            "results": results,
            "total": len(results),
            "succeeded": succeeded,
            "failed": failed,
        },
    }


@app.post("/api/ocr/scan/batch/base64", summary="Task 38: 批量扫描件 OCR（base64 输入）")
async def ocr_scan_batch_base64(data: dict):
    """
    Task 38: 批量扫描件 OCR（base64 输入版本）

    请求体格式:
    {
      "apiBaseUrl": "https://...",
      "apiKey": "sk-...",
      "modelName": "qwen-vl-max",
      "timeoutSec": 300,
      "images": [
        { "image": "<base64>", "fileType": "pdf", "fileName": "a.pdf" },
        { "image": "<base64>", "fileType": "png", "fileName": "b.png" }
      ]
    }

    返回格式与 /api/ocr/scan/batch 一致。

    适用于前端已将图片转为 base64 的场景（如 DWG 渲染后的 PNG 直接送审）。
    """
    images = data.get('images', [])
    if not images or not isinstance(images, list):
        raise HTTPException(status_code=400, detail="缺少 images 数组")

    BATCH_LIMIT = 20
    if len(images) > BATCH_LIMIT:
        raise HTTPException(status_code=400, detail=f"批量接口单次最多 {BATCH_LIMIT} 个文件，本次提交 {len(images)} 个")

    apiBaseUrl = data.get('apiBaseUrl', '')
    apiKey = data.get('apiKey', '')
    modelName = data.get('modelName', '')
    timeoutSec = data.get('timeoutSec', 300)

    if not apiBaseUrl or not apiKey or not modelName:
        raise HTTPException(status_code=400, detail="缺少 apiBaseUrl / apiKey / modelName 参数")

    config = {
        'apiBaseUrl': apiBaseUrl,
        'apiKey': apiKey,
        'modelName': modelName,
        'timeoutSec': timeoutSec,
    }

    results: List[dict] = []
    succeeded = 0
    failed = 0
    for idx, item in enumerate(images):
        if not isinstance(item, dict):
            results.append({"error": f"第 {idx + 1} 项格式错误", "fileName": None})
            failed += 1
            continue

        base64_data = item.get('image', '')
        file_type = item.get('fileType', 'pdf')
        file_name = item.get('fileName', f'file_{idx + 1}')

        if not base64_data:
            results.append({"error": "缺少图片数据", "fileName": file_name})
            failed += 1
            continue

        try:
            if 'data:image/' in base64_data or 'data:application/' in base64_data:
                base64_data = base64_data.split(',', 1)[1]
            file_bytes = base64.b64decode(base64_data)
        except Exception as e:
            results.append({"error": f"base64 解码失败: {e}", "fileName": file_name})
            failed += 1
            continue

        r = _do_ocr_scan_single(file_bytes, file_type, file_name, config)
        if 'error' in r:
            failed += 1
        else:
            succeeded += 1
        results.append(r)

    logger.info(f"Batch OCR scan base64: total={len(results)}, succeeded={succeeded}, failed={failed}")
    return {
        "code": 200,
        "message": "success",
        "data": {
            "results": results,
            "total": len(results),
            "succeeded": succeeded,
            "failed": failed,
        },
    }


# ==================== 启动事件 ====================

@app.on_event("startup")
async def startup():
    logger.info("文档解析服务启动中（anydoc 主力引擎 + RapidOCR 扫描件兜底）...")
    # 预热关键依赖的 import
    try:
        import anydoc
        logger.info(f"anydoc 引擎加载完成 v{getattr(anydoc, '__version__', 'unknown')}")
    except ImportError as e:
        logger.warning(f"anydoc 未安装: {e}（需 pip install firecrawl-anydoc）")
    try:
        from pdf_enhanced import enhanced_pdf_parse
        logger.info("PDF 增强解析器加载完成")
    except ImportError as e:
        logger.warning(f"PDF 增强解析器加载失败（将在首次请求时重试）: {e}")


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
