import logging
from ragflow_sdk import RAGFlow
import os
import requests
import dashscope
from service.utils.prompt_manager import PromptManager
from http import HTTPStatus
from dotenv import load_dotenv

load_dotenv()

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 配置信息
RAGFLOW_BASE_URL = os.getenv("RAGFLOW_BASE_URL", "")
RAGFLOW_API_KEY = os.getenv("RAGFLOW_API_KEY")

class RagflowParser:
    _instance = None
    _lock = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            import threading
            if not cls._lock:
                cls._lock = threading.Lock()
            with cls._lock:
                if not cls._instance:
                    cls._instance = super(RagflowParser, cls).__new__(cls)
        return cls._instance

    def __init__(self):
        if not hasattr(self, 'rag_object'):
            self.rag_object = self.ragflow_init()
            self.datasets = {} # Cache for datasets: {name: dataset_obj}

    def ragflow_init(self):
        rag_object = RAGFlow(
            base_url=RAGFLOW_BASE_URL,
            api_key=RAGFLOW_API_KEY
        )
        return rag_object

    def get_dataset(self, dataset_name: str):
        if dataset_name not in self.datasets:
            datasets = self.rag_object.list_datasets(name=dataset_name)
            if datasets:
                dataset = datasets[0]
            else:
                dataset = self.rag_object.create_dataset(name=dataset_name, embedding_model='text-embedding-v4@Tongyi-Qianwen')
            self.datasets[dataset_name] = dataset
        return self.datasets[dataset_name]

    def create_dataset(self, dataset_name: str):
        # 兼容旧代码或直接复用 get_dataset
        return self.get_dataset(dataset_name)

    def upload_blob(self, dataset_name: str, display_name: str, blob: bytes):
        dataset = self.get_dataset(dataset_name)
        try:
            params = {
                "display_name": display_name,
                "blob": blob
            }
            dataset.upload_documents([params])
        except Exception as e:
            logger.error(f"上传 Blob {display_name} 失败: {e}")
            return False
        return True

    def upload_file(self, dataset_name: str, file_path: str):
        dataset = self.get_dataset(dataset_name)
        display_name = os.path.basename(file_path)
        try:
            with open(file_path, "rb") as f:
                blob = f.read()

            params = {
                "display_name": display_name,
                "blob": blob
            }
            dataset.upload_documents([params])
        except FileNotFoundError:
            logger.error(f"文件不存在 {file_path}")
            return False
        except PermissionError:
            logger.error(f"无权限读取文件 {file_path}")
            return False
        except Exception as e:
            logger.error(f"上传文件 {file_path} 失败: {e}")
            return False
        return True


    def delete_document(self, dataset_name: str, document_id: str):
        """
        删除 RAGFlow 知识库中的单个文档

        Args:
            dataset_name: 知识库名称
            document_id: 文档ID

        Returns:
            bool: 是否删除成功
        """
        return self.delete_documents(dataset_name, [document_id])

    def delete_documents(self, dataset_name: str, document_ids: list[str]):
        """
        批量删除 RAGFlow 知识库中的文档

        Args:
            dataset_name: 知识库名称
            document_ids: 文档ID列表

        Returns:
            bool: 是否删除成功
        """
        try:
            if not document_ids:
                logger.warning("文档ID列表为空，无需删除")
                return True

            dataset = self.get_dataset(dataset_name)
            if not dataset:
                logger.error(f"未找到知识库: {dataset_name}")
                return False

            # 调用 RAGFlow SDK 的 delete_documents 方法，支持批量删除
            dataset.delete_documents(ids=document_ids)
            logger.info(f"成功删除 {len(document_ids)} 个文档从知识库 {dataset_name}: {document_ids}")
            return True
        except Exception as e:
            logger.error(f"批量删除文档失败: {e}")
            return False

    def upload_blob_via_api(self, dataset_name: str, display_name: str, blob: bytes):
        result = {}
        dataset = self.get_dataset(dataset_name)
        """
        通过 HTTP API 上传二进制文件内容，并返回包含文档 ID 的结果
        适用于前端直接上传文件流的场景
        """
        try:
            if not dataset or not hasattr(dataset, 'id'):
                return {"success": False, "message": "Dataset 未初始化或无 ID"}

            # 1. 先查找并删除同名文件，避免重复
            try:
                existing_docs = dataset.list_documents(name=display_name)
                if existing_docs:
                    doc_ids = [doc.id for doc in existing_docs]
                    logger.info(f"发现同名文件 {display_name}，共 {len(doc_ids)} 个，准备删除: {doc_ids}")
                    dataset.delete_documents(ids=doc_ids)
                    logger.info(f"已删除同名文件: {doc_ids}")
            except Exception as e:
                logger.warning(f"删除同名文件失败（将继续上传）: {e}")

            url = f"{RAGFLOW_BASE_URL}/api/v1/datasets/{dataset.id}/documents"
            headers = {
                "Authorization": f"Bearer {RAGFLOW_API_KEY}"
            }

            # 构造 files 参数：{'file': ('filename', bytes)}
            files = {
                "file": (display_name, blob)
            }

            response = requests.post(url, headers=headers, files=files)
            # 接口说明 https://ragflow.com.cn/docs/http_api_reference#upload-documents
            if response.status_code == 200:
                result = response.json()
                if result.get("code") == 0:
                    data = result.get("data", [])
                    if data:
                        doc_info = data[0]
                        # 提取关键字段返回，避免暴露过多内部细节
                        result = {
                                "id": doc_info.get("id"),
                                "name": doc_info.get("name"),
                                "size": doc_info.get("size"),
                                "status": doc_info.get("run"),  # UNSTART/RUNNING/DONE/FAILED
                                "dataset_id": doc_info.get("dataset_id")
                            }

                else:
                    logger.error(f"API 错误: {result.get('message')}")
                    return None
            else:
                logger.error(f"HTTP 错误: {response.status_code} {response.text}")
                return None

        except Exception as e:
            logger.error(f"API 上传 Blob {display_name} 失败: {e}")
            return None

        return result

    def parse_document_by_id(self, dataset_name: str, doc_id: str, doc_name: str = None):
        dataset = self.get_dataset(dataset_name)
        documents = dataset.list_documents(id=doc_id)
        if not documents:
            # TODO 找不到文档，返回异常
            return None
        """
        解析指定 ID 的文档。
        """
        try:
            dataset.async_parse_documents([doc_id])
            print(f"Document {doc_id} parsing started asynchronously.")

            import time
            while True:
                time.sleep(2)
                # 重新获取文档状态
                # 注意：这里可能需要重新 list_documents 来获取最新状态
                # SDK 中的对象可能是静态的，需要刷新
                documents = dataset.list_documents(id=doc_id)
                if not documents:
                    print(f"Document {doc_id} lost during polling.")
                    return None
                    
                target_doc = documents[0]
                
                current_status = getattr(target_doc, 'run_status', None)
                if current_status is None:
                     current_status = getattr(target_doc, 'run', '0')

                print(f"Document {doc_id} status: {current_status}, chunks: {target_doc.chunk_count}, tokens: {target_doc.token_count}")
                status = str(current_status)

                if status in ('FAILED', 'FAIL'):
                    print(f"Document {doc_id} parsing failed.")
                    return {"id": doc_id, "status": status, "chunk_count": target_doc.chunk_count, "token_count": target_doc.token_count}
                elif status == 'DONE':
                    print(f"Document {doc_id} parsed successfully.")
                    return {"id": doc_id, "status": status, "chunk_count": target_doc.chunk_count, "token_count": target_doc.token_count}
                
                # Continue polling if not DONE and not FAILED

        except KeyboardInterrupt:
            print("\nParsing interrupted by user.")
        except Exception as e:
            print(f"Parsing failed: {e}")
            import traceback
            traceback.print_exc()
        
        return None

    def parse_documents_by_name(self, dataset_name: str, fileName: str):
        """
        根据文件名解析所有匹配的文档（原 parse_single_file 逻辑）
        """
        dataset = self.get_dataset(dataset_name)
        documents = dataset.list_documents(name=fileName, page=1, page_size=10)
        if not documents:
            return []
        ids = [doc.id for doc in documents]
        try:
            dataset.async_parse_documents(ids)
            print(f"Documents {ids} parsing started asynchronously.")

            import time
            while True:
                time.sleep(2)
                documents = dataset.list_documents(name=fileName, page=1, page_size=10)
                all_finished = True
                for doc in documents:
                    if doc.id in ids:
                        current_status = getattr(doc, 'run_status', None)
                        if current_status is None:
                             current_status = getattr(doc, 'run', '0')

                        print(f"Document {doc.id} status: {current_status}, chunks: {doc.chunk_count}, tokens: {doc.token_count}")
                        status = str(current_status)
                        if status == 'FAILED':
                            print(f"Document {doc.id} parsing failed.")
                            return [{"id": d.id, "status": status, "chunk_count": d.chunk_count, "token_count": d.token_count} for d in documents if d.id in ids]
                        elif status != 'DONE':
                            all_finished = False

                if all_finished:
                    print("All documents parsed successfully.")
                    break

        except KeyboardInterrupt:
            print("\nParsing interrupted by user. All pending tasks have been cancelled.")
        except Exception as e:
            print(f"Parsing failed: {e}")
        return [{"id": d.id, "status": status, "chunk_count": d.chunk_count, "token_count": d.token_count} for d in documents if d.id in ids]

    def parse_single_file(self, dataset_name: str, fileName: str):
        # 保持兼容性，但建议使用更明确的方法
        return self.parse_documents_by_name(dataset_name, fileName)

    def get_file_chunks(self, dataset_name: str, doc_id: str, chunk_size: int = -1, current_page: int=1):
        """
        获取文档的分块内容(分批次)

        Args:
            dataset_name: 知识库名称
            doc_id: 文档ID
            chunk_size: 每个批次返回的chunk总数，默认-1,表示返回所有chunk
            current_page: 当前页码，默认1
        
        Returns:
            list: 分块内容列表，每个元素为一个分块的字典
        """
        dataset = self.get_dataset(dataset_name)
        documents = dataset.list_documents(id=doc_id)
        if not documents:
            return []
        doc = documents[0]
        print('*'*30)
        # print("document info:")
        # print(doc)
        print(f"Document {doc_id} chunks: {doc.chunk_count}, tokens: {doc.token_count}")
        
        chunks = []
        chunk_list = []
        chunk_page_size = 0
       
        if(chunk_size<0):
             # 结合chunk_size和page, 分页获取chunk
            chunk_page_size = doc.chunk_count
            page_index = 1
        else:
            chunk_page_size = chunk_size
            page_index = current_page

        if chunk_page_size==0:
            return []
        
        chunk_list = doc.list_chunks(page=page_index, page_size=chunk_page_size)
        for ch in chunk_list:
            chunks.append({
                "id": ch.id,
                "content": ch.content,
                "important_keywords": ch.important_keywords,
                "questions": ch.questions,
                "create_time": ch.create_time,
                "create_timestamp": ch.create_timestamp,
                "dataset_id": ch.dataset_id,
                "document_name": ch.document_name,
                "document_id": ch.document_id,
                "available": ch.available
            })
        return chunks

    def set_document_meta_fields(self, dataset_name: str, doc_id: str, meta_fields: dict):
        """
        设置文档的 meta_fields 元数据

        参考 RAGFlow SDK: Document.update(update_message:dict)
        update_message 包含 "meta_fields": dict[str, Any]

        Args:
            dataset_name: 知识库名称
            doc_id: 文档ID
            meta_fields: 元数据字典，例如:
                {
                    "userId": "user-uuid",
                    "isStandard": "false",
                    "templateId": "123",
                    "templateName": "模板名称",
                    "tags": "1,2,3",
                    "uploadTime": "2026-01-27T10:00:00Z"
                }

        Returns:
            bool: 是否设置成功
        """
        try:
            dataset = self.get_dataset(dataset_name)
            documents = dataset.list_documents(id=doc_id)

            if not documents:
                logger.error(f"未找到文档: {doc_id}")
                return False

            doc = documents[0]

            # 使用 RAGFlow SDK 的 update 方法设置 meta_fields
            doc.update({
                "meta_fields": meta_fields
            })

            logger.info(f"文档 {doc_id} meta_fields 设置成功: {meta_fields}")
            return True

        except Exception as e:
            logger.error(f"设置文档 meta_fields 失败: {e}")
            return False

    def get_document_meta_fields(self, dataset_name: str, doc_id: str) -> dict:
        """
        获取文档的 meta_fields 元数据

        Args:
            dataset_name: 知识库名称
            doc_id: 文档ID

        Returns:
            dict: 文档的 meta_fields，如果获取失败返回空字典
        """
        try:
            dataset = self.get_dataset(dataset_name)
            documents = dataset.list_documents(id=doc_id)

            if not documents:
                logger.warning(f"未找到文档: {doc_id}")
                return {}

            doc = documents[0]
            return getattr(doc, 'meta_fields', {}) or {}

        except Exception as e:
            logger.error(f"获取文档 meta_fields 失败: {e}")
            return {}


def extract_from_chunks(chunks, input_query="", prompt_key=""):

    # 如果 input_query 都为空，直接返回空（chunks可以为空列表，这是正常的）
    if not input_query and not prompt_key:
        return {}

    content = ''
    if chunks and isinstance(chunks, list):
        for ch in chunks:
            if isinstance(ch, dict):
                content += ch.get('content', '')
    
    prompt = ""
    if prompt_key:
        prompt_manager = PromptManager()
        try:
            prompt_obj = prompt_manager.get_prompt(prompt_key)
            prompt = prompt_obj.compile(input_query=input_query, file_chunks=content)
        except Exception as e:
            print(f"Failed to get prompt '{prompt_key}': {e}")
            # 如果获取指定prompt失败，回退到默认拼接方式
            prompt = f"{input_query}\n\n{content}"
    else:
        # 如果没有 prompt_key，直接使用 input_query 并拼接内容
        prompt = f"{input_query}\n\n{content}"

    messages = [{
        'role': 'user',
        'content': prompt
    }]
    response_content = ''
    response = dashscope.Generation.call("qwen-plus",
                                         messages=messages,
                                         result_format='message',
                                         stream=False,
                                         incremental_output=False)
    if response.status_code == HTTPStatus.OK:
        response_content = response.output.choices[0]['message']['content']
    else:
        print('Request id: %s, Status code: %s, error code: %s, error message: %s' % (
            response.request_id, response.status_code,
            response.code, response.message
        ))

    # Try to parse JSON from the response content
    try:
        import re
        import json
        match = re.search(r"```json\s*(.*?)\s*```", response_content, re.DOTALL)
        if match:
            json_str = match.group(1)
        else:
            # Try to find just braces
            match = re.search(r"\{.*\}", response_content, re.DOTALL)
            if match:
                json_str = match.group(0)
            else:
                json_str = response_content
        
        return json.loads(json_str)
    except Exception as e:
        print(f"JSON Parsing failed: {e}")
        return {"raw_content": response_content, "error": "Failed to parse JSON"}

def main():
    parser = RagflowParser(dataset_name="test_ygy")
    test_file = r"e:\hslaec\ai\ArchSpec\apps\agent\data\test.pdf"

    parser.upload_file(test_file)
    parser.parse_single_file("test.pdf")

    parser.get_file_chunks("test.pdf")


if __name__ == '__main__':
    main()
