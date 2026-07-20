"""
统一的日志配置模块
用于 ArchSpec Agent 服务的日志管理
"""
import os
import sys
import logging
from logging.handlers import RotatingFileHandler


def setup_logger(name: str = None, level: str = None) -> logging.Logger:
    """
    配置并返回一个 logger 实例

    Args:
        name: logger 名称，默认为 'archspec-agent'
        level: 日志级别，默认从环境变量 APP_LOG_LEVEL 读取，若无则为 INFO

    Returns:
        logging.Logger: 配置好的 logger 实例
    """
    if name is None:
        name = 'archspec-agent'

    # 获取日志级别
    if level is None:
        level = os.getenv('APP_LOG_LEVEL', 'INFO').upper()

    log_level = getattr(logging, level, logging.INFO)

    # 创建 logger
    logger = logging.getLogger(name)
    logger.setLevel(log_level)

    # 避免重复添加 handler
    if logger.handlers:
        return logger

    # 创建控制台 handler (输出到 stdout，供 Docker 捕获)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(log_level)

    # 创建格式化器
    formatter = logging.Formatter(
        fmt='%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    console_handler.setFormatter(formatter)

    # 添加 handler 到 logger
    logger.addHandler(console_handler)

    # 防止日志向上传播到根 logger（避免重复输出）
    logger.propagate = False

    return logger


def get_logger(name: str = None) -> logging.Logger:
    """
    获取 logger 实例（简化版）

    Args:
        name: logger 名称

    Returns:
        logging.Logger: logger 实例
    """
    if name is None:
        name = 'archspec-agent'

    logger = logging.getLogger(name)

    # 如果 logger 还没有配置，则进行配置
    if not logger.handlers:
        return setup_logger(name)

    return logger
