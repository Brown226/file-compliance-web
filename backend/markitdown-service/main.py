"""
MarkItDown 文档转换 + 解析服务 - FastAPI 应用
支持格式：DOCX / XLSX / PDF / PPTX → Markdown + 结构化数据
DWG 文件已改为前端 WASM 解析（@mlightcad/libredwg-web），后端不再处理

兼容原 Python 解析服务接口：
- POST /api/parse     → 返回 ParseResult（兼容原格式，额外含 markdown 字段）
- GET  /health        → 健康检查
- POST /api/convert   → 仅 Markdown 转换
- POST /api/convert/batch → 批量转换
- POST /api/convert/base64 → Base64 转换
"""

import os
import re
import time
import base64
import logging
from io import BytesIO
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("markitdown-service")

app = FastAPI(
    title="MarkItDown 文档解析服务",
    description="将 DOCX/XLSX/PDF/PPTX 文档转换为 Markdown 格式 + 结构化解析数据。DWG 文件已改为前端 WASM 解析。",
    version="3.0.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 延迟初始化引擎
_engine = None


def get_engine():
    """懒加载精简版 MarkItDown 引擎"""
    global _engine
    if _engine is not None:
        return _engine
    from engine import create_engine
    _engine = create_engine()
    return _engine


# ==================== 常量 ====================

SUPPORTED_EXTENSIONS = {".docx", ".xlsx", ".pdf", ".pptx"}
# DWG 已改为前端 WASM 解析，后端不再提供 DWG 解析能力

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


class HealthResult(BaseModel):
    status: str = "ok"
    version: str = "3.0.0"
    supported_formats: list[str] = list(SUPPORTED_EXTENSIONS)


# ==================== Markdown → 结构化数据提取 ====================

def markdown_to_plain_text(markdown: str) -> str:
    """
    将 Markdown 转为纯文本（去除标记符号）
    用于规则引擎的正则匹配（规则引擎期望纯文本输入）
    """
    if not markdown:
        return ""

    text = markdown

    # 移除代码块
    text = re.sub(r'```[\s\S]*?```', lambda m: m.group(0).split('\n', 1)[-1].rsplit('\n', 1)[0] if '\n' in m.group(0) else '', text)

    # 移除行内代码标记
    text = re.sub(r'`([^`]+)`', r'\1', text)

    # 移除图片标记
    text = re.sub(r'!\[([^\]]*)\]\([^\)]+\)', r'\1', text)

    # 移除链接标记，保留文本
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)

    # 移除标题标记（# ## ### 等）
    text = re.sub(r'^#{1,6}\s+', '', text, flags=re.MULTILINE)

    # 移除粗体/斜体标记
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    text = re.sub(r'__([^_]+)__', r'\1', text)
    text = re.sub(r'_([^_]+)_', r'\1', text)

    # 移除水平分割线
    text = re.sub(r'^---+$', '', text, flags=re.MULTILINE)

    # Markdown 表格分隔行
    text = re.sub(r'^\|[\s\-:|]+\|$', '', text, flags=re.MULTILINE)

    # 移除 HTML 注释
    text = re.sub(r'<!--[\s\S]*?-->', '', text)

    # 移除多余空行
    text = re.sub(r'\n{3,}', '\n\n', text)

    return text.strip()


def markdown_to_pages(markdown: str, page_count_hint: int = 0) -> list[str]:
    """
    将 Markdown 文本按近似等长分割为页面数组
    对于 PDF，page_count_hint 来自 pdfplumber 的页数
    对于 DOCX/XLSX/PPTX，每 N 段或每 M 字符模拟一页
    """
    if not markdown:
        return []

    # 如果有页数提示，按页数等分
    if page_count_hint > 1:
        lines = markdown.split('\n')
        lines_per_page = max(1, len(lines) // page_count_hint)
        pages = []
        for i in range(page_count_hint):
            start = i * lines_per_page
            end = start + lines_per_page if i < page_count_hint - 1 else len(lines)
            pages.append('\n'.join(lines[start:end]))
        return pages

    # 无页数提示：每 50 行模拟一页
    lines = markdown.split('\n')
    page_size = 50
    pages = []
    for i in range(0, len(lines), page_size):
        pages.append('\n'.join(lines[i:i + page_size]))

    return pages if pages else [markdown]


def extract_structure_from_markdown(markdown: str, file_type: str) -> dict:
    """
    从 Markdown 文本中提取结构化数据
    模拟原 Python 解析服务的 structure 格式
    """
    paragraphs = []
    tables = []
    headers = []

    if not markdown:
        return {"paragraphs": paragraphs, "tables": tables}

    lines = markdown.split('\n')
    current_table_rows = []
    current_page = 0
    para_count = 0

    for line in lines:
        stripped = line.strip()

        # 标题行 → paragraph with style
        heading_match = re.match(r'^(#{1,6})\s+(.+)$', stripped)
        if heading_match:
            # 先保存之前的表格
            if current_table_rows:
                tables.append({
                    "page": current_page,
                    "rows": current_table_rows,
                    "caption": None,
                })
                current_table_rows = []

            level = len(heading_match.group(1))
            text = heading_match.group(2)
            style = f"Heading{level}"

            # 页眉检测：短文本 + 特定关键词
            is_header = (
                level >= 2
                and len(text) < 80
                and any(kw in text for kw in ['图册', '文件', '编码', '项目', '页眉', 'Header'])
            )
            if is_header:
                headers.append({"text": text, "type": style, "page": current_page})

            paragraphs.append({"text": text, "style": style, "page": current_page})
            para_count += 1
            if para_count % 50 == 0:
                current_page += 1
            continue

        # Markdown 表格行
        if stripped.startswith('|') and stripped.endswith('|'):
            # 跳过分隔行
            if re.match(r'^\|[\s\-:|]+\|$', stripped):
                continue
            cells = [c.strip() for c in stripped.strip('|').split('|')]
            current_table_rows.append(cells)
            continue

        # 非表格行：先保存之前的表格
        if current_table_rows:
            tables.append({
                "page": current_page,
                "rows": current_table_rows,
                "caption": None,
            })
            current_table_rows = []

        # 普通段落
        if stripped:
            paragraphs.append({"text": stripped, "style": "Normal", "page": current_page})
            para_count += 1
            if para_count % 50 == 0:
                current_page += 1

    # 末尾表格
    if current_table_rows:
        tables.append({
            "page": current_page,
            "rows": current_table_rows,
            "caption": None,
        })

    return {"paragraphs": paragraphs, "tables": tables}


def build_parse_result(markdown: str, file_type: str, filename: str) -> dict:
    """
    从 Markdown 构建完整的 ParseResult（兼容原 Python 解析服务格式）

    原格式：
    {
      "text": "纯文本",
      "pages": ["页1", "页2"],
      "metadata": { page_count, has_tables, has_images, ... },
      "structure": { paragraphs, tables, headers, dimensions },
      "markdown": "Markdown文本"   ← 新增字段
    }
    """
    plain_text = markdown_to_plain_text(markdown)
    structure = extract_structure_from_markdown(markdown, file_type)

    # 检测表格
    has_tables = len(structure["tables"]) > 0 or bool(re.search(r'\|.+\|', markdown))

    # 页面分割
    page_count = 0
    pages = []

    if file_type == "pdf":
        # PDF: 尝试用 pdfplumber 获取真实页数
        # 在 convert_and_parse 中已经获取了 pdfplumber 的页数
        pages = markdown_to_pages(markdown, page_count)
    else:
        pages = markdown_to_pages(markdown)

    if not pages:
        pages = [plain_text] if plain_text else []

    # 从 structure 中提取 headers
    headers = []
    for para in structure.get("paragraphs", []):
        if para.get("style", "").startswith("Heading"):
            # 短文本可能是页眉
            if len(para["text"]) < 80:
                is_header = any(kw in para["text"] for kw in [
                    '图册', '文件', '编码', '项目', '页眉', 'Header',
                    'Volume', 'Book', 'Drawing', 'Sheet',
                ])
                if is_header:
                    headers.append({
                        "text": para["text"],
                        "type": para["style"],
                        "page": para.get("page"),
                    })

    return {
        "text": plain_text,
        "pages": pages,
        "metadata": {
            "page_count": len(pages),
            "has_tables": has_tables,
            "has_images": "![" in markdown,
            "parse_error": None,
        },
        "structure": {
            "paragraphs": structure["paragraphs"],
            "tables": structure["tables"],
            "headers": headers,
            "dimensions": [],  # DWG 专用（已改为前端 WASM 解析）
        },
        "markdown": markdown,
    }


# ==================== PDF 特殊处理 ====================

def parse_pdf_with_pages(content: bytes, filename: str) -> dict:
    """
    PDF 特殊处理：使用 pdfplumber 获取逐页文本 + markitdown 获取 Markdown
    合并两者的优势
    """
    try:
        import pdfplumber

        pdf_pages = []
        with pdfplumber.open(BytesIO(content)) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                pdf_pages.append(page_text)

        # 同时用 markitdown 获取完整 Markdown
        md = get_engine()
        stream = BytesIO(content)
        md_result = md.convert_stream(stream, file_extension=".pdf")
        markdown_text = md_result.text_content or ""

        # 构建结果：使用 pdfplumber 的真实逐页数据
        plain_text = markdown_to_plain_text(markdown_text)
        structure = extract_structure_from_markdown(markdown_text, "pdf")

        # 从 pdfplumber 提取表格
        tables_from_pdf = []
        with pdfplumber.open(BytesIO(content)) as pdf:
            for i, page in enumerate(pdf.pages):
                pdf_tables = page.extract_tables()
                for table in pdf_tables:
                    if table:
                        tables_from_pdf.append({
                            "page": i,
                            "rows": table,
                            "caption": None,
                        })

        # 合并表格：优先使用 pdfplumber 的表格
        if tables_from_pdf:
            structure["tables"] = tables_from_pdf

        headers = []
        for para in structure.get("paragraphs", []):
            if para.get("style", "").startswith("Heading") and len(para["text"]) < 80:
                is_header = any(kw in para["text"] for kw in [
                    '图册', '文件', '编码', '项目', '页眉', 'Header',
                ])
                if is_header:
                    headers.append({
                        "text": para["text"],
                        "type": para["style"],
                        "page": para.get("page"),
                    })

        return {
            "text": plain_text,
            "pages": pdf_pages,  # 使用 pdfplumber 真实逐页数据
            "metadata": {
                "page_count": page_count,
                "has_tables": len(structure["tables"]) > 0,
                "has_images": "![" in markdown_text,
                "parse_error": None,
            },
            "structure": {
                "paragraphs": structure["paragraphs"],
                "tables": structure["tables"],
                "headers": headers,
                "dimensions": [],
            },
            "markdown": markdown_text,
        }

    except Exception as e:
        logger.warning(f"PDF pdfplumber 解析失败，回退到 markitdown: {e}")
        return None


# ==================== API 路由 ====================

@app.get("/health", response_model=HealthResult, summary="健康检查")
async def health_check():
    return HealthResult()


@app.post("/api/parse", summary="文件解析（兼容原 Python 解析服务）")
async def parse_file(
    file: UploadFile = File(..., description="待解析的文档文件"),
    file_type: str = Form("", description="文件类型（docx/xlsx/pdf/pptx）"),
):
    """
    解析文档文件，返回结构化解析结果 + Markdown。

    兼容原 Python 解析服务的 POST /api/parse 接口格式。
    新增 markdown 字段，包含 Markdown 格式的文档内容。
    """
    filename = file.filename or "unknown"
    # 优先使用 file_type 参数，否则从文件名推断
    ext = FILE_TYPE_MAP.get(file_type.lower())
    if not ext:
        ext = os.path.splitext(filename)[1].lower()

    # DWG/DXF 不再支持后端解析，前端使用 WASM 方案
    if file_type.lower() in ("dwg", "dxf") or ext in (".dwg", ".dxf"):
        raise HTTPException(
            status_code=400,
            detail="DWG/DXF 文件已改为前端 WASM 解析，后端不再提供解析服务。请使用前端 @mlightcad/libredwg-web 进行解析。",
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

        # PDF 特殊处理：pdfplumber 逐页 + markitdown Markdown
        if ext == ".pdf":
            pdf_result = parse_pdf_with_pages(content, filename)
            if pdf_result:
                duration_ms = int((time.time() - start_time) * 1000)
                logger.info(f"PDF 解析完成: {filename} → {len(pdf_result['text'])} chars, {duration_ms}ms")
                return {"code": 200, "message": "success", "data": pdf_result}

        # 其他格式：使用 markitdown 转换
        md = get_engine()
        stream = BytesIO(content)
        result = md.convert_stream(stream, file_extension=ext)
        markdown_text = result.text_content or ""

        # 构建 ParseResult
        ft = ext.lstrip('.')
        parse_data = build_parse_result(markdown_text, ft, filename)

        duration_ms = int((time.time() - start_time) * 1000)
        logger.info(f"解析完成: {filename} → {len(parse_data['text'])} chars, {duration_ms}ms")

        return {"code": 200, "message": "success", "data": parse_data}

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

        md = get_engine()
        stream = BytesIO(content)
        result = md.convert_stream(stream, file_extension=ext)

        duration_ms = int((time.time() - start_time) * 1000)
        markdown_text = result.text_content or ""

        return ConvertResult(
            success=True, markdown=markdown_text, extension=ext,
            filename=filename, char_count=len(markdown_text), duration_ms=duration_ms,
        )
    except HTTPException:
        raise
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return ConvertResult(success=False, extension=ext, filename=filename, duration_ms=duration_ms, error=str(e))


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
        md = get_engine()
        stream = BytesIO(content)
        result = md.convert_stream(stream, file_extension=ext)

        duration_ms = int((time.time() - start_time) * 1000)
        markdown_text = result.text_content or ""

        return ConvertResult(
            success=True, markdown=markdown_text, extension=ext,
            filename=filename, char_count=len(markdown_text), duration_ms=duration_ms,
        )
    except HTTPException:
        raise
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return ConvertResult(success=False, extension=ext, filename=filename, duration_ms=duration_ms, error=str(e))




# ==================== 启动事件 ====================

@app.on_event("startup")
async def startup():
    logger.info("MarkItDown 文档解析服务启动中...")
    try:
        get_engine()
        logger.info("引擎预热完成")
    except Exception as e:
        logger.warning(f"引擎预热失败（将在首次请求时重试）: {e}")


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
