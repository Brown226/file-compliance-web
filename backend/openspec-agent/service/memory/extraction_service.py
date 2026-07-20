"""
LLM 结构化提取服务
从记忆内容中提取 category 分类
"""
import os
import logging

import dashscope
from dashscope import Generation
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

# 有效的分类枚举
VALID_CATEGORIES = {
    "material_preference",  # 材料偏好
    "design_parameter",     # 设计参数
    "standard_reference",   # 规范引用
    "style_preference",     # 风格偏好
    "other",                # 其他
}

CATEGORY_PROMPT = """你是一个建筑设计记忆分类器。根据以下内容，判断它属于哪个类别，只输出类别名称，不要输出其他内容。

类别选项：
- material_preference（材料偏好：涉及材料选择、品牌、型号等）
- design_parameter（设计参数：涉及尺寸、数值、技术参数等）
- standard_reference（规范引用：涉及国标、行标、规范条文等）
- style_preference（风格偏好：涉及设计风格、审美偏好等）
- other（不属于以上类别）

内容：{content}

类别："""


def extract_memory_category(content: str) -> str:
    """
    调用千问 LLM 从记忆内容中提取分类。
    失败时返回 'other'。
    """
    if not content or not content.strip():
        return "other"

    try:
        response = Generation.call(
            model=os.getenv("EXTRACTION_MODEL", "qwen-turbo"),
            prompt=CATEGORY_PROMPT.format(content=content.strip()[:500]),
            api_key=os.getenv("DASHSCOPE_API_KEY"),
            result_format="text",
        )
        if response.status_code == 200:
            result = response.output.get("text", "").strip().lower()
            # 清理可能的多余字符
            for cat in VALID_CATEGORIES:
                if cat in result:
                    return cat
            logger.warning(f"LLM returned unknown category: {result}")
            return "other"
        else:
            logger.warning(f"Category extraction API error: {response.code} - {response.message}")
            return "other"
    except Exception as e:
        logger.warning(f"Category extraction failed: {e}")
        return "other"
