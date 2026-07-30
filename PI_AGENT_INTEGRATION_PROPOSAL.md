# 基于 Pi 的 Agent 平台重建方案

> **版本**: v1.0
> **日期**: 2026-07-30
> **状态**: 方案设计
> **目标**: 推翻现有不成熟的 Python Agent,基于开源项目 Pi 重建统一的多用户、多场景文档处理 Agent 平台

---

## 一、背景与现状

### 1.1 现有系统痛点

当前项目存在两套独立的 Agent 实现:

| 模块 | 技术栈 | 问题 |
|------|--------|------|
| `backend/openspec-agent/`(Python) | FastAPI + LangGraph + DashScope | 单文件 1000+ 行,手写状态机、消息过滤、事件跟踪,维护困难 |
| `backend/src/services/review/`(Node.js) | Prisma + RAGFlow + pgvector | 业务逻辑成熟,但与 Python Agent 通过 HTTP 转发,存在双栈维护成本 |

**核心痛点**:
- Python Agent 不成熟,状态机复杂,手写代码过多
- Python/Node.js 双技术栈,运维复杂
- 单一 DashScope LLM 供应商绑定
- 审查模式硬编码,扩展新场景需改代码
- 无 Session 分叉能力,审查迭代无法回溯
- 上下文管理粗糙,长任务易爆 context

### 1.2 开源项目 Pi 介绍

- **仓库**: [earendil-works/pi](https://github.com/earendil-works/pi)(55.6k stars,MIT 协议)
- **作者**: Mario Zechner(badlogic)
- **定位**: 自扩展 Agent 框架,"Adapt pi to your workflows, not the other way around"
- **核心包**:
  - `pi-ai`: 统一 LLM API,支持 40+ 供应商(**含 Qwen/DashScope 原生支持**)
  - `pi-agent-core`: Agent 运行时,AgentMessage 双层模型 + 事件流
  - `pi-coding-agent`: 完整 Agent 实现 + SDK + Extension 系统
  - `pi-tui`: 终端 UI(本方案不使用)

- **Pi-Web**: [agegr/pi-web](https://github.com/agegr/pi-web),Next.js 构建的 Web UI,提供 Session 浏览/分叉、实时 SSE 聊天、文件预览、上下文用量可视化

### 1.3 方案目标

1. **推翻重造**: 替换 Python Agent,统一到 Node.js 技术栈
2. **多用户支持**: 服务器部署,多用户会话与任务隔离
3. **多场景扩展**: 从审查扩展到通用文档处理(Word转Excel/生成PPT/生成图表等)
4. **集成现有平台**: 嵌入现有审查平台,用户无感知
5. **借鉴 Pi-Web 设计**: 移植其前端设计语言到 Vue 平台

---

## 二、技术选型与对比

### 2.1 集成方式选择

| 方案 | 做法 | 评价 |
|------|------|------|
| A. Fork Pi 整体改造 | fork 仓库改代码 | ✗ Pi 60% 是编码场景代码,噪音大 |
| B. Pi CLI + Extension | 直接用 Pi CLI,写扩展 | ✗ Pi-Web 单用户模型,多用户难 |
| **C. Pi SDK 嵌入后端(推荐)** | **作为依赖库,编程式调用** | **✓ 沿用现有架构,多用户天然支持** |
| D. Pi 作为微服务 | 包装独立 HTTP 服务 | △ 又回到 HTTP 转发,失去进程内调用优势 |

**选定方案 C**: 把 `@earendil-works/pi-coding-agent` 作为依赖装到现有 Node.js 后端,通过 `createAgentSession` SDK 编程式调用。

### 2.2 前端方案选择

| 方案 | 做法 | 评价 |
|------|------|------|
| A. 直接部署 Pi-Web | 不改 | ✗ 单用户,jsonl 本地文件,无用户隔离 |
| B. iframe 嵌入 | 两套前端 | ✗ 认证割裂,样式不统一 |
| C. 反向代理 | 路由统一但应用独立 | ✗ 状态不共享,数据隔离难 |
| **D. 移植设计到 Vue(推荐)** | **照搬 Pi-Web 设计,Vue 重写** | **✓ 统一栈,原生多用户,完整设计语言** |

**选定方案 D**: 移植 Pi-Web 的设计语言和交互逻辑到现有 Vue 前端,而非部署 Pi-Web 应用。

**理由**: Pi-Web 是单用户本地场景设计(读本地 jsonl、共享 LLM key、无用户体系),与多用户服务器平台需求根本性冲突。移植设计而非部署应用,是唯一能同时满足"Pi-Web 设计 + 多用户 + 统一平台"的方案。

---

## 三、整体架构

### 3.1 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│  Vue 前端(现有 + 扩展,移植 Pi-Web 设计)                          │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────────────────┐│
│  │ 审查工作台    │ │ 文档处理工作台 │ │ Pi-Web 风格组件          ││
│  │ (现有)       │ │ (新增)        │ │ ChatWindow/BranchNav     ││
│  │              │ │ 上传+提示词    │ │ ContextUsage/SessionList ││
│  └──────────────┘ └──────────────┘ └──────────────────────────┘│
└──────────────────────────┬──────────────────────────────────────┘
                           │ SSE + REST
┌──────────────────────────▼──────────────────────────────────────┐
│  Node.js 后端(现有 Fastify/Express)                              │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐│
│  │  API 路由层(扩展现有)                                        ││
│  │  POST /api/agent/sessions      创建会话(带 userId)          ││
│  │  GET  /api/agent/sessions/:id/stream  SSE 流                ││
│  │  POST /api/agent/sessions/:id/abort  中断                   ││
│  │  POST /api/agent/sessions/:id/fork   分叉                   ││
│  │  GET  /api/agent/outputs/:id/download  下载生成文件          ││
│  └──────────────────────────┬─────────────────────────────────┘│
│                             │                                    │
│  ┌──────────────────────────▼─────────────────────────────────┐│
│  │  DocumentAgentService(统一入口,新建)                        ││
│  │  - 根据场景路由到不同 Skill                                   ││
│  │  - 每请求创建独立 session                                    ││
│  └──────────────────────────┬─────────────────────────────────┘│
│                             │                                    │
│  ┌──────────────────────────▼─────────────────────────────────┐│
│  │  Pi SDK(@earendil-works/pi-coding-agent)                   ││
│  │  ┌─────────────────────────────────────────────────────┐  ││
│  │  │  createAgentSession()    编排层                       │  ││
│  │  │  - AgentMessage 双层模型                              │  ││
│  │  │  - 上下文自动压缩(compaction)                        │  ││
│  │  │  - Session 分叉/回溯                                 │  ││
│  │  │  - 标准化事件流                                      │  ││
│  │  └─────────────────────────────────────────────────────┘  ││
│  └──────────────────────────┬─────────────────────────────────┘│
│                             │                                    │
│  ┌──────────────────────────▼─────────────────────────────────┐│
│  │  Skill 集(按场景加载)                                       ││
│  │  ┌────────┐ ┌────────────┐ ┌────────┐ ┌────────────────┐  ││
│  │  │ review │ │word-to-excel│ │gen-ppt │ │document-gen    │  ││
│  │  │SKILL.md│ │ SKILL.md    │ │SKILL.md│ │ SKILL.md       │  ││
│  │  └────────┘ └────────────┘ └────────┘ └────────────────┘  ││
│  └──────────────────────────┬─────────────────────────────────┘│
│                             │                                    │
│  ┌──────────────────────────▼─────────────────────────────────┐│
│  │  工具集(按 Skill 注册,defineTool)                           ││
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐  ││
│  │  │ 审查工具  │ │ 文档读取  │ │ 文档生成  │ │ 输出管理     │  ││
│  │  │retrieve_ │ │read_     │ │gen_excel │ │save_output  │  ││
│  │  │standard  │ │uploaded_ │ │gen_ppt   │ │             │  ││
│  │  │retrieve_ │ │document  │ │gen_docx  │ │             │  ││
│  │  │case      │ │extract_  │ │gen_chart │ │             │  ││
│  │  │check_    │ │tables    │ │          │ │             │  ││
│  │  │clause    │ │          │ │          │ │             │  ││
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘  ││
│  └──────────────────────────┬─────────────────────────────────┘│
│                             │                                    │
│  ┌──────────────────────────▼─────────────────────────────────┐│
│  │  基础设施层(现有,零改动)                                    ││
│  │  - Prisma + PostgreSQL(业务数据)                          ││
│  │  - pgvector(长期记忆,按 userId 隔离)                      ││
│  │  - RAGFlow(知识库检索)                                    ││
│  │  - MinIO 对象存储(上传/生成文件)                          ││
│  │  - Langfuse(可观测性)                                    ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐│
│  │  pi-ai(LLM 抽象,新增)                                      ││
│  │  - qwen-token-plan-cn(DashScope,主力)                     ││
│  │  - 可选 Claude/GPT(校验用强模型)                           ││
│  └────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 分层职责

| 层 | 职责 | 来源 |
|----|------|------|
| 前端 | 用户交互、流式渲染、文件上传/下载 | 现有 Vue + 移植 Pi-Web 设计 |
| API 路由 | HTTP/SSE 接入、JWT 鉴权 | 现有 + 扩展 |
| DocumentAgentService | 统一入口、场景路由、session 管理 | 新建 |
| Pi SDK | Agent 编排、状态机、压缩、分叉 | 开源库 |
| Skill | 场景化 prompt 与工作流 | 新建(.md 文件) |
| 工具集 | 具体业务能力(检索/生成) | 新建(defineTool) |
| 基础设施 | 数据存储、检索、文件 | 现有,零改动 |

---

## 四、多用户与隔离设计

### 4.1 四层隔离体系

```
┌─────────────────────────────────────────────────────┐
│  层级 1:JWT 用户身份(现有,沿用)                     │
│  每个 HTTP 请求携带 JWT → 解析出 userId             │
├─────────────────────────────────────────────────────┤
│  层级 2:Pi Session 隔离(每请求独立对象)             │
│  const session = createAgentSession({               │
│    metadata: { userId, taskId, documentId }          │
│  })                                                  │
├─────────────────────────────────────────────────────┤
│  层级 3:工作目录隔离(按任务分目录)                  │
│  cwd: `/data/agent-workspace/${taskId}/`            │
├─────────────────────────────────────────────────────┤
│  层级 4:数据隔离(现有 Prisma + pgvector)           │
│  WHERE userId = ? AND taskId = ?                    │
└─────────────────────────────────────────────────────┘
```

### 4.2 隔离保障清单

| 维度 | 隔离方式 | 保障 |
|------|---------|------|
| 会话状态 | 每请求独立 session 对象(进程内) | 用户 A 的对话不会泄露给用户 B |
| 上下文 | session.messages 数组独立 | 历史消息完全隔离 |
| 工作目录 | `/data/agent-workspace/{taskId}/` | 临时文件不串 |
| 知识库权限 | 工具内按 userId 过滤 KB | 用户只能看授权的知识库 |
| 记忆召回 | pgvector WHERE user_id = ? | 长期记忆按人隔离 |
| 审查结果 | Prisma WHERE task_id = ? | 结果归属明确 |
| LLM 调用 | 共享 key,但请求独立 | API 限额按服务端统计 |

### 4.3 核心实现

```typescript
// backend/src/services/agent/document-agent.service.ts

// 全局共享:LLM 配置(单例,所有用户共用)
const sharedModelRuntime = new ModelRuntime({
  authFile: "/etc/pi/auth.json",
});

// 每个用户请求:创建完全隔离的 session
export async function createDocumentSession(
  userId: string,
  taskId: string,
  scenario: string,           // 'review' | 'word-to-excel' | ...
  uploadedFileIds: string[],
) {
  // 1. 工作目录按 taskId 隔离
  const taskWorkdir = `/data/agent-workspace/${taskId}`;
  await fs.mkdir(taskWorkdir, { recursive: true });

  // 2. 根据场景组合工具(工具内闭包注入身份)
  const tools = [...commonTools, ...(scenarioTools[scenario] || [])];

  // 3. 创建独立 Pi session
  const session = await createAgentSession({
    cwd: taskWorkdir,
    modelRuntime: sharedModelRuntime,
    tools,
    skillsDir: `./skills/${scenario}`,
    model: { provider: "qwen-token-plan-cn" },
  });

  // 4. session 元数据携带用户身份
  session.setMetadata({ userId, taskId, scenario, uploadedFileIds });

  // 5. 注册到 session 注册表(支持并发管理、中断)
  activeSessions.set(taskId, session);

  return session;
}

// 工具内通过闭包捕获身份,实现数据隔离
function createReviewTools({ userId, taskId, documentId }) {
  const retrieveStandard = defineTool({
    name: "retrieve_standard",
    handler: async (input) => {
      // 只检索该用户有权限的知识库
      const kbIds = await getUserAuthorizedKbIds(userId);
      return await ragflowSearch(input.query, kbIds);
    },
  });

  const recallMemory = defineTool({
    name: "recall_memory",
    handler: async (input) => {
      // pgvector 记忆按 userId 隔离
      return await recallUserMemory(userId, input.query);
    },
  });

  return [retrieveStandard, recallMemory];
}

// session 注册表(支持并发管理、超时清理、用户主动中断)
const activeSessions = new Map<string, AgentSession>();

export async function abortSession(taskId: string, userId: string) {
  const session = activeSessions.get(taskId);
  if (session?.getMetadata().userId === userId) {  // 权限校验
    session.abort();
    activeSessions.delete(taskId);
  }
}
```

### 4.4 容量估算

| 资源 | 单 session 占用 | 100 并发估算 |
|------|----------------|-------------|
| 内存 | ~10-30 MB | 1-3 GB |
| CPU | LLM 调用 IO 密集,等待时 CPU 空闲 | 2-4 核 |
| 磁盘 | session 临时文件(可清理) | 可忽略 |
| LLM API | 受 DashScope QPS 限制 | 看 Qwen 配额 |

**瓶颈在 LLM API 的 QPS/并发限制,不在 Pi 本身**。

---

## 五、文件处理设计

### 5.1 核心原则

- **网页端不访问用户本地文件**(浏览器沙箱限制,也是安全要求)
- **用户上传文件** → 对象存储(MinIO)+ 文本提取 + RAGFlow 索引
- **Agent 不直接碰文件系统**,只通过工具从 DB/对象存储读取
- **不注册 Pi 的 bash/read/edit 工具**,只注册业务工具

### 5.2 完整文件处理流程

```
用户上传文件
    │
    ▼
┌─────────────────────────────────────────────────────┐
│  阶段 1:上传与存储                                    │
│  - 原文件存 MinIO                                    │
│  - 元数据存 PostgreSQL(file 表)                     │
│  - 关联 userId/projectId/taskId                     │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  阶段 2:文本提取(现有 text-extraction.service.ts)   │
│  - PDF/DOCX → 纯文本 + 结构化章节                    │
│  - OCR 处理(扫描件)                                 │
│  - 存到 file_chunks 表                               │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  阶段 3:知识库索引(现有 RAGFlow 集成)               │
│  - 文件上传到 RAGFlow 创建临时数据集                 │
│  - RAGFlow 自动分块 + 向量化                         │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  阶段 4:Pi Agent 处理                                │
│  - 创建 session,cwd 指向任务工作目录                 │
│  - 工具从 DB/对象存储读取数据                         │
│  - Agent 调用工具完成处理                            │
│  - 生成的文件存对象存储                              │
└────────────────────────┬────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────┐
│  阶段 5:结果持久化                                   │
│  - 审查意见存 review_issues 表                       │
│  - 生成文件存 agent_outputs 表                       │
│  - session 用完即弃(或保留供回溯)                   │
└─────────────────────────────────────────────────────┘
```

### 5.3 对象存储结构

```
MinIO Bucket 结构:
  uploads/                    # 用户上传的原文件
    {userId}/{projectId}/{fileId}/{filename}
  outputs/                    # Agent 生成的文件
    {taskId}/{outputId}/{filename}
  temp/                       # 中间产物
    {taskId}/
```

### 5.4 数据模型扩展

```prisma
// 新增:Agent 会话表
model AgentSession {
  id              String   @id
  userId          String   // 用户隔离
  taskId          String   // 任务隔离
  scenario        String   // review / word-to-excel / ...
  title           String
  parentSessionId String?  // 支持分叉
  status          String   // running / completed / aborted
  cwd             String
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  
  entries         SessionEntry[]
  outputs         AgentOutput[]
}

// 新增:会话消息条目(替代 Pi 的 jsonl 文件存储)
model SessionEntry {
  id          String   @id
  sessionId   String
  parentId    String?
  type        String   // message / compaction / model_change
  content     Json     // AgentMessage 序列化
  timestamp   DateTime
  
  session     AgentSession @relation(fields: [sessionId], references: [id])
}

// 新增:Agent 生成的文件
model AgentOutput {
  id          String   @id
  taskId      String
  userId      String
  fileName    String
  fileType    String   // 'excel' | 'ppt' | 'docx' | 'chart' | 'image'
  storagePath String
  fileSize    Int
  downloadUrl String   @unique
  createdAt   DateTime @default(now())
  
  session     AgentSession @relation(fields: [taskId], references: [taskId])
}
```

---

## 六、多场景扩展设计

### 6.1 场景与 Skill 映射

| 场景 | Skill | 核心工具 |
|------|-------|---------|
| 文档审查 | review/SKILL.md | retrieve_standard / retrieve_case / check_clause |
| Word转Excel | word-to-excel/SKILL.md | read_uploaded_doc / generate_excel |
| 生成PPT | generate-ppt/SKILL.md | generate_ppt / generate_chart |
| 生成Word | document-generation/SKILL.md | generate_docx |
| 生成图表 | generate-chart/SKILL.md | generate_chart |
| 文档摘要 | document-summarization/SKILL.md | read_uploaded_doc |

### 6.2 Skill 目录结构

```
skills/
├── review/                    # 审查场景
│   └── SKILL.md
├── word-to-excel/             # Word 转 Excel
│   └── SKILL.md
├── word-to-ppt/               # Word 转 PPT
│   └── SKILL.md
├── generate-chart/            # 生成图表
│   └── SKILL.md
├── document-generation/       # 通用文档生成
│   └── SKILL.md
└── document-summarization/    # 文档摘要
    └── SKILL.md
```

### 6.3 Skill 示例(word-to-excel)

```markdown
---
name: word-to-excel
description: 从 Word 文档中提取表格/数据,生成 Excel 文件
disable-model-invocation: false
---

# Word 转 Excel 任务

你是文档处理专家。用户会上传 Word 文档,要求将其中的表格或结构化数据转为 Excel。

## 工作流程
1. 调用 `read_uploaded_document` 读取 Word 内容,开启 extractTables
2. 分析文档中的表格和数据结构
3. 如果用户指定了要提取的内容,聚焦该部分;否则提取所有表格
4. 调用 `generate_excel` 生成 Excel 文件
5. 返回下载链接给用户

## 注意事项
- 保留原表格的层级关系
- 表头加粗,数据对齐
- 多个表格放不同 Sheet
- 如果数据不完整,询问用户确认
```

### 6.4 工具集设计

#### 通用工具(所有场景共用)

```typescript
// 文档读取工具(复用现有 text-extraction.service.ts)
const readUploadedDoc = defineTool({
  name: "read_uploaded_document",
  description: "读取用户上传的文档内容(支持 Word/PDF/TXT/Excel)",
  inputSchema: Type.Object({
    fileId: Type.String(),
    extractTables: Type.Optional(Type.Boolean()),
    extractImages: Type.Optional(Type.Boolean()),
  }),
  handler: async (input) => {
    const fileBuffer = await minio.getObject('uploads', storagePath);
    const result = await textExtractionService.extract(fileBuffer, {
      extractTables: input.extractTables,
      extractImages: input.extractImages,
    });
    return { text: result.text, chapters: result.chapters, tables: result.tables, images: result.images };
  },
});
```

#### 文档生成工具

| 工具 | 库 | 用途 |
|------|-----|------|
| `generate_excel` | exceljs | 生成 Excel 文件 |
| `generate_ppt` | pptxgenjs | 生成 PPT 演示文稿 |
| `generate_docx` | docx | 生成 Word 文档 |
| `generate_chart` | chartjs-node-canvas / echarts | 生成图表 |
| `generate_pdf` | pdfkit / puppeteer | 生成 PDF |

#### 审查专用工具(迁移自 Python Agent)

| 工具 | 用途 |
|------|------|
| `retrieve_standard` | 从 RAGFlow 检索建筑规范 |
| `retrieve_case` | 从 RAGFlow 检索相似案例 |
| `recall_memory` | 从 pgvector 召回用户长期记忆 |
| `check_clause` | 条款合规检查(复用现有 review-pipeline) |

### 6.5 统一服务层

```typescript
// backend/src/services/agent/document-agent.service.ts

const sharedModelRuntime = new ModelRuntime({ authFile: "/etc/pi/auth.json" });

// 所有场景共用的工具
const commonTools = [readUploadedDoc, saveOutput];

// 按场景注册的工具集
const scenarioTools = {
  review: [retrieveStandard, retrieveCase, recallMemory, checkClause],
  'word-to-excel': [generateExcel],
  'word-to-ppt': [generatePpt, generateChart],
  'generate-chart': [generateChart],
  'document-generation': [generateDocx, generateExcel, generatePpt],
};

export async function createDocumentSession(
  userId: string,
  taskId: string,
  scenario: string,
  uploadedFileIds: string[],
) {
  const tools = [...commonTools, ...(scenarioTools[scenario] || [])];
  const session = await createAgentSession({
    cwd: `/data/agent-workspace/${taskId}/`,
    modelRuntime: sharedModelRuntime,
    tools,
    skillsDir: `./skills/${scenario}`,
    model: { provider: "qwen-token-plan-cn" },
  });
  session.setMetadata({ userId, taskId, scenario, uploadedFileIds });
  return session;
}
```

---

## 七、API 设计

### 7.1 核心接口

```typescript
// 创建会话(通用,支持审查和文档处理)
POST /api/agent/sessions
  body: {
    scenario: "review" | "word-to-excel" | "generate-ppt" | ...,
    fileIds: ["file1", "file2"],          // 上传的文件
    prompt: "审查这份文档的消防章节",       // 用户提示词
    reviewMode?: "DEC_REVIEW" | ...,       // 审查场景专用
  }
  → JWT 解析 userId
  → createDocumentSession(userId, taskId, scenario, fileIds)
  → 返回 { sessionId, taskId }

// SSE 流式接收处理过程
GET /api/agent/sessions/:sessionId/stream
  → 订阅 session 事件流
  → Pi 事件 → 转 SSE(token/timeline_step/tool_call/output_ready)
  → 前端实时渲染

// 中断会话
POST /api/agent/sessions/:sessionId/abort
  → 权限校验后 session.abort()

// 会话分叉
POST /api/agent/sessions/:sessionId/fork
  body: { fromEntryId?: string }
  → 从指定节点创建新 session

// 会话列表
GET /api/agent/sessions
  → 按 userId 过滤,支持分页/搜索

// 会话详情(历史消息)
GET /api/agent/sessions/:sessionId/entries
  → 返回 SessionEntry 列表

// 输出文件列表
GET /api/agent/sessions/:sessionId/outputs
  → 返回生成的文件列表

// 下载生成的文件
GET /api/agent/outputs/:outputId/download
  → 从 MinIO 拉取,返回文件流
```

### 7.2 SSE 事件协议(兼容现有前端)

| 事件类型 | 说明 |
|---------|------|
| `session_start` | 会话开始 |
| `token` | LLM 流式 token |
| `timeline_step` | 步骤开始/完成 |
| `tool_call` | 工具调用 |
| `tool_result` | 工具结果 |
| `step_result` | 阶段结果(如审查 pass/revise) |
| `memory_recalled` | 记忆召回 |
| `output_ready` | 文件生成完成 |
| `reference` | 引用元数据 |
| `error` | 错误 |
| `done` | 会话结束 |

**SSE 适配层**: Pi 的事件流(`agent_start/turn/message/tool_call/tool_result/turn_end`)映射到上述协议,前端零改动。

---

## 八、前端设计(移植 Pi-Web)

### 8.1 移植清单

| Pi-Web 组件 | 对应 Vue 实现 | 复用价值 |
|------------|--------------|---------|
| `AppShell.tsx` | AppShell.vue | 整体布局、主题切换 |
| `ChatWindow.tsx` | ChatWindow.vue | 流式消息渲染、markdown、代码高亮 |
| `BranchNavigator.tsx` | BranchNavigator.vue | 会话分叉树、时间线 |
| `ChatInput.tsx` | ChatInput.vue | 多行输入、图片粘贴、斜杠命令 |
| `ContextUsage.tsx` | ContextUsage.vue | token 用量条、成本显示 |
| `SessionList.tsx` | SessionList.vue | 会话列表、搜索 |
| `ToolExecution.tsx` | ToolExecution.vue | 工具调用展开/折叠 |
| `FileViewer` | FileViewer.vue | diff/图片/PDF 预览 |

### 8.2 移植示例

Pi-Web(React)→ Vue 几乎是语法转换,设计逻辑 100% 保留:

**Pi-Web 的 ChatWindow.tsx**:
```tsx
function ChatWindow({ sessionId }) {
  const [messages, setMessages] = useState([]);
  const [streaming, setStreaming] = useState(false);
  
  useEffect(() => {
    const eventSource = new EventSource(`/api/agent/${sessionId}`);
    eventSource.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === 'message_update') {
        setMessages(prev => updateLastMessage(prev, event));
      }
    };
  }, [sessionId]);
  
  return <div>{messages.map(m => <Message key={m.id} message={m} />)}</div>;
}
```

**移植到 Vue**:
```vue
<script setup lang="ts">
const props = defineProps<{ sessionId: string }>();
const messages = ref<AgentMessage[]>([]);
const streaming = ref(false);

onMounted(() => {
  const eventSource = new EventSource(`/api/agent/sessions/${props.sessionId}/stream`);
  eventSource.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type === 'message_update') {
      updateLastMessage(messages.value, event);
    }
  };
});
</script>

<template>
  <div>
    <Message v-for="m in messages" :key="m.id" :message="m" />
  </div>
</template>
```

### 8.3 设计资源直接复用

- `globals.css` — 全局样式、CSS 变量、暗色主题
- `theme.ts` — 主题定义(颜色、字体、间距)
- 所有图标和图片资源
- Tailwind 配置(如使用)

---

## 九、保留与替换清单

### 9.1 保留(核心资产,零改动)

| 模块 | 位置 | 理由 |
|------|------|------|
| Vue 前端框架 | `frontend/` | 统一技术栈 |
| Node.js 后端框架 | `backend/src/` | 现有架构成熟 |
| Prisma + PostgreSQL | `backend/src/config/db` | 数据层基础设施 |
| pgvector 长期记忆 | `backend/src/services/llm/` | 按 userId 隔离已实现 |
| RAGFlow 集成 | `backend/src/services/knowledge/` | 知识库基础设施 |
| review-pipeline 业务逻辑 | `backend/src/services/review-pipeline/` | 8 种 aiStrategy 是业务核心 |
| review 业务逻辑 | `backend/src/services/review/` | DEC/SmartJudge/TextCrossCheck 成熟 |
| text-extraction | `backend/src/services/review-pipeline/text-extraction.service.ts` | 文档解析能力 |
| JWT 用户体系 | `backend/src/middleware/` | 认证基础 |

### 9.2 替换(推翻重造)

| 当前模块 | 替换为 | 说明 |
|---------|--------|------|
| `backend/openspec-agent/`(整个 Python 服务) | Pi SDK 进程内调用 | 消除 HTTP 转发,统一栈 |
| `construction_agent.py` | Pi Agent + ReviewHarness | LangGraph → pi-agent-core |
| `workflow_api.py`(SSE) | Node.js SSE + Pi 事件流适配 | 统一在 Node 后端 |
| `prompt_manager.py`(Langfuse) | Pi PromptTemplate + Langfuse SDK | 保留 Langfuse |
| `langfuse_callback.py` | pi-ai Usage 事件 + Langfuse SDK | 保留 Langfuse |
| `memory_service.py` | Pi Session(短期)+ pgvector(长期) | 两层共存 |
| `construction_tools.py` | Pi AgentTool + 现有 RAGFlow HTTP | 工具层平移 |
| `token_counter.py` | Pi compaction 自动压缩 | 删除手写代码 |
| `openspec-agent.service.ts`(HTTP 转发) | 直接进程内调用 | 消除 HTTP+JWT 开销 |

### 9.3 新增

| 模块 | 说明 |
|------|------|
| `backend/src/services/agent/document-agent.service.ts` | 统一入口 |
| `backend/src/services/agent/tools/` | 审查工具 + 文档生成工具 |
| `skills/` | 场景化 SKILL.md 文件 |
| `AgentSession` / `SessionEntry` / `AgentOutput` 表 | 数据模型 |
| Vue Pi-Web 风格组件 | 移植 Pi-Web 设计 |
| MinIO 对象存储 | 文件存储(如未部署) |

---

## 十、工作量估算

### 10.1 代码量

| 工作项 | 代码量 | 难度 |
|--------|--------|------|
| DocumentAgentService(统一入口) | ~200 行 TS | ★★ |
| 审查工具迁移(4 个) | ~300 行 TS | ★★ |
| 文档生成工具(5 个) | ~700 行 TS | ★★ |
| 文档读取工具 | ~100 行 TS | ★ |
| SSE 适配层 | ~200 行 TS | ★★★ |
| Langfuse 适配 | ~100 行 TS | ★★ |
| 数据模型(Prisma schema) | ~80 行 | ★ |
| API 路由 | ~150 行 TS | ★ |
| SKILL.md(6-8 个) | ~200 行 | ★ |
| Vue 组件移植(8 个) | ~1500 行 Vue | ★★ |
| **合计** | **~3500 行** | — |

### 10.2 难度评估

| 维度 | 评估 | 理由 |
|------|------|------|
| 技术新颖度 | ★★☆☆☆ | Pi SDK API 清晰,TS 类型完整 |
| 业务理解 | ★☆☆☆☆ | 已懂自身审查流程 |
| 工程量 | ★★★★☆ | 需迁移 + 新增多个模块 |
| 调试复杂度 | ★★★☆☆ | 流式 + 工具调用 + 多场景 |
| 风险可控度 | ★★★☆☆ | 可灰度切流 |

**总体**: 中等难度,工程量大但有清晰路径。核心技术风险仅 1 个(Qwen 流式工具调用)。

---

## 十一、风险与对策

| 风险 | 严重度 | 对策 |
|------|--------|------|
| **pi-ai Qwen 流式工具调用不稳定** | 高 | 阶段 1 POC 验证;若不稳,沿用两步策略(thinking LLM + tool LLM) |
| Pi 是编码 Agent,审查/文档场景未验证 | 高 | 只用 pi-agent-core + pi-ai,自行构建 DocumentAgentService,不用 pi-coding-agent 的编码工具 |
| pgvector 记忆与 Pi Session 关系 | 中 | pgvector 保留长期偏好,Pi Session 存短期对话,两层共存 |
| Langfuse 集成 | 中 | pi-ai 有 Usage 事件,写 LangfuseHandler 适配 |
| 前端 SSE 协议变更 | 中 | 适配层保持现有事件格式,前端零改动 |
| Pi-Web 设计移植工作量 | 中 | 照搬设计,Vue 重写,React hooks → Composition API 1:1 对应 |
| 团队 TS/Python 双栈过渡 | 低 | 替换后栈统一为 Node.js,长期降低维护成本 |

---

## 十二、分阶段实施

### 阶段 1:技术验证(1-2 天)

**目标**: 验证 Qwen + Pi SDK 跑通最小流程,降低核心不确定性。

1. 在 [backend/](file:///workspace/backend) 安装 `@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`
2. 配置 `qwen-token-plan-cn` provider,对接 DashScope
3. 实现 1 个最小 Agent:`retrieve_standard` → 生成审查意见
4. 用 1 个真实审查场景跑通
5. **关键验证点**: pi-ai 的 Qwen provider 是否支持流式工具调用

### 阶段 2:审查场景迁移(2-3 周)

**目标**: Node.js 审查 Agent 与 Python Agent 平行运行,灰度切流。

1. 迁移 `construction_agent.py` 的 router/researcher/generate/auditor 到 pi-agent-core
2. 迁移 `construction_tools.py` 的引用池机制到 AgentTool
3. 将 8 种审查模式转为 Skills
4. 实现 SSE 适配层:Pi 事件流 → 现有前端协议
5. Langfuse 集成:pi-ai Usage 事件 → Langfuse SDK
6. [openspec-agent.service.ts](file:///workspace/backend/src/services/llm/openspec-agent.service.ts) 增加 `useNodeAgent: boolean` 开关,灰度切流

### 阶段 3:文档处理扩展(2-3 周)

**目标**: 新增文档生成场景,支持 Word转Excel/生成PPT/生成图表。

1. 实现 5 个文档生成工具(Excel/PPT/Word/Chart/PDF)
2. 编写 6-8 个 SKILL.md
3. 扩展 DocumentAgentService 支持多场景路由
4. 实现文件输出管理(MinIO + AgentOutput 表 + 下载 API)

### 阶段 4:前端移植(2-3 周,可与阶段 2-3 并行)

**目标**: 移植 Pi-Web 设计到 Vue,提升用户体验。

1. 数据层改造:Pi jsonl → PostgreSQL(AgentSession/SessionEntry 表)
2. 移植 8 个 Pi-Web 核心组件到 Vue
3. 复用 Pi-Web 的 globals.css / theme.ts / 图标资源
4. 集成到现有审查平台前端

### 阶段 5:Python Agent 下线(3-5 天)

1. 删除 `backend/openspec-agent/` 整个目录
2. 移除 [openspec-agent.service.ts](file:///workspace/backend/src/services/llm/openspec-agent.service.ts) HTTP 转发逻辑,改为直接调用
3. 移除 Python 相关部署(Dockerfile/requirements.txt/nginx 路由)
4. 启用 Pi 高级能力:Session 分叉、上下文 compaction、多模型路由

---

## 十三、技术栈汇总

| 层 | 技术选型 |
|----|---------|
| Web 框架 | Fastify/Express(现有) |
| Agent 编排 | `@earendil-works/pi-agent-core` |
| Agent SDK | `@earendil-works/pi-coding-agent`(SDK + Extension) |
| LLM 抽象 | `@earendil-works/pi-ai`(qwen-token-plan-cn 为主) |
| 前端框架 | Vue 3(现有)+ 移植 Pi-Web 设计 |
| ORM | Prisma(现有) |
| 数据库 | PostgreSQL + pgvector(现有) |
| 对象存储 | MinIO |
| 知识库 | RAGFlow(现有) |
| 文档生成 | exceljs / pptxgenjs / docx / chartjs |
| 可观测性 | Langfuse(现有) |
| 认证 | JWT(现有) |
| 流式协议 | SSE(兼容现有协议) |

---

## 十四、核心价值

1. **技术栈统一**: 消除 Python/Node.js 双栈,运维简化
2. **架构现代化**: AgentMessage 双层模型、上下文自动压缩、Session 分叉
3. **多场景扩展**: 审查 + 文档处理同一架构,Skill 化扩展
4. **部署简化**: 少一个 Python 服务,Docker 镜像少一层
5. **多用户原生支持**: 每请求独立 session,天然隔离
6. **LLM 多供应商**: 解锁成本优化(校验用强模型,检索用快模型)
7. **Pi-Web 设计语言**: 移植到 Vue,提升用户体验

---

## 十五、下一步行动

### 立即可执行(降低不确定性)

**POC 验证**: 花 2-3 小时验证 Qwen + Pi SDK 流式工具调用

```bash
# 1. 在 backend 下创建验证项目
mkdir -p backend/src/services/agent/poc && cd $_

# 2. 初始化并安装 Pi
npm init -y
npm install @earendil-works/pi-ai @earendil-works/pi-agent-core @earendil-works/pi-coding-agent

# 3. 配置 qwen-token-plan-cn provider
# 4. 编写最小验证:带工具调用的流式请求
# 5. 验证点:工具调用是否在流式过程中正确返回
```

**通过后**: 按阶段 2 推进审查场景迁移
**不通过**: 沿用两步策略(thinking LLM + tool LLM),额外 +2-3 天,非 blocker

### 决策点

- [ ] 确认采用方案 C(Pi SDK 嵌入)
- [ ] 确认采用方案 D(Pi-Web 设计移植到 Vue)
- [ ] 启动阶段 1 POC 验证

---

## 附录 A:关键参考链接

- Pi 主仓库: https://github.com/earendil-works/pi
- Pi-Web: https://github.com/agegr/pi-web
- Pi Agent Core: https://github.com/earendil-works/pi/tree/main/packages/agent
- Pi AI: https://github.com/earendil-works/pi/tree/main/packages/ai
- Pi Coding Agent: https://github.com/earendil-works/pi/tree/main/packages/coding-agent
- Pi SDK 文档: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/core/sdk.ts

## 附录 B:Pi 核心概念速查

| 概念 | 说明 |
|------|------|
| `AgentMessage` | 双层消息模型,UI 事件与 LLM 消息分离 |
| `convertToLlm()` | AgentMessage → LLM Message 转换(在 LLM 调用边界) |
| `Skill` | SKILL.md 文件,定义 agent 行为 prompt |
| `Extension` | TS 模块,注册工具 + 订阅生命周期事件 |
| `defineTool()` | 定义 LLM 可调用工具 |
| `createAgentSession()` | SDK 创建会话(编程式) |
| `compaction` | 上下文自动压缩,防止爆 context |
| `Session fork` | 会话分叉,从历史节点创建新分支 |
| `EventStream` | 标准化事件流(agent_start/turn/message/tool_call) |
