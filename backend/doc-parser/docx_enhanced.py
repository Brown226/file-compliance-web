"""
增强型 DOCX 解析器
- 使用 python-docx 原生解析，保留段落样式、标题层级
- 正确处理表格，转换为 Markdown 格式
- 检测嵌入图片
"""

import io
import logging
import re
from typing import Optional

logger = logging.getLogger("markitdown-service")


# 中文标题样式名映射
_CHINESE_HEADING_MAP = {
    "标题 1": 1, "标题1": 1,
    "标题 2": 2, "标题2": 2,
    "标题 3": 3, "标题3": 3,
    "标题 4": 4, "标题4": 4,
    "标题 5": 5, "标题5": 5,
    "标题 6": 6, "标题6": 6,
    "TOC 标题": 1, "TOC标题": 1,
    "TOC 1": 2, "TOC 2": 3, "TOC 3": 4,
}

_ENGLISH_HEADING_MAP = {
    "heading 1": 1, "heading 2": 2, "heading 3": 3,
    "heading 4": 4, "heading 5": 5, "heading 6": 6,
}


def _detect_heading_level(style_name: str) -> Optional[int]:
    """从段落样式名检测标题级别"""
    if not style_name:
        return None
    name = style_name.strip()
    # 精确匹配中文样式
    if name in _CHINESE_HEADING_MAP:
        return _CHINESE_HEADING_MAP[name]
    # 精确匹配英文样式
    lower = name.lower()
    if lower in _ENGLISH_HEADING_MAP:
        return _ENGLISH_HEADING_MAP[lower]
    # 通用匹配：Heading 1, Heading 2, ...
    m = re.match(r"heading\s*(\d)", lower)
    if m:
        return int(m.group(1))
    # outline 级别
    m = re.match(r"outline\s*(\d)", lower)
    if m:
        return int(m.group(1))
    return None


def _is_bold_and_large(paragraph) -> bool:
    """回退启发式：段落整体加粗且字号 > 14pt"""
    if not paragraph.runs:
        return False
    is_bold = all(r.bold for r in paragraph.runs if r.text.strip())
    max_size = 0
    for run in paragraph.runs:
        if run.font.size:
            size_pt = run.font.size.pt
            if size_pt > max_size:
                max_size = size_pt
    return is_bold and max_size > 14


def _escape_pipe(text: str) -> str:
    """转义 Markdown 表格中的管道符（使用HTML实体避免JSON序列化问题）"""
    return text.replace("|", "&#124;")


def _clean_cell(value) -> str:
    """清理单元格内容为 Markdown 表格单元格"""
    if value is None:
        return ""
    text = str(value).strip()
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("\n", "<br>")
    text = _escape_pipe(text)
    return text


def _table_to_markdown(table) -> str:
    """python-docx Table → Markdown 表格"""
    rows_data = []
    for row in table.rows:
        cells = [_clean_cell(cell.text) for cell in row.cells]
        rows_data.append(cells)

    if not rows_data:
        return ""

    num_cols = max(len(r) for r in rows_data)
    for r in rows_data:
        while len(r) < num_cols:
            r.append("")

    header = rows_data[0]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join(["---"] * num_cols) + " |",
    ]
    for row in rows_data[1:]:
        lines.append("| " + " | ".join(row[:num_cols]) + " |")

    return "\n".join(lines)


def _has_images(doc) -> bool:
    """检测文档中是否包含图片（通过 XML）"""
    try:
        from lxml import etree
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        drawings = doc.element.findall(".//w:drawing", ns)
        if drawings:
            return True
        vml_ns = {"v": "urn:schemas-microsoft-com:vml"}
        pictures = doc.element.findall(".//v:imagedata", vml_ns)
        if pictures:
            return True
    except Exception:
        pass
    return False


def _extract_paragraph_text(para) -> str:
    """从段落中提取完整文本，包括嵌套文本框内容"""
    text = para.text.strip()
    if text:
        return text
    # 尝试从 XML 中提取文本框内容 (txbxContent)
    try:
        from docx.oxml.ns import qn
        txbx_contents = para._element.findall(".//w:txbxContent", {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"})
        for txbx in txbx_contents:
            for p in txbx.findall(qn("w:p")):
                runs = p.findall(qn("w:r"))
                for r in runs:
                    t_elements = r.findall(qn("w:t"))
                    for t in t_elements:
                        if t.text:
                            text += t.text
        if text.strip():
            return text.strip()
    except Exception:
        pass
    return ""


def _extract_footnotes(doc) -> list:
    """提取脚注内容"""
    footnotes = []
    try:
        from docx.oxml.ns import qn
        # 脚注在 word/footnotes.xml 中
        footnotes_part = doc.part.package.part_related_by("http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes")
        if footnotes_part is None:
            return footnotes
        from lxml import etree
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        root = etree.fromstring(footnotes_part.blob)
        for fn in root.findall(qn("w:footnote")):
            fn_id = fn.get(qn("w:id"), "")
            # 跳过系统脚注（分隔符等）
            if fn_id in ("-1", "0"):
                continue
            paragraphs_text = []
            for p in fn.findall(qn("w:p")):
                runs = p.findall(qn("w:r"))
                para_text = ""
                for r in runs:
                    t_elements = r.findall(qn("w:t"))
                    for t in t_elements:
                        if t.text:
                            para_text += t.text
                if para_text.strip():
                    paragraphs_text.append(para_text.strip())
            if paragraphs_text:
                footnotes.append({
                    "id": fn_id,
                    "text": " ".join(paragraphs_text),
                })
    except Exception as e:
        logger.debug(f"提取脚注失败: {e}")
    return footnotes


def _extract_endnotes(doc) -> list:
    """提取尾注内容"""
    endnotes = []
    try:
        from docx.oxml.ns import qn
        endnotes_part = doc.part.package.part_related_by("http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes")
        if endnotes_part is None:
            return endnotes
        from lxml import etree
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        root = etree.fromstring(endnotes_part.blob)
        for en in root.findall(qn("w:endnote")):
            en_id = en.get(qn("w:id"), "")
            paragraphs_text = []
            for p in en.findall(qn("w:p")):
                runs = p.findall(qn("w:r"))
                para_text = ""
                for r in runs:
                    t_elements = r.findall(qn("w:t"))
                    for t in t_elements:
                        if t.text:
                            para_text += t.text
                if para_text.strip():
                    paragraphs_text.append(para_text.strip())
            if paragraphs_text:
                endnotes.append({
                    "id": en_id,
                    "text": " ".join(paragraphs_text),
                })
    except Exception as e:
        logger.debug(f"提取尾注失败: {e}")
    return endnotes


def _fallback_mammoth_parse(content: bytes, filename: str) -> Optional[dict]:
    """
    mammoth 回退解析：支持 .doc（老格式）和 .docx
    mammoth 将文档转为 HTML，再提取纯文本。
    """
    try:
        import mammoth
    except ImportError:
        logger.warning("mammoth 未安装，无法回退解析 .doc 文件")
        return None

    try:
        result = mammoth.convert_to_html(io.BytesIO(content))
        html_text = result.value or ""
        messages = result.messages

        if not html_text.strip():
            logger.warning(f"mammoth 解析结果为空: {filename}")
            return None

        # HTML → 纯文本
        plain_text = re.sub(r'<[^>]+>', '', html_text)
        plain_text = re.sub(r'&nbsp;', ' ', plain_text)
        plain_text = re.sub(r'&[a-z]+;', '', plain_text)
        plain_text = re.sub(r'\n{3,}', '\n\n', plain_text).strip()

        # 提取段落
        paragraphs = []
        for para in re.split(r'<p[^>]*>|</p>', html_text):
            text = re.sub(r'<[^>]+>', '', para).strip()
            if text:
                paragraphs.append({"text": text, "style": "Normal", "page": 0})

        # 提取表格
        tables = []
        table_matches = re.findall(r'<table[^>]*>(.*?)</table>', html_text, re.DOTALL)
        for table_html in table_matches:
            rows = []
            for row_html in re.findall(r'<tr[^>]*>(.*?)</tr>', table_html, re.DOTALL):
                cells = []
                for cell_html in re.findall(r'<t[dh][^>]*>(.*?)</t[dh]>', row_html, re.DOTALL):
                    cell_text = re.sub(r'<[^>]+>', '', cell_html).strip()
                    cells.append(cell_text)
                if cells:
                    rows.append(cells)
            if rows:
                tables.append({"page": 0, "rows": rows, "caption": None})

        logger.info(f"mammoth 回退解析成功: {filename} → {len(plain_text)} chars")

        return {
            "text": plain_text,
            "pages": [plain_text] if plain_text else [],
            "metadata": {
                "page_count": 1,
                "has_tables": len(tables) > 0,
                "has_images": "<img" in html_text,
                "parse_error": None,
            },
            "structure": {
                "paragraphs": paragraphs,
                "tables": tables,
                "headers": [],
                "dimensions": [],
            },
            "markdown": html_text,
        }

    except Exception as e:
        logger.error(f"mammoth 回退解析失败: {filename} - {e}，尝试 LibreOffice 转换")
        return _fallback_libreoffice_parse(content, filename)


def _fallback_libreoffice_parse(content: bytes, filename: str) -> Optional[dict]:
    """
    .doc 老格式回退解析：优先 antiword 提取纯文本（轻量），失败再回退 LibreOffice 转 docx。
    """
    import subprocess
    import tempfile
    import os
    import shutil

    # 第一优先：antiword 直接提取文本（无需 LibreOffice，节省镜像体积）
    if shutil.which('antiword'):
        try:
            with tempfile.NamedTemporaryFile(suffix='.doc', delete=False) as tmp_in:
                tmp_in.write(content)
                tmp_in_path = tmp_in.name
            try:
                aw_result = subprocess.run(
                    ['antiword', tmp_in_path],
                    capture_output=True, timeout=60,
                )
            finally:
                if os.path.exists(tmp_in_path):
                    os.unlink(tmp_in_path)

            if aw_result.returncode == 0:
                text = aw_result.stdout.decode('utf-8', errors='replace').strip()
                if text:
                    logger.info(f"antiword 解析成功: {filename} ({len(text)} chars)")
                    paragraphs = [
                        {'text': line, 'style': 'Normal', 'page': 0}
                        for line in text.split('\n') if line.strip()
                    ]
                    return {
                        'text': text,
                        'pages': [text],
                        'metadata': {
                            'page_count': 1,
                            'has_tables': False,
                            'has_images': False,
                            'parse_error': None,
                            'parser': 'antiword',
                        },
                        'structure': {
                            'paragraphs': paragraphs,
                            'tables': [],
                            'headers': [],
                            'dimensions': [],
                        },
                        'markdown': text,
                        'table_kv_pairs': [],
                    }
                logger.warning(f"antiword 结果为空: {filename}")
            else:
                logger.warning(f"antiword 失败: {aw_result.stderr.decode('utf-8', errors='ignore')[:200]}")
        except Exception as e:
            logger.error(f"antiword 异常: {filename} - {e}", exc_info=True)

    # 第二优先：LibreOffice 转 docx（兜底）
    try:
        # 写入临时 .doc 文件
        with tempfile.NamedTemporaryFile(suffix='.doc', delete=False) as tmp_in:
            tmp_in.write(content)
            tmp_in_path = tmp_in.name

        tmp_dir = tempfile.mkdtemp()

        # LibreOffice 转换 .doc → .docx
        result = subprocess.run(
            ['libreoffice', '--headless', '--convert-to', 'docx', '--outdir', tmp_dir, tmp_in_path],
            capture_output=True, timeout=60,
        )

        os.unlink(tmp_in_path)

        if result.returncode != 0:
            logger.warning(f"LibreOffice 转换失败: {result.stderr.decode('utf-8', errors='ignore')}")
            return None

        # 读取转换后的 .docx
        docx_path = os.path.join(tmp_dir, os.path.splitext(os.path.basename(tmp_in_path))[0] + '.docx')
        if not os.path.exists(docx_path):
            logger.warning(f"LibreOffice 转换后文件不存在: {docx_path}")
            return None

        with open(docx_path, 'rb') as f:
            docx_content = f.read()

        os.unlink(docx_path)
        os.rmdir(tmp_dir)

        logger.info(f"LibreOffice 转换成功: {filename} → docx ({len(docx_content)} bytes)")

        # 用 python-docx 解析转换后的 .docx
        return enhanced_docx_parse(docx_content, filename + ' (converted)')

    except subprocess.TimeoutExpired:
        logger.error(f"LibreOffice 转换超时: {filename}")
        return None
    except Exception as e:
        logger.error(f"LibreOffice 回退解析失败: {filename} - {e}", exc_info=True)
        return None


def enhanced_docx_parse(content: bytes, filename: str) -> Optional[dict]:
    """
    增强型 DOCX 解析：使用 python-docx 原生解析，保留样式结构。
    提取正文、页眉页脚、文本框、脚注、尾注。

    Returns:
        dict: 兼容 ParseResult 格式的结果，失败返回 None。
    """
    try:
        from docx import Document
    except ImportError:
        logger.warning("python-docx 未安装，无法使用增强 DOCX 解析")
        return None

    try:
        doc = Document(io.BytesIO(content))
    except Exception as e:
        logger.warning(f"python-docx 打开文件失败: {filename} - {e}，尝试 mammoth 回退")
        return _fallback_mammoth_parse(content, filename)

    try:
        has_images = _has_images(doc)

        markdown_parts = []
        paragraphs = []
        headers = []
        tables = []

        from docx.oxml.ns import qn

        # ===== 1. 提取页眉页脚 =====
        header_footer_texts = []
        for section in doc.sections:
            try:
                if section.header and section.header.paragraphs:
                    for hp in section.header.paragraphs:
                        ht = hp.text.strip()
                        if ht:
                            header_footer_texts.append(ht)
            except Exception:
                pass
            try:
                if section.footer and section.footer.paragraphs:
                    for fp in section.footer.paragraphs:
                        ft = fp.text.strip()
                        if ft:
                            header_footer_texts.append(ft)
            except Exception:
                pass

        if header_footer_texts:
            markdown_parts.append("---\n**页眉页脚:**\n" + "\n".join(header_footer_texts))

        # ===== 2. 提取正文（保持文档流顺序） =====
        for child in doc.element.body:
            tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag

            if tag == "p":
                from docx.text.paragraph import Paragraph
                para = Paragraph(child, doc)
                text = _extract_paragraph_text(para)
                style_name = para.style.name if para.style else ""

                if not text:
                    continue

                heading_level = _detect_heading_level(style_name)

                if heading_level:
                    md_prefix = "#" * heading_level
                    markdown_parts.append(f"{md_prefix} {text}")
                    style = f"Heading{heading_level}"
                    paragraphs.append({"text": text, "style": style, "page": 0})
                    headers.append({"text": text, "type": style, "page": 0})
                elif _is_bold_and_large(para):
                    markdown_parts.append(f"### {text}")
                    paragraphs.append({"text": text, "style": "Heading3", "page": 0})
                else:
                    markdown_parts.append(text)
                    paragraphs.append({"text": text, "style": "Normal", "page": 0})

            elif tag == "tbl":
                from docx.table import Table
                table = Table(child, doc)
                table_md = _table_to_markdown(table)
                if table_md:
                    markdown_parts.append(table_md)
                    rows_data = []
                    for row in table.rows:
                        cells = [cell.text.strip() for cell in row.cells]
                        rows_data.append(cells)
                    if rows_data:
                        tables.append({
                            "page": 0,
                            "rows": rows_data,
                            "caption": None,
                        })

        # ===== 3. 提取脚注 =====
        footnotes = _extract_footnotes(doc)
        if footnotes:
            markdown_parts.append("\n---\n**脚注:**")
            for fn in footnotes:
                markdown_parts.append(f"[{fn['id']}] {fn['text']}")
                paragraphs.append({"text": fn["text"], "style": "Footnote", "page": 0})

        # ===== 4. 提取尾注 =====
        endnotes = _extract_endnotes(doc)
        if endnotes:
            markdown_parts.append("\n---\n**尾注:**")
            for en in endnotes:
                markdown_parts.append(f"[{en['id']}] {en['text']}")
                paragraphs.append({"text": en["text"], "style": "Endnote", "page": 0})

        # ===== 去重：移除连续重复的表格（页眉/页脚中的重复表格） =====
        deduped_parts = []
        last_table_hash = None
        for part in markdown_parts:
            lines = part.strip().split('\n')
            is_table = (
                len(lines) >= 2
                and any(re.match(r'^\|[\s\-:|]+\|$', l.strip()) for l in lines)
                and sum(1 for l in lines if l.strip().startswith('|')) >= 2
            )
            if is_table:
                table_hash = hash(part.strip())
                if table_hash == last_table_hash:
                    continue  # 跳过连续重复的表格
                last_table_hash = table_hash
            else:
                last_table_hash = None
            deduped_parts.append(part)
        markdown_parts = deduped_parts

        markdown_text = "\n\n".join(markdown_parts)
        plain_text = "\n\n".join(p["text"] for p in paragraphs if p["text"])

        return {
            "text": plain_text,
            "pages": [plain_text] if plain_text else [],
            "metadata": {
                "page_count": 1,
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
        logger.error(f"增强 DOCX 解析失败: {filename} - {e}", exc_info=True)
        return None
