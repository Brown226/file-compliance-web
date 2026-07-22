"""
增强型 XLSX 解析器
- 使用 openpyxl 原生解析，正确处理合并单元格
- 生成 Markdown 表格，保留表头重复
- 支持嵌入图片检测
"""

import io
import logging
from typing import Optional

logger = logging.getLogger("markitdown-service")

# 单个 Markdown 表格块的最大字符数（超过则分片并重复表头）
_TABLE_CHUNK_LIMIT = 4096


def _escape_pipe(text: str) -> str:
    """转义 Markdown 表格中的管道符（使用HTML实体避免JSON序列化问题）"""
    return text.replace("|", "&#124;")


def _clean_cell(value) -> str:
    """
    将单元格值清理为单行字符串，用于 Markdown 表格单元格。
    None -> ""
    多行 -> <br/> 拼接
    管道符 -> 转义
    """
    if value is None:
        return ""
    if isinstance(value, str):
        s = value.strip()
    else:
        s = str(value)

    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = s.replace("\n", "<br/>")
    s = _escape_pipe(s)
    return s


def _fill_merged_cells(sheet) -> None:
    """
    将合并单元格区域中的空单元格填充为左上角单元格的值。
    跳过 MergedCell（只读对象，非合并区域左上角的单元格）。
    """
    for merged_range in sheet.merged_cells.ranges:
        min_col, min_row, max_col, max_row = (
            merged_range.min_col,
            merged_range.min_row,
            merged_range.max_col,
            merged_range.max_row,
        )
        top_left_value = sheet.cell(row=min_row, column=min_col).value
        for row in range(min_row, max_row + 1):
            for col in range(min_col, max_col + 1):
                if row == min_row and col == min_col:
                    continue  # 跳过左上角单元格自身
                try:
                    cell = sheet.cell(row=row, column=col)
                    if cell.value is None:
                        cell.value = top_left_value
                except AttributeError:
                    pass  # MergedCell 只读，跳过


def _detect_images(workbook) -> bool:
    """检测工作簿中是否包含嵌入图片"""
    try:
        if hasattr(workbook, "_archive"):
            archive = workbook._archive
            if "xl/cellimages.xml" in archive.namelist():
                return True
            for name in archive.namelist():
                if name.startswith("xl/media/") and name.endswith((".png", ".jpg", ".jpeg", ".gif", ".bmp")):
                    return True
    except Exception:
        pass
    return False


def _sheet_to_markdown(sheet) -> str:
    """将单个工作表转换为 Markdown 表格字符串"""
    max_row = sheet.max_row
    max_col = sheet.max_column

    if max_row is None or max_col is None or max_row < 1 or max_col < 1:
        return ""

    rows_data = []
    for row in range(1, max_row + 1):
        cells = []
        for col in range(1, max_col + 1):
            cell_value = sheet.cell(row=row, column=col).value
            cells.append(_clean_cell(cell_value))
        rows_data.append(cells)

    if not rows_data:
        return ""

    num_cols = max(len(r) for r in rows_data)
    for r in rows_data:
        while len(r) < num_cols:
            r.append("")

    header = rows_data[0]
    header_line = "| " + " | ".join(header) + " |"
    separator_line = "| " + " | ".join(["---"] * num_cols) + " |"
    body_lines = ["| " + " | ".join(row) + " |" for row in rows_data[1:]]

    full_table = header_line + "\n" + separator_line + "\n" + "\n".join(body_lines)

    if len(full_table) <= _TABLE_CHUNK_LIMIT:
        return full_table

    # 分片：每个分片重复表头
    chunks = []
    current_lines = [header_line, separator_line]
    current_len = len(header_line) + len(separator_line) + 1

    for line in body_lines:
        line_len = len(line) + 1
        if current_len + line_len > _TABLE_CHUNK_LIMIT and len(current_lines) > 2:
            chunks.append("\n".join(current_lines))
            current_lines = [header_line, separator_line]
            current_len = len(header_line) + len(separator_line) + 1

        current_lines.append(line)
        current_len += line_len

    if len(current_lines) > 2:
        chunks.append("\n".join(current_lines))

    return "\n\n".join(chunks)


def _build_structure(markdown_text: str) -> dict:
    """从 Markdown 文本构建 structure 字段"""
    paragraphs = []
    tables = []
    headers = []

    lines = markdown_text.split("\n")
    current_table_rows = []
    current_page = 0

    for line in lines:
        stripped = line.strip()

        # 表格行
        if stripped.startswith("|") and stripped.endswith("|"):
            # 跳过分隔行
            if len(stripped) >= 3 and all(c in "|-: " for c in stripped):
                continue
            cells = [c.strip() for c in stripped.strip("|").split("|")]
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

        # 标题行（## SheetName）
        if stripped.startswith("## "):
            sheet_name = stripped[3:].strip()
            paragraphs.append({"text": sheet_name, "style": "Heading2", "page": current_page})
            headers.append({"text": sheet_name, "type": "Heading2", "page": current_page})
        elif stripped:
            paragraphs.append({"text": stripped, "style": "Normal", "page": current_page})

    # 末尾表格
    if current_table_rows:
        tables.append({
            "page": current_page,
            "rows": current_table_rows,
            "caption": None,
        })

    return {"paragraphs": paragraphs, "tables": tables, "headers": headers}


def enhanced_xlsx_parse(content: bytes, filename: str) -> Optional[dict]:
    """
    增强型 XLSX 解析：使用 openpyxl 原生解析，正确处理合并单元格。

    Returns:
        dict: 兼容 ParseResult 格式的结果，失败返回 None。
    """
    try:
        import openpyxl
    except ImportError:
        logger.warning("openpyxl 未安装，无法使用增强解析")
        return None

    try:
        workbook = openpyxl.load_workbook(io.BytesIO(content), data_only=True)
    except Exception as e:
        logger.warning(f"openpyxl 打开文件失败: {filename} - {e}")
        raise  # 透传异常，让调用者获得具体错误信息

    try:
        has_images = _detect_images(workbook)

        markdown_parts = []
        has_tables = False

        for sheet_name in workbook.sheetnames:
            sheet = workbook[sheet_name]

            # 填充合并单元格
            _fill_merged_cells(sheet)

            # 跳过完全空的工作表
            if sheet.max_row is None or sheet.max_row < 1:
                continue

            # 添加 sheet 标题
            markdown_parts.append(f"## {sheet_name}")

            # 转换为 Markdown 表格
            table_md = _sheet_to_markdown(sheet)
            if table_md:
                markdown_parts.append(table_md)
                has_tables = True

        markdown_text = "\n\n".join(markdown_parts)

        # 构建结构化数据
        structure = _build_structure(markdown_text)

        # 构建纯文本
        plain_text_lines = []
        for part in markdown_parts:
            if part.startswith("## "):
                plain_text_lines.append(part[3:].strip())
            else:
                cleaned = part
                cleaned = cleaned.replace("## ", "")
                cleaned = cleaned.replace("|", " ")
                # 去掉分隔行
                cleaned = "\n".join(
                    line for line in cleaned.split("\n")
                    if not (line.strip() and all(c in "|-: " for c in line.strip()))
                )
                cleaned = "\n".join(
                    line for line in cleaned.split("\n")
                    if line.strip()
                )
                if cleaned.strip():
                    plain_text_lines.append(cleaned.strip())

        plain_text = "\n\n".join(plain_text_lines)
        pages = [plain_text] if plain_text else []

        result = {
            "text": plain_text,
            "pages": pages,
            "metadata": {
                "page_count": 1,
                "has_tables": has_tables,
                "has_images": has_images,
                "parse_error": None,
            },
            "structure": {
                "paragraphs": structure["paragraphs"],
                "tables": structure["tables"],
                "headers": structure["headers"],
                "dimensions": [],
            },
            "markdown": markdown_text,
        }

        workbook.close()
        return result

    except Exception as e:
        logger.error(f"增强 XLSX 解析失败: {filename} - {e}", exc_info=True)
        try:
            workbook.close()
        except Exception:
            pass
        raise  # 透传异常，让调用者获得具体错误信息
