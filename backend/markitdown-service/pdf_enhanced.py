"""
增强型 PDF 解析器
- 使用 PyMuPDF (fitz) 进行字体大小启发式标题检测
- 保留页码结构，逐页提取文本
- 提取表格（pdfplumber 辅助）
"""

import io
import logging
import re
from typing import Optional

logger = logging.getLogger("markitdown-service")


def _detect_heading_level(font_size: float, font_flags: int, body_size: float) -> Optional[int]:
    """
    根据字体大小相对于正文的差值检测标题级别（与 MaxKB 一致）。
    font_flags 中 bit 4 (1 << 3) 表示 bold。
    """
    is_bold = bool(font_flags & (1 << 3))
    size_diff = font_size - body_size

    # 相对差值策略（与 MaxKB pdf_split_handle 一致）
    if size_diff > 5 or (size_diff > 2 and is_bold):
        return 1  # 一级标题
    if size_diff > 2 or (size_diff > 0.5 and is_bold):
        return 2  # 二级标题
    if size_diff > 0.5 or (is_bold and font_size > body_size):
        return 3  # 三级标题
    return None


def _has_images(doc) -> bool:
    """检测 PDF 中是否包含图片"""
    try:
        for page in doc:
            images = page.get_images(full=True)
            if images:
                return True
    except Exception:
        pass
    return False


def _extract_tables_with_pdfplumber(content: bytes) -> list:
    """使用 pdfplumber 提取表格"""
    tables = []
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for i, page in enumerate(pdf.pages):
                pdf_tables = page.extract_tables()
                for table in pdf_tables:
                    if table and len(table) > 1:
                        # 清理单元格
                        cleaned = []
                        for row in table:
                            cleaned.append([
                                (cell or "").replace("\n", " ").strip()
                                for cell in row
                            ])
                        tables.append({
                            "page": i,
                            "rows": cleaned,
                            "caption": None,
                        })
    except ImportError:
        logger.warning("pdfplumber 未安装，跳过表格提取")
    except Exception as e:
        logger.warning(f"pdfplumber 表格提取失败: {e}")
    return tables


def enhanced_pdf_parse(content: bytes, filename: str) -> Optional[dict]:
    """
    增强型 PDF 解析：
    1. PyMuPDF 逐页提取文本 + 字体大小启发式标题检测
    2. pdfplumber 辅助提取表格
    3. 生成 Markdown 格式（标题 + 段落 + 表格）

    Returns:
        dict: 兼容 ParseResult 格式的结果，失败返回 None。
    """
    try:
        import fitz  # PyMuPDF
    except ImportError:
        logger.warning("PyMuPDF 未安装，无法使用增强 PDF 解析")
        return None

    try:
        pdf_doc = fitz.open(stream=content, filetype="pdf")
    except Exception as e:
        logger.warning(f"PyMuPDF 打开文件失败: {filename} - {e}")
        return None

    try:
        page_count = len(pdf_doc)
        has_images = _has_images(pdf_doc)

        markdown_parts = []
        paragraphs = []
        headers = []
        pdf_pages = []  # 逐页纯文本

        # 收集全文统计信息用于标题检测
        all_font_sizes = []
        for page in pdf_doc:
            blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]
            for block in blocks:
                if block["type"] == 0:  # 文本块
                    for line in block.get("lines", []):
                        for span in line.get("spans", []):
                            text = span["text"].strip()
                            if text:
                                all_font_sizes.append(span["size"])

        if not all_font_sizes:
            # 无文本内容，可能是扫描 PDF
            pdf_doc.close()
            return None

        # 计算正文字号（出现频率最高的）
        from collections import Counter
        size_counter = Counter(all_font_sizes)
        body_size = size_counter.most_common(1)[0][0] if size_counter else 10.5

        for page_idx, page in enumerate(pdf_doc):
            page_text_parts = []
            blocks = page.get_text("dict", flags=fitz.TEXT_PRESERVE_WHITESPACE)["blocks"]

            for block in blocks:
                if block["type"] != 0:
                    continue

                for line in block.get("lines", []):
                    line_text = ""
                    max_font_size = 0
                    max_font_flags = 0

                    for span in line.get("spans", []):
                        text = span["text"]
                        line_text += text
                        if span["size"] > max_font_size:
                            max_font_size = span["size"]
                            max_font_flags = span["flags"]

                    line_text = line_text.strip()
                    if not line_text:
                        continue

                    # 仅跳过完全为空的行（保留短行如数字、编号、单字标题）
                    if len(line_text) < 1:
                        continue

                    # 页眉页脚检测：仅当字号明显小于正文字号时才跳过
                    bbox = line["bbox"]
                    is_page_edge = False
                    if max_font_size < body_size * 0.75:
                        # 字号明显小于正文的边缘内容 → 可能是页眉页脚
                        is_page_edge = (bbox[1] < 40 or bbox[1] > page.rect.height - 40)

                    # 标题检测
                    heading_level = _detect_heading_level(max_font_size, max_font_flags, body_size)

                    if heading_level and not is_page_edge:
                        md_prefix = "#" * heading_level
                        markdown_parts.append(f"{md_prefix} {line_text}")
                        style = f"Heading{heading_level}"
                        paragraphs.append({
                            "text": line_text,
                            "style": style,
                            "page": page_idx,
                        })
                        headers.append({
                            "text": line_text,
                            "type": style,
                            "page": page_idx,
                        })
                        page_text_parts.append(line_text)
                    else:
                        # 检查是否为加粗段落（可能是小标题）
                        is_bold = bool(max_font_flags & (1 << 3))
                        if is_bold and max_font_size > body_size and len(line_text) < 80:
                            markdown_parts.append(f"### {line_text}")
                            paragraphs.append({
                                "text": line_text,
                                "style": "Heading3",
                                "page": page_idx,
                            })
                        else:
                            markdown_parts.append(line_text)
                            paragraphs.append({
                                "text": line_text,
                                "style": "Normal",
                                "page": page_idx,
                            })
                        page_text_parts.append(line_text)

            pdf_pages.append("\n".join(page_text_parts))

        pdf_doc.close()

        # 用 pdfplumber 提取表格
        tables_from_pdf = _extract_tables_with_pdfplumber(content)

        # 合并 Markdown
        markdown_text = "\n\n".join(markdown_parts)

        # 在表格位置插入 Markdown 表格
        if tables_from_pdf:
            # 按页码排序，逆序插入（避免偏移）
            tables_from_pdf.sort(key=lambda t: t["page"], reverse=True)
            for table_info in tables_from_pdf:
                page_idx = table_info["page"]
                rows = table_info["rows"]
                if not rows:
                    continue
                # 生成 Markdown 表格
                header = rows[0]
                num_cols = len(header)
                table_md_lines = [
                    "| " + " | ".join(header) + " |",
                    "| " + " | ".join(["---"] * num_cols) + " |",
                ]
                for row in rows[1:]:
                    # 确保列数一致
                    while len(row) < num_cols:
                        row.append("")
                    table_md_lines.append("| " + " | ".join(row[:num_cols]) + " |")
                table_md = "\n".join(table_md_lines)

                # 找到对应页面的最后一个段落位置插入
                insert_pos = len(markdown_parts) - 1
                for i in range(len(markdown_parts) - 1, -1, -1):
                    para_match = next(
                        (p for p in paragraphs if p["text"] == markdown_parts[i].lstrip("#").strip()),
                        None
                    )
                    if para_match and para_match["page"] == page_idx:
                        insert_pos = i
                        break
                markdown_parts.insert(insert_pos + 1, table_md)

            markdown_text = "\n\n".join(markdown_parts)

        # 纯文本
        plain_text = "\n\n".join(
            p["text"] for p in paragraphs if p["text"]
        )

        # 结构化表格数据
        tables = tables_from_pdf

        return {
            "text": plain_text,
            "pages": pdf_pages,
            "metadata": {
                "page_count": page_count,
                "has_tables": len(tables) > 0,
                "has_images": has_images,
                "parse_error": None,
            },
            "structure": {
                "paragraphs": paragraphs,
                "tables": tables,
                "headers": headers,
                "dimensions": [],
            },
            "markdown": markdown_text,
        }

    except Exception as e:
        logger.error(f"增强 PDF 解析失败: {filename} - {e}", exc_info=True)
        try:
            pdf_doc.close()
        except Exception:
            pass
        return None
