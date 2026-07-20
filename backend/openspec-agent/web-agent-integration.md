# ArchSpec Web↔Agent 调用梳理

## 概览
- **架构路径**：前端 Web 同时调用 Java Backend（`/api/*`）与 Python Agent（`/agent/*`），通过 Nginx 进行反向代理。
- **现状**：Web 端直接调用 Agent 服务进行流式生成和关键信息提取。

## Web 模块对 Agent 的调用清单

### 1. 提取关键要素 (Extract Key Factor)
- **前端函数**：`extractKeyFactors`
- **端点**：`POST /agent/extract_key_factor`
- **源文件**：[rag_api.py](file:///e:/hslaec/ai/ArchSpec/apps/agent/api/rag_api.py)
- **载荷 (Request Body)**：
  ```json
  {
    "prompt": "string",
    "abstract": "string (optional)"
  }
  ```
- **响应**：返回提取出的项目关键信息。

### 2. 段落生成 (Generate Paragraph - Non-stream)
- **前端函数**：`generateParagraph`
- **端点**：`POST /agent/generate_paragraph`
- **源文件**：[rag_api.py](file:///e:/hslaec/ai/ArchSpec/apps/agent/api/rag_api.py)
- **载荷 (Request Body)**：
  ```json
  {
    "prompt": "string",
    "name": "string (document name)",
    "chapterName": "string",
    "requirement": "string",
    "stream": false
  }
  ```

### 3. 段落生成 (Generate Paragraph - Stream)
- **前端函数**：`generateParagraphStream`
- **端点**：`POST /agent/generate_paragraph_stream`
- **源文件**：[rag_api.py](file:///e:/hslaec/ai/ArchSpec/apps/agent/api/rag_api.py)
- **载荷 (Request Body)**：
  ```json
  {
    "prompt": "string",
    "name": "string (document name)",
    "chapterName": "string",
    "requirement": "string",
    "stream": true
  }
  ```
- **响应格式**：Server-Sent Events (SSE)
- **数据字段**：
  - `text`: 生成的文本块
  - `session_id`: 会话 ID
  - `doc_reference`: 引用文档列表

## 调用链路
Web (Vue) -> Nginx (Proxy /agent) -> Python Agent (FastAPI) -> LangGraph Workflow -> LLM
