"""
章节内容提取工具

用于从 RAGFlow 返回的 chunk 内容中，精确提取目标章节的内容。
解决 chunk 跨章节导致的内容混杂问题。
"""
import re
import logging
from typing import Optional, List, Tuple

logger = logging.getLogger(__name__)


class ChapterExtractor:
    """章节内容提取器"""

    # 章节标题匹配模式
    # 支持格式: "# 1.", "## 1.1", "1.", "1.1", "一、", "（一）" 等
    CHAPTER_PATTERNS = [
        # Markdown 格式: # 1. xxx, ## 1.1 xxx, ## 7.8外墙 (无分隔符)
        r'^(#{1,6}\s*)(\d+(?:\.\d+)*)(?:\s*[\.、\s]|\s*(?=[^\d\.]))',
        # 纯数字格式: 1. xxx, 1.1 xxx, 13.6外墙 (无分隔符)
        r'^(\d+(?:\.\d+)*)(?:\s*[\.、\s]|\s*(?=[^\d\.]))',
        # 中文数字格式: 一、xxx
        r'^([一二三四五六七八九十]+)[、\.]\s*',
        # 带括号的中文数字: （一）xxx
        r'^[（\(]([一二三四五六七八九十]+)[）\)]\s*',
    ]

    # 中文数字映射
    CHINESE_NUM_MAP = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
        '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
        '十一': 11, '十二': 12, '十三': 13, '十四': 14, '十五': 15,
    }

    @classmethod
    def extract_chapter_content(
        cls,
        content: str,
        target_chapter_title: str,
        include_subchapters: bool = True
    ) -> str:
        """
        从内容中提取目标章节的内容

        Args:
            content: chunk 的原始内容
            target_chapter_title: 目标章节标题（如 "7.8 门窗" 或 "7. 建筑装修"）
            include_subchapters: 是否包含子章节内容，默认 True

        Returns:
            提取的章节内容，如果无法提取则返回原内容
        """
        if not content:
            return content

        # 解析目标章节号
        target_chapter_num = cls._parse_chapter_number(target_chapter_title) if target_chapter_title else None

        # 如果标题中没有章节号，尝试在内容中找到包含该标题的行，提取其章节号
        if not target_chapter_num and target_chapter_title:
            target_chapter_num = cls._find_chapter_by_title_match(content, target_chapter_title)

        # 如果还是没有章节号，使用第一个检测到的章节号
        if not target_chapter_num:
            target_chapter_num = cls._detect_first_chapter_in_content(content)
            if not target_chapter_num:
                return content

        target_main_chapter = cls._get_main_chapter(target_chapter_num)

        # 预处理：将 <br> / <br/> 标签转为换行符，确保章节标记在行首
        normalized = cls._normalize_content(content)

        # 按行分析内容，提取目标章节
        lines = normalized.split('\n')
        result_lines = []
        in_target_chapter = False

        for line in lines:
            line_chapter_num = cls._detect_chapter_number(line)
            if line_chapter_num:
                line_main_chapter = cls._get_main_chapter(line_chapter_num)
                if include_subchapters:
                    in_target_chapter = (line_main_chapter == target_main_chapter)
                else:
                    in_target_chapter = cls._is_target_or_subchapter(line_chapter_num, target_chapter_num)

            if in_target_chapter:
                result_lines.append(line)

        if result_lines:
            extracted = '\n'.join(result_lines)
            logger.debug(f"[章节提取] 目标={target_main_chapter}, {len(content)}→{len(extracted)}字符")
            return extracted

        return content

    @classmethod
    def _normalize_content(cls, content: str) -> str:
        """
        预处理内容，统一换行格式

        RAGFlow 返回的 chunk 内容可能使用 <br>/<br/> 作为换行符，
        需要统一转换为 \\n，确保章节标记出现在行首以便正确检测。
        """
        if not content:
            return content

        text = content
        # 替换 <br/> <br /> <br> 为换行符
        text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
        # 确保 Markdown 标题标记前有换行（防止 ## 紧跟在文本后面）
        text = re.sub(r'(?<!\n)(#{1,6}\s+\d)', r'\n\1', text)
        # 确保句末标点后的章节号前有换行（如 "...文字。8.1 xxx"）
        # 注意：只在句末标点（。！？；：）后插入换行，避免拆分 13.5.6 这样的多级章节号
        text = re.sub(r'([。！？；：])\s*(\d+(?:\.\d+)*\s)', r'\1\n\2', text)
        return text

    @classmethod
    def _find_chapter_by_title_match(cls, content: str, title: str) -> Optional[str]:
        """
        在内容中查找包含指定标题的行，并提取该行的章节号

        当搜索标题为 "幕墙、天窗、玻璃雨棚工程" 时，在内容中查找包含该文本的行，
        如 "# 8.幕墙、天窗、玻璃雨棚工程"，并提取章节号 "8"。

        Args:
            content: chunk 的原始内容
            title: 搜索标题

        Returns:
            匹配行的章节号，未找到返回 None
        """
        if not content or not title:
            return None

        normalized = cls._normalize_content(content)
        lines = normalized.split('\n')

        # 清理标题，移除可能的标点和章节号前缀
        clean_title = title.strip().rstrip('：:')
        clean_title = re.sub(r'^#+\s*', '', clean_title)
        clean_title = re.sub(r'^\d+(?:\.\d+)*\s*[\.、\s]*', '', clean_title)

        # 第一轮：精确子串匹配
        for line in lines:
            if clean_title in line:
                chapter_num = cls._detect_chapter_number(line)
                if chapter_num:
                    return chapter_num

        # 第二轮：按顿号/逗号拆分标题关键词，匹配包含主要关键词的行
        keywords = re.split(r'[、，,]', clean_title)
        keywords = [k.strip() for k in keywords if len(k.strip()) >= 2]
        if keywords:
            for line in lines:
                matched_count = sum(1 for kw in keywords if kw in line)
                if matched_count >= max(1, len(keywords) // 2):
                    chapter_num = cls._detect_chapter_number(line)
                    if chapter_num:
                        return chapter_num

        return None

    @classmethod
    def _detect_first_chapter_in_content(cls, content: str) -> Optional[str]:
        """
        从内容中检测第一个出现的章节号

        当目标章节标题不含章节号时（如"幕墙、天窗、玻璃雨棚工程"），
        从 chunk 内容本身检测第一个章节号，作为该 chunk 的主章节。

        Args:
            content: chunk 的原始内容

        Returns:
            第一个检测到的章节号，如 "7.8"，未检测到返回 None
        """
        if not content:
            return None

        normalized = cls._normalize_content(content)
        lines = normalized.split('\n')

        for line in lines:
            chapter_num = cls._detect_chapter_number(line)
            if chapter_num:
                return chapter_num

        return None

    @classmethod
    def _parse_chapter_number(cls, title: str) -> Optional[str]:
        """
        从章节标题中解析章节号

        Args:
            title: 章节标题，如 "7.8 门窗通用技术条件" 或 "## 7.8 门窗"

        Returns:
            章节号字符串，如 "7.8"，解析失败返回 None
        """
        if not title:
            return None

        title = title.strip()
        # 移除 Markdown 标记
        title = re.sub(r'^#+\s*', '', title)

        # 尝试匹配数字章节号（开头）
        match = re.match(r'^(\d+(?:\.\d+)*)', title)
        if match:
            return match.group(1)

        # 尝试匹配中文数字（开头）
        match = re.match(r'^([一二三四五六七八九十]+)[、\.]', title)
        if match:
            chinese_num = match.group(1)
            if chinese_num in cls.CHINESE_NUM_MAP:
                return str(cls.CHINESE_NUM_MAP[chinese_num])

        # 备用：尝试从标题任意位置提取数字章节号
        match = re.search(r'(\d+(?:\.\d+)*)', title)
        if match:
            return match.group(1)

        return None

    @classmethod
    def _detect_chapter_number(cls, line: str) -> Optional[str]:
        """
        检测一行文本中的章节号

        Args:
            line: 文本行

        Returns:
            章节号字符串，如果不是章节标题则返回 None
        """
        if not line:
            return None

        line = line.strip()
        if not line:
            return None

        # 尝试各种章节模式
        for pattern in cls.CHAPTER_PATTERNS:
            match = re.match(pattern, line)
            if match:
                groups = match.groups()
                # 获取章节号部分
                for group in groups:
                    if group and re.match(r'^\d+(?:\.\d+)*$', group):
                        return group
                    elif group and group in cls.CHINESE_NUM_MAP:
                        return str(cls.CHINESE_NUM_MAP[group])
                    elif group and re.match(r'^[一二三四五六七八九十]+$', group):
                        if group in cls.CHINESE_NUM_MAP:
                            return str(cls.CHINESE_NUM_MAP[group])

        return None

    @classmethod
    def _get_main_chapter(cls, chapter_num: str) -> str:
        """
        获取主章节号（第一级）

        Args:
            chapter_num: 完整章节号，如 "7.8.1"

        Returns:
            主章节号，如 "7"
        """
        if not chapter_num:
            return ""
        return chapter_num.split('.')[0]

    @classmethod
    def _is_target_or_subchapter(cls, current: str, target: str) -> bool:
        """
        判断当前章节号是否是目标章节或其子章节

        Args:
            current: 当前章节号，如 "7.8.1"
            target: 目标章节号，如 "7.8"

        Returns:
            True 如果是目标章节或子章节
        """
        if not current or not target:
            return False

        # 完全匹配
        if current == target:
            return True

        # 子章节匹配: 7.8.1 是 7.8 的子章节
        if current.startswith(target + '.'):
            return True

        return False

    @classmethod
    def split_content_by_chapters(
        cls,
        content: str,
        level: int = 1
    ) -> List[Tuple[str, str, int]]:
        """
        将内容按章节分割

        Args:
            content: 原始内容
            level: 分割的章节级别，1 表示按一级章节分割

        Returns:
            [(chapter_num, chapter_content, chapter_level), ...]
        """
        if not content:
            return []

        # 预处理：统一换行格式
        normalized = cls._normalize_content(content)
        lines = normalized.split('\n')
        chapters = []
        current_chapter = None
        current_lines = []
        current_level = 0

        for line in lines:
            chapter_num = cls._detect_chapter_number(line)

            if chapter_num:
                # 计算章节级别
                chapter_level = len(chapter_num.split('.'))

                # 如果发现新的章节，保存之前的章节
                if current_chapter is not None:
                    chapters.append((
                        current_chapter,
                        '\n'.join(current_lines),
                        current_level
                    ))

                current_chapter = chapter_num
                current_lines = [line]
                current_level = chapter_level
            else:
                current_lines.append(line)

        # 保存最后一个章节
        if current_chapter is not None:
            chapters.append((
                current_chapter,
                '\n'.join(current_lines),
                current_level
            ))

        return chapters


# 便捷函数
def extract_chapter_content(
    content: str,
    target_chapter_title: str,
    include_subchapters: bool = True
) -> str:
    """
    从内容中提取目标章节的内容（便捷函数）

    Args:
        content: chunk 的原始内容
        target_chapter_title: 目标章节标题
        include_subchapters: 是否包含子章节内容

    Returns:
        提取的章节内容
    """
    return ChapterExtractor.extract_chapter_content(
        content, target_chapter_title, include_subchapters
    )


def split_content_by_chapters(content: str, level: int = 1) -> List[Tuple[str, str, int]]:
    """
    将内容按章节分割（便捷函数）

    Args:
        content: 原始内容
        level: 分割的章节级别

    Returns:
        [(chapter_num, chapter_content, chapter_level), ...]
    """
    return ChapterExtractor.split_content_by_chapters(content, level)
