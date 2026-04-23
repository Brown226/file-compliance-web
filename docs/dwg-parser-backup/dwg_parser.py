import os
import re
import tempfile
import subprocess
import logging

import ezdxf

logger = logging.getLogger(__name__)

# 标准引用正则（1:1 移植旧系统 Normative DocHandleBase.GetDocStandards）
STANDARD_REF_PATTERN = re.compile(
    r'《.*?》\s*[\(（]?\s*([A-Za-z/]+)\s?(\d+[-/.]?\d*([-/.:]\d+)*)[\)）]?([\(（].*[\)）])?',
    re.IGNORECASE
)

# 仅编号正则（Excel 类型专用，限定常见标准前缀避免误匹配）
CODE_ONLY_PATTERN = re.compile(
    r'[\(（]?(GB|GB/T|NB|NB/T|HJ|DL|DL/T|CECS|HAF|EJ|EJ/T|JGJ|CJJ|JG|HG|SH|SY|YY|QB|SL|TB|JT|YB|DB|DBJ|QX|GBJ|TJ|BJG|GYJ)\s?(\d+[-/.]?\d*([-/.:]\d+)*)[\)）]?([\(（].*[\)」])?',
    re.IGNORECASE
)


def get_ident(standard_no: str) -> str:
    """从标准编号中提取字母标识符（移植自旧系统 NormativeHelper.GetIdent）

    示例:
        "GB/T 50001-2017" → "GB/T"
        "NB/T 20292-2014" → "NB/T"
        "HJ 212-2017" → "HJ"
    """
    if not standard_no:
        return ''
    ident = ''
    for c in standard_no:
        if c == '/':
            ident += c
            continue
        if c.upper().isalpha():
            ident += c
        else:
            break
    return ident


def extract_standard_refs(text: str, doc_type: str = '') -> list:
    """从文本中提取标准规范引用（移植自旧系统 GetDocStandards）

    Args:
        text: 文档文本内容
        doc_type: 文档类型（xlsx/xls 使用 CODE_ONLY_PATTERN）

    Returns:
        提取到的标准引用列表，已去重
    """
    if not text:
        return []

    is_excel = doc_type in ('xlsx', 'xls')
    pattern = CODE_ONLY_PATTERN if is_excel else STANDARD_REF_PATTERN

    results = []
    seen = set()

    for match in pattern.finditer(text):
        full_match = match.group(0)
        if full_match in seen:
            continue
        seen.add(full_match)

        standard_no = ''
        standard_name = ''

        if is_excel:
            standard_no = full_match.strip()
        else:
            book_end = full_match.find('》')
            if book_end >= 0:
                book_start = full_match.find('《')
                standard_name = full_match[book_start + 1:book_end].strip()
                standard_no = full_match[book_end + 1:].strip()
            else:
                standard_no = full_match.strip()

        # 清理编号
        standard_no = re.sub(r'^[\s\(（]+|[\s\)）]+$', '', standard_no)

        if standard_no:
            results.append({
                "standardNo": standard_no,
                "standardName": standard_name,
                "standardIdent": get_ident(standard_no),
                "fullMatch": full_match
            })

    return results


def _dwg_to_dxf(dwg_path: str) -> str | None:
    """使用 ODA File Converter 将 DWG 转换为 DXF

    尝试以下方式（按优先级）：
    1. ODA File Converter 命令行 (ODAFileConverter)
    2. LibreDWG 的 dwg2dxf
    3. ezdxf 的 recover 模式（有限支持）
    """
    # 尝试 ODA File Converter
    try:
        output_dir = tempfile.mkdtemp()
        # ODA File Converter 命令行格式: ODAFileConverter input_dir output_dir version recurse filter
        result = subprocess.run(
            ['ODAFileConverter', os.path.dirname(dwg_path), output_dir, 'ACAD2018', '0', 'DXF'],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0:
            # 找到转换后的 DXF 文件
            base_name = os.path.splitext(os.path.basename(dwg_path))[0]
            dxf_path = os.path.join(output_dir, f'{base_name}.dxf')
            if os.path.exists(dxf_path):
                return dxf_path
    except FileNotFoundError:
        logger.debug("ODAFileConverter not found, trying dwg2dxf...")
    except Exception as e:
        logger.debug(f"ODA File Converter failed: {e}")

    # 尝试 dwg2dxf (LibreDWG)
    try:
        dxf_path = dwg_path.replace('.dwg', '.dxf').replace('.DWG', '.dxf')
        result = subprocess.run(
            ['dwg2dxf', dwg_path, '-o', dxf_path],
            capture_output=True, text=True, timeout=60
        )
        if result.returncode == 0 and os.path.exists(dxf_path):
            return dxf_path
    except FileNotFoundError:
        logger.debug("dwg2dxf not found")
    except Exception as e:
        logger.debug(f"dwg2dxf failed: {e}")

    return None


def parse_dwg(file_bytes: bytes, file_name: str = '') -> dict:
    """解析 DWG/DXF 文件，返回结构化数据。

    使用 ezdxf 读取 DXF 格式文件，提取文本实体、尺寸标注和图层信息。
    对于 DWG 文件，尝试使用 ODA File Converter 或 dwg2dxf 转换为 DXF。
    同时提取标准规范引用（移植自旧系统 Normative）。
    """
    tmp_path = None
    converted_dxf_path = None

    try:
        # 判断是 DWG 还是 DXF
        is_dwg = file_name.lower().endswith('.dwg')

        # 写入临时文件
        suffix = '.dwg' if is_dwg else '.dxf'
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        dxf_path = tmp_path

        # DWG 文件需要先转换为 DXF
        if is_dwg:
            converted_dxf_path = _dwg_to_dxf(tmp_path)
            if converted_dxf_path:
                dxf_path = converted_dxf_path
                logger.info(f"DWG 转换成功: {file_name} → DXF")
            else:
                # 无法转换，尝试 ezdxf recover（有限支持）
                logger.warning(f"DWG 无法转换，尝试 ezdxf recover: {file_name}")

        # 读取 DXF 文件
        try:
            doc = ezdxf.recover.readfile(dxf_path)
        except ezdxf.DXFStructureError:
            doc = ezdxf.readfile(dxf_path)

        msp = doc.modelspace()

        layers = set()
        text_entities = []
        dimension_entities = []
        standard_refs = []

        for entity in msp:
            layer_name = entity.dxf.get('layer', '0')
            layers.add(layer_name)

            # 提取文本实体
            if entity.dxftype() in ('TEXT', 'MTEXT'):
                text_content = ''
                if entity.dxftype() == 'MTEXT':
                    text_content = entity.text or ''
                else:
                    text_content = entity.dxf.get('text', '')
                if text_content.strip():
                    handle = entity.dxf.get('handle', '')
                    insert_point = None
                    if entity.dxf.hasattr('insert'):
                        try:
                            ins = entity.dxf.insert
                            if hasattr(ins, '__iter__'):
                                insert_point = list(ins)[:2]
                            else:
                                insert_point = [ins, 0]
                        except Exception:
                            pass

                    text_entities.append({
                        "text": text_content.strip(),
                        "layer": layer_name,
                        "entity_type": entity.dxftype(),
                        "handle": handle,
                        "insert": insert_point
                    })

                    # 提取标准引用
                    refs = extract_standard_refs(text_content.strip())
                    for ref in refs:
                        ref['cadHandleId'] = handle
                        standard_refs.append(ref)

            # 提取尺寸标注
            elif entity.dxftype() in ('DIMENSION', 'ARC_DIMENSION', 'LARGE_RADIAL_DIMENSION'):
                dim_text = entity.dxf.get('text', '') or ''
                measurement = None
                if entity.dxf.hasattr('measurement'):
                    try:
                        measurement = str(entity.dxf.get('measurement', ''))
                    except Exception:
                        pass
                dimension_entities.append({
                    "text": dim_text,
                    "layer": layer_name,
                    "entity_type": entity.dxftype(),
                    "handle": entity.dxf.get('handle', ''),
                    "measurement": measurement
                })

        # 标准引用去重
        seen_refs = set()
        unique_refs = []
        for ref in standard_refs:
            key = ref['standardNo']
            if key not in seen_refs:
                seen_refs.add(key)
                unique_refs.append(ref)

        # 构建纯文本
        text_parts = [t["text"] for t in text_entities]
        if dimension_entities:
            text_parts.append("\n--- 尺寸标注 ---")
            for d in dimension_entities:
                text_parts.append(f"标注: {d['text'] or '(测量值)'} 图层: {d['layer']}")

        full_text = "\n".join(text_parts)

        paragraphs = [
            {
                "text": t["text"],
                "style": f"图层:{t['layer']}",
                "page": None,
                "handle": t["handle"]
            }
            for t in text_entities
        ]

        return {
            "text": full_text,
            "pages": [full_text],
            "metadata": {
                "page_count": 1,
                "has_tables": False,
                "has_images": False,
                "dwg_layers": sorted(list(layers)),
                "dwg_text_count": len(text_entities),
                "dwg_dimension_count": len(dimension_entities),
                "standard_ref_count": len(unique_refs),
                "dwg_converted": is_dwg and converted_dxf_path is not None
            },
            "structure": {
                "paragraphs": paragraphs,
                "tables": [],
                "dimensions": dimension_entities,
                "standardRefs": unique_refs
            }
        }

    except Exception as e:
        logger.warning(f"DWG/DXF 解析失败: {e}")
        return {
            "text": "",
            "pages": [],
            "metadata": {
                "page_count": 0,
                "has_tables": False,
                "has_images": False,
                "parse_error": str(e),
                "hint": "DWG 文件需要先转换为 DXF 格式。可安装 ODA File Converter 或使用 LibreDWG 的 dwg2dxf 工具。"
            },
            "structure": {
                "paragraphs": [],
                "tables": [],
                "standardRefs": []
            }
        }

    finally:
        # 清理临时文件
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass
        if converted_dxf_path and os.path.exists(converted_dxf_path):
            try:
                os.unlink(converted_dxf_path)
            except Exception:
                pass
