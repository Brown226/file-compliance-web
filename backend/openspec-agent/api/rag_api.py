import os
import sys

# Add parent directory to path to allow importing 'service'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import APIRouter, Request, Response
from fastapi.responses import StreamingResponse
import json
from service.rag.rag_service_ragflow import RagflowService
from service.memory.memory_service import save_memory
from pydantic import BaseModel
from typing import Optional, Union
import logging

# Configure basic logging
# Allow overriding log level via environment variable (default INFO)
log_level_name = os.getenv('APP_LOG_LEVEL', 'INFO').upper()
log_level = getattr(logging, log_level_name, logging.INFO)
logging.basicConfig(level=log_level, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Define request model
class AiAdRequest(BaseModel):
    prompt: Optional[str] = None
    name: str = None
    abstract: str = None
    outline: str = None
    subTitle: str = None

class AiDocRequestSingle(BaseModel):
    prompt: str
    name:str = None
    chapterName: str = None
    structure: str = None
    feature: str = None
    requirement: str = None
    usePromptParams: bool = False
    stream: bool = True


rag_router = APIRouter(prefix="/agent")

logger.debug(f"RAG API module loaded: {__name__}")

@rag_router.post('/generate_paragraph_stream')
async def ragflow_generate_with_assistant(request: AiDocRequestSingle, http_request: Request):
    """
    流式生成段落内容
    """
    # logger.info(f"[ragflow_generate_paragraph] 请求收到: prompt={request.prompt}, name={request.name}")
    try:
        if not request.prompt:
            logger.error("ragflow_generate_paragraph_stream: Prompt is required but was not provided.")
            return {"code": 400, "message": "prompt is required"}

        if not request.name:
            logger.error("ragflow_generate_paragraph_stream: name is required but was not provided.")
            return {"code": 400, "message": "name is required"}

        # 记忆写入：保存补充要求
        user_id = getattr(http_request.state, "user_id", None)
        req_text = (request.requirement or "").strip()
        if user_id and req_text:
            try:
                save_memory(
                    user_id=str(user_id),
                    content=req_text,
                    chapter_name=request.chapterName,
                    source_type="requirement",
                )
            except Exception as e:
                logger.warning(f"Memory save failed (non-fatal): {e}")

        ragflow_service = RagflowService()
        
        async def generate_paragraph_response(request):
            try:
                async for chunk in ragflow_service.paragraph_generate_stream(request):
                    # logger.info(f"[ragflow_generate_paragraph] 响应流数据: {chunk}")
                    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
            except Exception as e:
                logger.error(f"Error during paragraph generation stream: {e}", exc_info=True)
                error_msg = json.dumps({'success': False, 'error': str(e)}, ensure_ascii=False)
                yield f"data: {error_msg}\n\n"

        response = StreamingResponse(
            generate_paragraph_response(request),
            media_type='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
                'Content-Type': 'text/event-stream',
                'Access-Control-Allow-Origin': '*', 
                'Access-Control-Allow-Credentials': 'true'
            }
        )
        logger.info("[ragflow_generate_paragraph] StreamingResponse 已返回")
        return response
    except Exception as e:
        logger.error(f"Unhandled error in ragflow_generate_paragraph endpoint: {e}", exc_info=True)
        raise Exception(str(e))


@rag_router.post('/generate_paragraph')
async def ragflow_generate(request: AiDocRequestSingle):
    try:
        ragflow_service = RagflowService()
        result = await ragflow_service.paragraph_generate(request)
        return {"code": 200, "message": "生成成功", "data": result}
    except Exception as e:
        logger.error(f"Unhandled error in ragflow_generate_paragraph_noStream endpoint: {e}", exc_info=True)
        raise Exception(str(e))


