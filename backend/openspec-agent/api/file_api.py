import os
import sys

# Add parent directory to path to allow importing 'service'
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from service.tools.RagflowParser import RagflowParser, extract_from_chunks
from pydantic import BaseModel
from typing import Optional
import logging
import asyncio
import requests

# Configure basic logging
logger = logging.getLogger(__name__)

file_router = APIRouter(prefix="/agent/file")

class FileProcessRequest(BaseModel):
    fileId: Optional[str] = None
    fileIds: Optional[list[str]] = None  # 支持批量删除
    input_query: Optional[str] = None
    datasetName: Optional[str] = "test_ygy"

class SetMetaFieldsRequest(BaseModel):
    """设置文档元数据的请求体"""
    fileId: str
    datasetName: Optional[str] = "personal-template"
    userId: str
    isStandard: Optional[str] = "false"
    templateId: Optional[str] = None
    templateName: Optional[str] = None
    tags: Optional[str] = None  # 逗号分隔的标签ID列表（兼容旧数据，逐步废弃）
    profession: Optional[str] = None       # 专业标签 ID（单选）
    business_type: Optional[str] = None    # 业态标签 ID（单选）
    fileType: Optional[str] = None

# 全局实例化 RagflowParser (单例)
parser = RagflowParser()

@file_router.post('/upload')
async def upload_file(file: UploadFile = File(...), datasetName: Optional[str] = Form("test_ygy")):
    try:
        content = await file.read()
        dataset_name = datasetName or "test_ygy"
        # upload_blob_via_api 是同步阻塞调用，使用 asyncio.to_thread 避免阻塞事件循环
        api_result = await asyncio.to_thread(parser.upload_blob_via_api, dataset_name, file.filename, content)
        
        if not api_result or not api_result.get("id"):
            return {"code": 500, "message": "上传失败，未获取到文档ID", "data": None}
            
        return {"code": 200, "message": "上传成功", "data": api_result}
    except Exception as e:
        logger.error(f"Error in upload_file: {e}", exc_info=True)
        return {"code": 500, "message": f"Internal Error: {str(e)}", "data": None}

@file_router.post('/delete')
def delete_file(request: FileProcessRequest):
    """
    删除 RAGFlow 知识库中的文档
    支持单个删除（fileId）和批量删除（fileIds）
    """
    # 收集要删除的文档ID列表
    doc_ids = []
    if request.fileIds:
        # 批量删除
        doc_ids = request.fileIds
    elif request.fileId:
        # 单个删除
        doc_ids = [request.fileId]
    else:
        return {"code": 400, "message": "fileId or fileIds is required", "data": None}

    try:
        dataset_name = request.datasetName or "personal-template"

        # 调用批量删除方法
        success = parser.delete_documents(dataset_name, doc_ids)

        if success:
            return {"code": 200, "message": f"删除成功，共删除 {len(doc_ids)} 个文档", "data": {"count": len(doc_ids)}}
        else:
            return {"code": 500, "message": "RAGFlow 文档删除失败", "data": None}
    except Exception as e:
        logger.error(f"Error in delete_file: {e}", exc_info=True)
        return {"code": 500, "message": f"Internal Error: {str(e)}", "data": None}

@file_router.post('/parse')
def parse_file(request: FileProcessRequest):
    try:
        dataset_name = request.datasetName or "test_ygy"
        result = parser.parse_document_by_id(dataset_name, request.fileId)
        
        if not result:
            return {"code": 500, "message": "文档解析失败", "data": None}
            
        return {"code": 200, "message": "解析成功", "data": result}
    except Exception as e:
        logger.error(f"Error in parse_file: {e}", exc_info=True)
        return {"code": 500, "message": f"Internal Error: {str(e)}", "data": None}

@file_router.post('/get_chunks')
def get_file_chunks(request: FileProcessRequest):
    if not request.fileId:
        return {"code": 500, "message": "fileId is required", "data": None}
    try:
        dataset_name = request.datasetName or "test_ygy"
        chunks = parser.get_file_chunks(dataset_name, request.fileId)
        
        if not chunks:
            return {"code": 500, "message": "文档解析失败，未获取到有效内容", "data": None}
            
        return {"code": 200, "message": "解析成功", "data": chunks}
    except Exception as e:
        logger.error(f"Error in get_file_chunks: {e}", exc_info=True)
        return {"code": 500, "message": f"Internal Error: {str(e)}", "data": None}

@file_router.post('/extract_chapters')
def extract_chapters(request: FileProcessRequest):
    """
    从文档chunks中提取章节目录结构
    使用大模型能力分析文档内容，生成准确的章节目录
    """
    if not request.fileId:
        return {"code": 500, "message": "fileId is required", "data": None}
    try:
        dataset_name = request.datasetName
        chunks = parser.get_file_chunks(dataset_name, request.fileId)
        
        if not chunks:
            return {"code": 500, "message": "文档解析失败，未获取到有效内容", "data": None}
        
       # 使用大模型提取章节目录
        # 构造专门用于提取章节目录的query
        chapter_query = """
请分析文档内容，提取完整的章节目录结构。

**重要要求**：
1. **必须保留章节编号**：如"一、"、"二、"、"1."、"2."、"1.1"、"1.2"等数字编号必须完整保留在标题中
2. 识别文档中的所有章节标题，包括：
   - 中文数字：一、二、三、四、五...
   - 阿拉伯数字：1、2、3、1.1、1.2、2.1...
   - 其他格式的标题
3. 保持章节的层级关系：
   - level=1：一级标题（如：一、1、第一章）
   - level=2：二级标题（如：1.1、（一）、1）
   - level=3：三级标题（如：1.1.1、（1））
4. title字段必须包含完整的标题内容，包括编号和文字

**返回JSON格式示例**：
```json
{
  "chapters": [
    {"id": "chapter-1", "title": "一、项目概述", "level": 1},
    {"id": "chapter-1-1", "title": "1.1 项目背景", "level": 2},
    {"id": "chapter-1-2", "title": "1.2 项目目标", "level": 2},
    {"id": "chapter-2", "title": "二、技术方案", "level": 1},
    {"id": "chapter-2-1", "title": "2.1 技术架构", "level": 2}
  ]
}
```

**注意**：title必须是完整标题，不能省略任何编号！
"""
        
        extracted = extract_from_chunks(chunks, chapter_query)
        
        data = {
            "fileId": request.fileId,
            "chunks": chunks,
            "chapters": extracted.get("chapters", []) if isinstance(extracted, dict) else []
        }
        return {"code": 200, "message": "提取成功", "data": data}
    except Exception as e:
        logger.error(f"Error in extract_chapters: {e}", exc_info=True)
        return {"code": 500, "message": f"Internal Error: {str(e)}", "data": None}

@file_router.post('/extract_key')
def extract_key(request: FileProcessRequest):
    if not request.fileId and not request.input_query:
        return {"code": 500, "message": "fileId or input_query is required", "data": None}
    try:
        chunks = []
        if request.fileId:
            dataset_name = request.datasetName or "test_ygy"
            chunks = parser.get_file_chunks(dataset_name, request.fileId)

        # 即使 chunks 为空也可能是正常的（空文档），但通常意味着有问题或未解析
        # 这里直接进行提取，extract_from_chunks 应该处理空列表
        prompt_key = "project_info_extract"
        extracted = extract_from_chunks(chunks, request.input_query, prompt_key)
        
        data = {
            "fileId": request.fileId,
            "extracted": extracted
        }
        return {"code": 200, "message": "提取成功", "data": data}
    except Exception as e:
        logger.error(f"Error in extract_key: {e}", exc_info=True)
        return {"code": 500, "message": f"Internal Error: {str(e)}", "data": None}

@file_router.post('/set_meta_fields')
def set_meta_fields(request: SetMetaFieldsRequest):
    """
    设置文档的元数据（meta_fields）
    用于上传模板文档后，添加用户信息、模板信息等元数据，用于后续的权限控制和智能检索
    """
    try:
        # 构建 meta_fields 字典
        from datetime import datetime

        meta_fields = {
            "userId": request.userId,
            "isStandard": request.isStandard or "false"
        }

        # 添加可选字段
        if request.templateId:
            meta_fields["templateId"] = request.templateId
        if request.templateName:
            meta_fields["templateName"] = request.templateName
        if request.tags:
            meta_fields["tags"] = request.tags
        if request.profession is not None:
            meta_fields["profession"] = request.profession
        if request.business_type is not None:
            meta_fields["business_type"] = request.business_type
        if request.fileType:
            meta_fields["fileType"] = request.fileType

        # 添加上传时间
        meta_fields["uploadTime"] = datetime.now().isoformat()

        logger.info(f"Setting meta_fields for document {request.fileId}: {meta_fields}")

        # 调用 RagflowParser 设置元数据
        dataset_name = request.datasetName or "personal-template"
        success = parser.set_document_meta_fields(
            dataset_name=dataset_name,
            doc_id=request.fileId,
            meta_fields=meta_fields
        )

        if success:
            return {"code": 200, "message": "元数据设置成功", "data": meta_fields}
        else:
            return {"code": 500, "message": "元数据设置失败", "data": None}

    except Exception as e:
        logger.error(f"Error in set_meta_fields: {e}", exc_info=True)
        return {"code": 500, "message": f"Internal Error: {str(e)}", "data": None}

@file_router.get('/download/{file_id}')
def download_file(file_id: str):
    """
    下载文件接口
    通过 Ragflow API 下载文件
    """
    try:
        # 从环境变量获取 Ragflow 配置
        ragflow_base_url = os.getenv("RAGFLOW_BASE_URL", "")
        ragflow_api_key = os.getenv("RAGFLOW_API_KEY")

        if not ragflow_api_key:
            logger.error("RAGFLOW_API_KEY not configured")
            return {"code": 500, "message": "RAGFLOW_API_KEY 未配置", "data": None}

        # 构造 Ragflow 下载接口 URL
        download_url = f"{ragflow_base_url}/api/v1/documents/{file_id}/file"

        headers = {
            "Authorization": f"Bearer {ragflow_api_key}"
        }

        logger.info(f"Downloading file from Ragflow: {download_url}")

        # 调用 Ragflow API 下载文件
        response = requests.get(download_url, headers=headers, stream=True)

        if response.status_code != 200:
            logger.error(f"Failed to download file from Ragflow: {response.status_code} {response.text}")
            return {"code": response.status_code, "message": f"下载失败: {response.text}", "data": None}

        # 获取文件名
        filename = file_id
        content_disposition = response.headers.get('Content-Disposition')
        if content_disposition:
            import re
            match = re.findall(r'filename="?([^"]+)"?', content_disposition)
            if match:
                filename = match[0]

        # 获取文件类型
        content_type = response.headers.get('Content-Type', 'application/octet-stream')

        # 返回流式响应
        return StreamingResponse(
            response.iter_content(chunk_size=8192),
            media_type=content_type,
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"'
            }
        )

    except Exception as e:
        logger.error(f"Error in download_file: {e}", exc_info=True)
        return {"code": 500, "message": f"Internal Error: {str(e)}", "data": None}
