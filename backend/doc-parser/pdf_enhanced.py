"""
增强型 PDF 解析器
- 使用 PyMuPDF (fitz) 进行字体大小启发式标题检测
- 保留页码结构，逐页提取文本
- 使用 PyMuPDF 内置 find_tables() 提取表格
- OPT-010: 页码/页眉页脚智能过滤 + 换行连续性合并
- OPT-011: 封面图片检测 + RapidOCR 识别 + 结构化提取
"""

import logging
import re
from typing import Optional

logger = logging.getLogger("markitdown-service")

# ==================== OPT-010: 页码/页眉页脚过滤 ====================

# 页码正则：纯数字、常见页码格式
_PAGE_NUMBER_PATTERNS = [
    re.compile(r'^\s*\d{1,4}\s*$'),                    # 纯数字: "1", "23"
    re.compile(r'^\s*-\s*\d{1,4}\s*-\s*$'),            # "- 3 -"
    re.compile(r'^\s*\u2014\s*\d{1,4}\s*\u2014\s*$'),  # "— 3 —"
    re.compile(r'^\s*第\s*\d{1,4}\s*页\s*$'),           # "第3页"
    re.compile(r'^\s*[Pp]age\s+\d{1,4}\s*$'),          # "Page 3"
    re.compile(r'^\s*\d{1,4}\s*/\s*\d{1,4}\s*$'),      # "3/50"
    re.compile(r'^\s*\d{1,4}\s*of\s*\d{1,4}\s*$', re.I),  # "3 of 50"
]


def _is_page_number(text: str) -> bool:
    """判断文本是否为页码"""
    for pattern in _PAGE_NUMBER_PATTERNS:
        if pattern.match(text):
            return True
    return False


def _is_header_footer(text: str, bbox: tuple, page_height: float, font_size: float, body_size: float) -> bool:
    """
    综合判断是否为页眉/页脚：
    - 位于页面顶部/底部 5% 区域
    - 字号明显小于正文
    - 符合页码格式
    - 短文本（<50字）且在页面边缘
    """
    y_pos = bbox[1]  # 左上角 y 坐标
    top_margin = page_height * 0.05
    bottom_margin = page_height * 0.95

    # 页码直接过滤
    if _is_page_number(text):
        return True

    # 字号明显小 + 位于边缘区域
    if font_size < body_size * 0.75:
        if y_pos < top_margin or y_pos > bottom_margin:
            return True

    # 短文本 + 位于极端边缘（2%）+ 字号不大于正文
    extreme_top = page_height * 0.02
    extreme_bottom = page_height * 0.98
    if len(text) < 50 and font_size <= body_size:
        if y_pos < extreme_top or y_pos > extreme_bottom:
            return True

    return False


# ==================== OPT-010: 换行连续性合并 ====================

# 行尾标点：表示句子结束，不应合并
_LINE_END_PUNCTUATION = set('。！？；：、）】》"\')]}')


def _should_merge_lines(prev_text: str, curr_text: str) -> bool:
    """
    判断相邻两行是否应合并（PDF 断行伪影修复）。
    合并条件：
    - 前行不以句末标点结尾
    - 后行首字为小写字母或中文字符（非标题/编号开头）
    - 后行不是纯数字/编号格式
    """
    if not prev_text or not curr_text:
        return False

    # 前行以句末标点结尾 → 不合并
    if prev_text[-1] in _LINE_END_PUNCTUATION:
        return False

    # 后行以数字/编号开头 → 不合并（可能是新段落/列表项）
    if re.match(r'^[\d\(\[（【]', curr_text):
        return False

    # 后行以大写英文字母开头 → 可能是新句子，不合并
    # 但全大写编码（如 HAF601、GB/T、ASME）是句中引用，应合并
    if curr_text[0].isupper() and curr_text[0].isascii():
        # 判断是否为编码/标准号（全大写+数字+符号，无小写字母）
        word_match = re.match(r'^[A-Z0-9/\-_.]+', curr_text)
        if word_match:
            word = word_match.group()
            has_lowercase = any(c.islower() for c in curr_text[:len(word)+3])
            if not has_lowercase:
                # 全大写编码，允许合并
                return True
            else:
                return False  # 有大小写混合，视为新句子
        else:
            return False

    # 后行以 Markdown 标题标记开头 → 不合并
    if curr_text.startswith('#'):
        return False

    # 后行首字为中文或小写字母 → 合并
    first_char = curr_text[0]
    if '\u4e00' <= first_char <= '\u9fff':  # 中文
        return True
    if first_char.islower():  # 小写字母
        return True

    return False


def _merge_broken_lines(lines: list) -> list:
    """对一组文本行执行断行合并"""
    if not lines:
        return lines

    merged = [lines[0]]
    for i in range(1, len(lines)):
        if _should_merge_lines(merged[-1], lines[i]):
            # 合并：中文直接拼接，英文加空格
            prev = merged[-1]
            curr = lines[i]
            if prev and prev[-1].isascii() and curr and curr[0].isascii():
                merged[-1] = prev + ' ' + curr
            else:
                merged[-1] = prev + curr
        else:
            merged.append(lines[i])
    return merged


# ==================== OPT-011: 封面图片检测与结构化提取 ====================

# 封面字段正则
_COVER_PATTERNS = {
    'doc_no': re.compile(r'[A-Z]{2,6}[-/][A-Z0-9][-A-Z0-9/]*\d{2,}[-\w]*'),  # 文档编号: NPC-QA-001, NPC-001, HAF-601
    'revision': re.compile(r'[Vv]\d+\.\d+|第\s*\d+\s*版|[Rr]ev\.?\s*[A-Z0-9]+'),  # 版本
    'scale': re.compile(r'\d+\s*[:：]\s*\d+'),                      # 比例: 1:100
}

# 审批角色关键词
_APPROVAL_ROLES = ['设计', '校核', '审核', '审定', '批准', '编制', '复核']


def _detect_cover_pages(pdf_doc, max_check_pages: int = 3) -> list:
    """
    检测前几页中哪些是「图片封面」（无文本层但有图片）。
    返回封面页索引列表。
    """
    cover_pages = []
    for page_idx in range(min(len(pdf_doc), max_check_pages)):
        page = pdf_doc[page_idx]
        text = page.get_text().strip()
        images = page.get_images(full=True)

        # 文本极少（<20字）但有图片 → 判定为图片封面
        if len(text) < 20 and images:
            cover_pages.append(page_idx)

    return cover_pages


def _ocr_cover_page(page, dpi: int = 200) -> Optional[str]:
    """对封面页进行 OCR 识别（使用 RapidOCR）"""
    try:
        from rapid_ocr import recognize_with_rapidocr
        from PIL import Image

        # 渲染页面为图片
        zoom = dpi / 72.0
        import fitz
        matrix = fitz.Matrix(zoom, zoom)
        pix = page.get_pixmap(matrix=matrix)
        img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)

        # 转为字节调用 RapidOCR
        import io
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        img_bytes = buf.getvalue()

        result = recognize_with_rapidocr(img_bytes, 'png', f'cover_page')
        if result and result.get('text'):
            return result['text']
    except ImportError:
        logger.warning("RapidOCR 未安装，跳过封面 OCR")
    except Exception as e:
        logger.warning(f"封面 OCR 失败: {e}")
    return None


def _extract_cover_fields(ocr_text: str) -> dict:
    """从 OCR 文本中提取封面结构化字段"""
    lines = [line.strip() for line in ocr_text.split('\n') if line.strip()]

    cover_info = {
        'doc_no': '',
        'title': '',
        'revision': '',
        'scale': '',
        'approval': {},  # {role: name}
        'raw_lines': lines[:20],  # 保留前20行供调试
    }

    # 提取文档编号
    for line in lines:
        match = _COVER_PATTERNS['doc_no'].search(line)
        if match:
            cover_info['doc_no'] = match.group()
            break

    # 提取版本号
    for line in lines:
        match = _COVER_PATTERNS['revision'].search(line)
        if match:
            cover_info['revision'] = match.group()
            break

    # 提取比例
    for line in lines:
        match = _COVER_PATTERNS['scale'].search(line)
        if match:
            cover_info['scale'] = match.group()
            break

    # 提取标题：取最长的中文行（排除编号/版本行）
    chinese_lines = [
        line for line in lines
        if len(line) > 4 and any('\u4e00' <= c <= '\u9fff' for c in line)
        and not _COVER_PATTERNS['doc_no'].search(line)
        and not _COVER_PATTERNS['revision'].search(line)
    ]
    if chinese_lines:
        cover_info['title'] = max(chinese_lines, key=len)

    # 提取审批信息
    for line in lines:
        for role in _APPROVAL_ROLES:
            if role in line:
                # 尝试提取角色后面的人名
                parts = re.split(r'[:：\s]+', line, maxsplit=1)
                if len(parts) >= 2:
                    name = parts[-1].strip()
                    if 1 < len(name) < 10:  # 人名长度合理
                        cover_info['approval'][role] = name
                break

    return cover_info


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


def _extract_tables_with_pymupdf(pdf_doc) -> list:
    """使用 PyMuPDF 内置 find_tables() 提取表格（替代 pdfplumber）"""
    tables = []
    for page_idx, page in enumerate(pdf_doc):
        try:
            tab_finder = page.find_tables()
            for table in tab_finder.tables:
                rows = table.extract()
                if rows and len(rows) > 1:
                    cleaned = []
                    for row in rows:
                        cleaned.append([
                            (cell or "").replace("\n", " ").strip()
                            for cell in row
                        ])
                    tables.append({
                        "page": page_idx,
                        "rows": cleaned,
                        "caption": None,
                    })
        except Exception as e:
            logger.warning(f"PyMuPDF 表格提取失败(页{page_idx}): {e}")
    return tables


def enhanced_pdf_parse(content: bytes, filename: str) -> Optional[dict]:
    """
    增强型 PDF 解析：
    1. PyMuPDF 逐页提取文本 + 字体大小启发式标题检测
    2. PyMuPDF 内置 find_tables() 提取表格
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

                    # OPT-010: 页眉页脚/页码智能过滤
                    bbox = line["bbox"]
                    if _is_header_footer(line_text, bbox, page.rect.height, max_font_size, body_size):
                        continue

                    # 标题检测
                    heading_level = _detect_heading_level(max_font_size, max_font_flags, body_size)

                    if heading_level:
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

            # OPT-010: 换行连续性合并
            page_text_parts = _merge_broken_lines(page_text_parts)
            pdf_pages.append("\n".join(page_text_parts))

        # OPT-011: 封面图片检测 + OCR
        cover_info = None
        cover_pages = _detect_cover_pages(pdf_doc)
        if cover_pages:
            logger.info(f"检测到 {len(cover_pages)} 个图片封面页: {cover_pages}")
            for cp_idx in cover_pages:
                ocr_text = _ocr_cover_page(pdf_doc[cp_idx])
                if ocr_text:
                    cover_info = _extract_cover_fields(ocr_text)
                    logger.info(f"封面 OCR 成功: 编号={cover_info.get('doc_no')}, "
                               f"标题={cover_info.get('title', '')[:30]}")
                    # 将封面文本加入第一页内容
                    if pdf_pages:
                        pdf_pages[0] = f"[封面]\n{ocr_text}\n\n{pdf_pages[0]}"
                    break  # 只处理第一个封面页

        # 使用 PyMuPDF 内置 find_tables() 提取表格（需在 close 之前）
        tables_from_pdf = _extract_tables_with_pymupdf(pdf_doc)

        pdf_doc.close()

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
                "cover_info": cover_info,  # OPT-011: 封面结构化信息
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
