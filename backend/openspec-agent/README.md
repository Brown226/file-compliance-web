# ArchSpec AI Agent

ArchSpec 项目的核心 AI 引擎，负责 RAG 检索、Prompt 管理、工作流编排以及与 LLM 的交互。

## 核心技术栈
- **Framework**: FastAPI (Python 3.10+)
- **RAG Engine**: RAGFlow (via API)
- **Workflow**: LangGraph
- **Prompt Management**: Langfuse
- **LLM**: 通过 Langfuse/LiteLLM 接入 OpenAI 兼容接口

## 目录结构

```
apps/agent/
├── api/                # API 路由定义
│   └── rag_api.py      # RAG 相关接口 (生成、提取)
├── service/            # 业务逻辑层
│   ├── db/             # 数据库交互
│   ├── rag/            # RAG 服务实现
│   │   ├── extract_info.py         # 信息提取服务
│   │   ├── rag_service_ragflow.py  # RAGFlow 集成与生成逻辑
│   │   └── ...
│   └── workflow/       # LangGraph 工作流定义
│       └── rag_graph.py
├── app.py              # 应用入口
├── requirements.txt    # 依赖列表
└── ...
```

## 快速开始

### 1. 环境准备
确保已安装 Python 3.10+。建议使用 Conda 或 venv。

```bash
# 创建环境
conda create -n archspec-agent python=3.10
conda activate archspec-agent

# 安装依赖
pip install -r requirements.txt
```

### 2. 配置
在 `apps/agent` 目录下创建 `.env` 文件（参考 `.env.example` 或 `deploy/docker/.env`），配置必要的环境变量：

- `RAGFLOW_API_KEY`: RAGFlow API 密钥
- `RAGFLOW_HOST`: RAGFlow 服务地址
- `LANGFUSE_PUBLIC_KEY`: Langfuse 公钥
- `LANGFUSE_SECRET_KEY`: Langfuse 私钥
- `LANGFUSE_HOST`: Langfuse 服务地址

### 3. 启动服务

```bash
# 开发模式启动
uvicorn app:app --reload --port 5000 --host 0.0.0.0
```

或者直接运行 Python 脚本：

```bash
python app.py
```

服务启动后，API 文档位于: `http://localhost:5000/docs`

## 关键特性
- **LangGraph 工作流**: 采用图结构编排复杂的 RAG 生成过程。
- **Langfuse 集成**: 所有的 System Prompts 均通过 Langfuse 进行管理和版本控制，代码中不再硬编码 Prompt。
- **流式响应**: 支持 Server-Sent Events (SSE) 流式输出生成内容。
