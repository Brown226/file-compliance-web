import json
import logging
import re
import os

import dashscope
from langchain_core.messages import HumanMessage
from service.utils.prompt_manager import PromptManager

# 引入 LangGraph workflow
from service.workflow.rag_graph import get_llm
from langchain_core.messages import SystemMessage

from dotenv import load_dotenv
load_dotenv()


EXTRACT_PROMPT = """你是一个建筑行业的特征信息提取助手。请从用户输入的项目概要的内容描述中，从建筑项目文档中提取各项特征和对应的样例值，并以JSON格式结构化输出。
"""

PROMPT_TICKET_EXTRACTION = """
请识别文件，并从文件中提取项目信息。
返回数据格式以json方式输出
"""


# Configure logger level from environment, fallback to APP_LOG_LEVEL or INFO
_log_level_name = os.getenv("APP_LOG_LEVEL", "INFO").upper()
_log_level = getattr(logging, _log_level_name, logging.INFO)

logger = logging.getLogger(__name__)
logger.setLevel(_log_level)

class ExtractInfoService:

    def parse_single_page_file(image_url: str):
        try:
            prompt_manager = PromptManager()
            prompt_obj = prompt_manager.get_prompt("project_info_recognize")
            prompt_text = prompt_obj.prompt
        except Exception as e:
            logger.warning(f"Failed to fetch prompt from Langfuse: {e}. Using default.", exc_info=True)
            prompt_text = PROMPT_TICKET_EXTRACTION

        messages = [{
                    'role': 'user',
                    'content': [
                        {'image': image_url,
                        # 输入图像的最小像素阈值，小于该值图像会放大，直到总像素大于min_pixels
                        "min_pixels": 32 * 32 * 3,
                        # 输入图像的最大像素阈值，超过该值图像会缩小，直到总像素低于max_pixels
                        "max_pixels": 32 * 32 * 8192,
                        # 开启图像自动转正功能
                        "enable_rotate": False,
                        },
                        # 未设置内置任务时，支持在text字段中传入Prompt，若未传入则使用默认的Prompt：Please output only the text content from the image without any additional descriptions or formatting.
                        {'text': prompt_text}
                    ]
                }]

        try:
            response = dashscope.MultiModalConversation.call(
                model='qwen-vl-ocr-latest',
                api_key=os.getenv('DASHSCOPE_API_KEY'),
                messages=messages,
                # ocr_options= {"task": "document_parsing"}
            )
            return response.output.choices[0].message.content[0]['text']
        except Exception as e:
            print(f"An error occurred: {e}")
            return None


    def extract_key_factor(self, abstract: str):
        """
        从摘要中提取关键要素 (Updated to use generic LLM directly)
        """
        if not abstract:
             return {"error": "Abstract content is empty"}
             
        # 1. Retrieve context
        logger.info(f"正在从 RAGFlow 检索 (Extract): {abstract[:50]}...")

        # 2. Generate with LLM
        try:
            try:
                prompt_manager = PromptManager()
                prompt_obj = prompt_manager.get_prompt("project_info_extract")
                prompt_with_context = prompt_obj.prompt
            except Exception as e:
                logger.warning(f"Failed to fetch prompt from Langfuse: {e}. Using default.")
                prompt_with_context = f"{EXTRACT_PROMPT}"

            messages = [
                SystemMessage(content=prompt_with_context),
                HumanMessage(content=abstract)
            ]
            
            llm = get_llm(False)
            response = llm.invoke(messages)
            content = response.content
            return self._parse_text_to_json(content)
        except Exception as e:
             logger.error(f"提取失败: {e}", exc_info=True)
             return {"raw_content": "", "error": f"提取失败: {str(e)}"}

    def _parse_text_to_json(self, text: str):
        """
        Helper to parse JSON from LLM response which might contain Markdown blocks
        """
        try:
            # Try to find JSON block
            match = re.search(r"```json\s*(.*?)\s*```", text, re.DOTALL)
            if match:
                json_str = match.group(1)
            else:
                # Try to find just braces
                match = re.search(r"\{.*\}", text, re.DOTALL)
                if match:
                    json_str = match.group(0)
                else:
                    json_str = text
            
            # Clean up potential comments or trailing commas if needed (simple check)
            return json.loads(json_str)
        except Exception as e:
            logger.error(f"JSON Parsing failed: {e}")
            return {"raw_content": text, "error": "Failed to parse JSON"}



