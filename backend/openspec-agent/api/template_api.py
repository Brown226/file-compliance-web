"""
模板智能匹配 API

提供基于 RAGFlow Metadata 的模板章节检索和匹配功能
"""
import os
import sys

# Add parent directory to path to allow importing 'service'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List
import logging

from service.tools.template_matcher import TemplateMatcherService

# Configure basic logging
logger = logging.getLogger(__name__)

template_router = APIRouter(prefix="/agent/template")


class TemplateSearchRequest(BaseModel):
    """模板章节检索请求体"""
    userId: str
    chapterTitle: str
    tagIds: Optional[List[int]] = None  # 兼容旧接口，逐步废弃
    professionTagId: Optional[int] = None
    businessTypeTagId: Optional[int] = None
    threshold: Optional[float] = 0.5
    limit: Optional[int] = 5


@template_router.post('/search')
async def search_template_chapter(request: TemplateSearchRequest):
    """
    搜索匹配的模板章节

    基于用户ID、章节标题和可选标签，在 personal-template 知识库中
    使用 RAGFlow 的 metadata_condition 进行权限过滤和向量检索。

    返回最佳匹配结果和备选项。
    """
    try:
        logger.info(f"========== 模板检索请求开始 ==========")
        logger.info(f"请求参数: userId={request.userId}, chapterTitle={request.chapterTitle}, "
                   f"professionTagId={request.professionTagId}, businessTypeTagId={request.businessTypeTagId}, "
                   f"threshold={request.threshold}, limit={request.limit}")

        matcher = TemplateMatcherService()
        result = matcher.search(
            user_id=request.userId,
            chapter_title=request.chapterTitle,
            profession_tag_id=request.professionTagId,
            business_type_tag_id=request.businessTypeTagId,
            threshold=request.threshold,
            limit=request.limit
        )

        logger.info(f"检索结果: matched={result.get('matched') is not None}, "
                   f"alternatives_count={len(result.get('alternatives', []))}")

        if result.get('matched'):
            logger.info(
                f"匹配成功: templateId={result['matched']['templateId']}, "
                f"templateName={result['matched'].get('templateName', 'N/A')}, "
                f"similarity={result['matched']['similarity']}"
            )
        else:
            logger.warning("⚠️ 未找到匹配的模板章节")
            logger.info("可能原因: 1. RAGFlow知识库无数据 2. 相似度低于阈值 3. 权限过滤导致无结果")

        logger.info(f"========== 模板检索请求结束 ==========")
        return {"code": 200, "message": "success", "data": result}

    except Exception as e:
        logger.error(f"模板检索失败: {e}", exc_info=True)
        return {"code": 500, "message": f"Internal Error: {str(e)}", "data": None}


@template_router.get('/{template_id}/chapter')
async def get_template_chapter(template_id: int, chapterTitle: str):
    """
    获取模板指定章节内容

    根据模板ID和章节标题，检索对应的章节内容。
    这个接口用于用户手动选择模板后，获取特定章节的内容。

    注意：暂未实现，待后续根据需求开发
    """
    try:
        logger.info(f"获取模板章节: templateId={template_id}, chapterTitle={chapterTitle}")

        # TODO: 实现根据 templateId 和 chapterTitle 获取章节内容
        # 方案1: 直接查询数据库的 content 字段，按分隔符分割后匹配章节
        # 方案2: 使用 RAGFlow 检索，添加 templateId 过滤条件

        return {
            "code": 501,
            "message": "Not Implemented: 该接口尚未实现，请使用模板自动匹配功能",
            "data": None
        }

    except Exception as e:
        logger.error(f"获取模板章节失败: {e}", exc_info=True)
        return {"code": 500, "message": f"Internal Error: {str(e)}", "data": None}