"""
记忆管理 API
提供记忆的查询、删除接口
"""
import logging
from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import Optional

from service.memory.memory_service import list_memories, delete_memory, recall_memories

logger = logging.getLogger(__name__)

memory_router = APIRouter(prefix="/agent/memory")


class RecallRequest(BaseModel):
    """记忆召回请求"""
    query: str
    limit: Optional[int] = 5


@memory_router.get("/list")
async def get_memory_list(request: Request, limit: int = 50, offset: int = 0):
    """获取当前用户的记忆列表"""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        return {"code": 401, "message": "未登录"}

    memories = list_memories(user_id, limit=limit, offset=offset)
    return {"code": 200, "data": memories}


@memory_router.post("/recall")
async def recall_memory(request: Request, body: RecallRequest):
    """根据查询文本召回相关记忆"""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        return {"code": 401, "message": "未登录"}

    memories = recall_memories(user_id, body.query, limit=body.limit)
    return {"code": 200, "data": memories}


@memory_router.delete("/{memory_id}")
async def delete_memory_item(memory_id: int, request: Request):
    """删除一条记忆"""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        return {"code": 401, "message": "未登录"}

    success = delete_memory(memory_id, user_id)
    if success:
        return {"code": 200, "message": "删除成功"}
    else:
        return {"code": 404, "message": "记忆不存在或无权删除"}
