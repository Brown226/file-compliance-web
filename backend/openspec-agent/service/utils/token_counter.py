"""
Token Counter 工具模块

提供精确的 token 计算功能，支持多种模型和智能文本截断。
这个模块提供了与 langfuse_callback.py 中 QwenTokenCounter 兼容的接口。
"""

import os
import re
from typing import List, Optional
from utils.logger import get_logger

logger = get_logger('token_counter')

# 全局 token counter 实例
_token_counter_instance = None


class TokenCounter:
    """
    通用 Token 计数器
    支持多种模型的精确 token 计算
    """
    
    def __init__(self, model_name: str = "qwen-max"):
        self.model_name = model_name
        self.encoding = None
        
        # 尝试导入 tiktoken
        try:
            import tiktoken
            if model_name.startswith('qwen'):
                self.encoding = tiktoken.get_encoding("cl100k_base")
            elif model_name.startswith('gpt-4'):
                if 'gpt-4o' in model_name:
                    self.encoding = tiktoken.get_encoding("o200k_base")
                else:
                    self.encoding = tiktoken.get_encoding("cl100k_base")
            elif model_name.startswith('claude'):
                self.encoding = tiktoken.get_encoding("cl100k_base")
            else:
                self.encoding = tiktoken.get_encoding("cl100k_base")
            logger.info(f"TokenCounter initialized with tiktoken for model: {model_name}")
        except ImportError:
            logger.warning("tiktoken not available, using fallback estimation")
        except Exception as e:
            logger.warning(f"Failed to initialize tiktoken: {e}, using fallback estimation")
    
    def count_tokens(self, text: str) -> int:
        """计算文本的 token 数量"""
        if not text:
            return 0
            
        if self.encoding:
            try:
                return len(self.encoding.encode(text))
            except Exception as e:
                logger.warning(f"tiktoken encoding failed: {e}, using fallback")
        
        # Fallback 到模型专用估算
        if self.model_name.startswith('qwen'):
            return self._estimate_qwen_tokens(text)
        else:
            return self._estimate_general_tokens(text)
    
    def _estimate_qwen_tokens(self, text: str) -> int:
        """Qwen 专用的 token 估算"""
        chinese_chars = len([c for c in text if '\u4e00' <= c <= '\u9fff'])
        english_words = len(re.findall(r'\b[a-zA-Z]+\b', text))
        punctuation = len([c for c in text if c in '.,!?;:"()[]{}'])
        other_chars = len(text) - chinese_chars - len(re.findall(r'[a-zA-Z\s]', text)) - punctuation
        
        # Qwen 专用比例（基于实际测试调优）
        tokens = int(
            chinese_chars * 1.2 +      # 中文字符
            english_words * 1.3 +      # 英文单词
            punctuation * 1.0 +        # 标点符号
            other_chars * 1.5          # 其他字符
        )
        return max(tokens, 1)
    
    def _estimate_general_tokens(self, text: str) -> int:
        """通用的 token 估算"""
        # 检测文本类型
        chinese_chars = len([c for c in text if '\u4e00' <= c <= '\u9fff'])
        total_chars = len(text)
        
        if total_chars == 0:
            return 0
        
        chinese_ratio = chinese_chars / total_chars
        
        if chinese_ratio > 0.8:
            # 主要是中文
            return int(total_chars * 1.8)
        elif chinese_ratio < 0.1:
            # 主要是英文
            return int(len(text.split()) * 1.3)
        else:
            # 中英混合
            return int(total_chars * 1.2)
    
    def get_token_limit(self) -> int:
        """获取模型的 token 限制"""
        model_limits = {
            'qwen-max': 32000,
            'qwen-plus': 32000,
            'qwen-turbo': 32000,
            'gpt-4': 8192,
            'gpt-4-turbo': 128000,
            'gpt-4o': 128000,
            'claude-3-opus': 200000,
            'claude-3-sonnet': 200000,
            'claude-3-haiku': 200000,
        }
        
        for model_key, limit in model_limits.items():
            if self.model_name.startswith(model_key):
                return limit
        
        # 默认限制
        return 32000
    
    def truncate_text(self, text: str, max_tokens: int, preserve_end: bool = True) -> str:
        """
        基于 token 数截断文本
        
        Args:
            text: 要截断的文本
            max_tokens: 最大 token 数
            preserve_end: 是否保留文本末尾（True）还是开头（False）
        
        Returns:
            截断后的文本
        """
        if not text:
            return text
        
        current_tokens = self.count_tokens(text)
        if current_tokens <= max_tokens:
            return text
        
        # 估算需要保留的字符比例
        char_ratio = max_tokens / current_tokens
        target_chars = int(len(text) * char_ratio)
        
        if preserve_end:
            # 保留末尾
            truncated = text[-target_chars:]
        else:
            # 保留开头
            truncated = text[:target_chars]
        
        # 微调：确保不超过 token 限制
        while self.count_tokens(truncated) > max_tokens and len(truncated) > 0:
            if preserve_end:
                truncated = truncated[10:]  # 从开头删除
            else:
                truncated = truncated[:-10]  # 从末尾删除
        
        return truncated


def get_token_counter() -> TokenCounter:
    """获取全局 token counter 实例"""
    global _token_counter_instance
    
    if _token_counter_instance is None:
        model_name = os.getenv('MODEL_NAME', 'qwen-max')
        _token_counter_instance = TokenCounter(model_name)
    
    return _token_counter_instance


def count_tokens(text: str) -> int:
    """计算文本的 token 数量（便捷函数）"""
    return get_token_counter().count_tokens(text)


def truncate_text(text: str, max_tokens: int, preserve_end: bool = True) -> str:
    """基于 token 数截断文本（便捷函数）"""
    return get_token_counter().truncate_text(text, max_tokens, preserve_end)


def calculate_available_tokens(question: str, template: str, project_info: str, 
                             prompt_overhead: int = 1000, response_reserve: int = 2000) -> int:
    """
    计算可用于 context 的 token 数量
    
    Args:
        question: 用户问题
        template: 文档模板
        project_info: 项目信息
        prompt_overhead: prompt 模板开销
        response_reserve: 响应预留空间
    
    Returns:
        可用的 token 数量
    """
    counter = get_token_counter()
    
    # 计算各部分的 token 数
    question_tokens = counter.count_tokens(question)
    template_tokens = counter.count_tokens(template)
    project_info_tokens = counter.count_tokens(project_info)
    
    # 计算总的固定开销
    fixed_tokens = (
        question_tokens + 
        template_tokens + 
        project_info_tokens + 
        prompt_overhead + 
        response_reserve
    )
    
    # 计算可用空间
    total_limit = counter.get_token_limit()
    available = total_limit - fixed_tokens
    
    # 确保至少有最小可用空间
    return max(available, 500)