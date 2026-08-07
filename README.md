# 核审通 · 文件智能审查系统

> **文档状态：2026-08-07 全面校正**。本文件已按代码现状全量重写，与 `AGENTS.md`（面向开发/AI 代理的工作笔记）互为补充。实测口径：后端 23 组路由、42 个数据模型 / 14 个枚举、4 条 Bull 队列、8 种审查模式、20 组规则、553 个后端单测用例。

**核审通**（代码名 file-compliance-web）是一款企业级文件合规智能审查平台。员工上传 **Word / Excel / PDF / PPTX / DWG** 等业务文档后，系统基于「企业标准库 + 规则引擎 + LLM 知识库（RAG）」进行多模式审查，自动识别错别字、格式缺陷、合规违规项与合同风险条款，输出带出处定位的错误明细、审查报告（Excel / Word 导出）与可视化看板，并提供 Agent 智能助手完成对话式审查、批量文档处理与长期记忆。

---

## 🎯 功能全景

```mermaid
graph TD
    A[审查中心] --> B[8 种审查模式]
    A --> C[规则引擎 20 组]
    A --> D[知识库 RAG: MaxKB + RAGFlow]
    B --> E[以库审文 LIBRARY_REVIEW]
    B --> F[基础校对 TYPO_GRAMMAR]
    B --> G[全文一致性 CONSISTENCY]
    B --> H[以文审文 DOC_REVIEW]
    B --> I[合同风险审查 CONTRACT_REVIEW]
    B --> J[仅规则审查 RULE_ONLY]
    B --> K[标准引用自检 SELF_CHECK]
    B --> L[DEC 规范审查 DEC_REVIEW]
    A --> M[审查结果工作台]
    M --> N[文件预览 + 错误明细 + 推理回放]
    M --> O[误报/采纳标记 + 人工复核]
    M --> P[报告导出 Excel/Word]
    Q[Agent 审查助手] --> R[SSE 流式对话]
    Q --> S[长期记忆 + Skills + 批量处理]
    T[DWG 视觉分析] --> U[单图/批量/跨文件对比]
    V[知识中心] --> W[标准库/临时库/条文库/术语表/误报库/规则库]
    X[管理后台] --> Y[部门员工 RBAC/规则/存储/AI引擎/审计/反馈/功能开关]
    Z[数据看板] --> AA[审查质量 + 平台运营]
```

### 1️⃣ 审查中心（主业核心）
- **8 种审查模式**（入口在 `/review`，前端 `ReviewEntry` 卡片墙按功能开关 `entry.*` 过滤）：

  | 模式 | 中文名 | 说明 |
  |---|---|---|
  | `LIBRARY_REVIEW` | 以库审文 | 标准库 + 规则引擎 + AI 合规审查（默认主力模式） |
  | `TYPO_GRAMMAR` | 基础校对 | 错别字/语法/通顺性/术语一致性，跳过 RAG 直接 LLM |
  | `CONSISTENCY` | 全文一致性 | 单文件内 + 跨文件参数一致性（Map-Reduce） |
  | `DOC_REVIEW` | 以文审文 | 上游参照文件与待审文件比对审查 |
  | `CONTRACT_REVIEW` | 合同风险审查 | 核电工程合同风险条款识别（阈值可配） |
  | `RULE_ONLY` | 仅规则审查 | 纯规则引擎，不调 AI，速度最快 |
  | `SELF_CHECK` | 标准引用自检 | 提取文档标准引用与标准库机械匹配（独立端点） |
  | `DEC_REVIEW` | DEC 规范审查 | 审点工程化 + 双分支并行 + 多层交叉复核 |

- **规则引擎**：20 组规则前缀（`NAME/CODE/UNIT/ATTR/HEADER/PAGE/FORMAT/COMPL/CONSIST/LAYOUT/TYPO/PUNCT/INTERNAL_CODE/DWG_TITLE/DWG_LAYER/DWG_DIM/DWG_STDREF/DWG_SCALE/DWG_OVERLAP/CONTRACT`，14 个规则源文件），运行时从 `review_rules` 表读启停/严重度，**前缀级开关 + 60s 缓存**，可在「审查规则配置」页面批量启停、测试匹配、重置默认。
- **审查结果工作台**（`/review/:id`）：左右分栏——左侧文件预览（PDF/DOCX/EXCEL/PPTX/DWG/TXT），右侧错误明细卡片。支持误报/采纳标记、误报库自动沉淀、人工复核（MANAGER+）、LLM 推理回放、按原文定位高亮、审查报告 **Excel / Word 导出**。
- **任务队列**：Bull 四队列 `review` / `dwg-vision` / `cleanup`（临时文件清理）/ `agent-batch`（Agent 批量），WebSocket（`/ws`）按 chunk 推实时进度。

### 2️⃣ Agent 审查助手（`/agent`）
基于 Vercel AI SDK v7（`@ai-sdk/vue`）的对话式审查 Agent，SSE 流式响应，最大 10 步工具调用：
- **会话体系**：会话列表（今天/7 天内分组）、自动命名、收藏、搜索、复制、压缩、统计、**ask_user 主动提问**（挂起等待用户回答后继续）。
- **长期记忆**：`AgentMemory` 用户偏好记忆（记忆管理面板，可查看/编辑/删除）。
- **工具集**（8 大类 40+）：文档（起草/总结）、文件（读写/编辑/上传/OCR/表格提取/比对/报告导出）、知识库（MaxKB 检索/RAG 比对/规则库/审点搜索）、记忆、审查流水线（建任务/查状态/取结果）、批量处理（`/agent/batch`）、用户确认。
- **Skills 体系**：内置/自定义 Skills，读写仅 ADMIN 可用、普通用户只读。
- **模型与 Provider**：Provider 两级配置（LLM Provider + 模型），模型能力探测（`/agent/models/test`）、自动发现（`/agent/providers/discover`）。
- **安全**：最近已修复用户隔离越权漏洞（3 高危 + 2 中危，见 git 提交）。

### 3️⃣ 知识中心（`/knowledge`）
- **标准库**：标准条目 CRUD、多版本状态管理、**Excel / Normative（规范）导入**（含预览确认）、导出、下载模板、**临时库**（导入比对→确认归档入库）、标准引用提取、与临时库比对。
- **MaxKB 知识库**：内嵌 iframe 对接 MaxKB 管理界面，配置/健康检查/连接测试/知识树/命中测试（hit_test）。
- **条文库 + DEC 审点**：规范条文检索、审点生成/修正/删除（MANAGER+）。
- **术语表**：专业术语白名单（审查时自动忽略，内置核安全/设备/工艺/建筑/电气/给排水/暖通术语）。
- **误报库**：审查中被标记误报的文本沉淀，可查看/统计/导出/删除。
- **语义规则库**：规则库 CRUD、文件解析（异步任务）、条目导入。

### 4️⃣ DWG 图纸视觉分析（`/dwg-vision`、`/dwg-batch`）
- 前端 **libredwg WebAssembly** 解析图元 + 视觉大模型（VLM）识别标题栏/符号/标注/合规/专业/图框检查，SVG 预览 + bbox 联动高亮 + 推理回放 + 历史记录。
- 单图分析、**批量分析**（最多 10 个文件并行）、**跨文件对比**。

### 5️⃣ 管理后台（`/admin`，统一管理面板）
- **部门与员工**：部门树（自引用层级）、员工账号 CRUD、批量创建/启停/删除/改用户名、Excel 批量导入、重置密码。
- **审查规则配置**：规则 CRUD、类别、批量启停、按前缀启停、测试匹配、重置默认。
- **AI 引擎配置**：模型配置（对话/OCR/多模态/Embedding/Reranker）、Provider 配置（两级树）、模型能力探测、MaxKB / RAGFlow 配置、知识检索策略、DWG 视觉路由。
- **AI 调用看板**：LLM 调用统计与失败日志。
- **存储管理**：上传路径配置、存储统计、清理孤立文件。
- **基础设置**：系统名称、上传限制、清理策略。
- **审计日志**：全局 POST/PUT/DELETE 自动审计，筛选 + CSV 导出。
- **反馈管理**：意见反馈闭环（提交/附件/状态流转/批量处理/统计）。
- **功能开关**：FeatureFlag 按 key 管理，控制入口卡片等。
- **公告系统**：草稿/发布/撤回/删除/历史，用户端未读提醒 + 紧急公告弹窗。

### 6️⃣ 数据看板
- **审查质量看板**（`/accuracy-dashboard`）：精确率/误报分布/趋势。
- **平台运营看板**：在线用户、活跃度、LLM 用量、部门统计、看板统计/趋势。

---

## 🛠️ 技术栈

### 前端
| 技术 | 版本 | 说明 |
|---|---|---|
| Vue 3 | 3.5 | Composition API |
| Vite | 6.4 | 构建工具（`target: es2020`） |
| Element Plus | 2.9 | UI 组件库（unplugin 自动导入） |
| ECharts | 5.6 | 数据可视化 |
| Pinia | 2.3 | 状态管理（persistedstate 持久化） |
| Vue Router | 4.5 | 路由（meta 驱动权限） |
| @ai-sdk/vue | 4.0 | Agent 流式对话 |
| pdfjs-dist / vue-pdf-embed | 4.10 | PDF 渲染 |
| @mlightcad/libredwg-web | 0.6 | 浏览器端 DWG 解析（WASM） |
| mammoth / xlsx / jszip | - | DOCX/Excel/PPTX 解析 |
| markdown-it + DOMPurify + highlight.js | - | Markdown 安全渲染 |

### 后端
| 技术 | 版本 | 说明 |
|---|---|---|
| Node.js + Express | 5.x | Web 框架 |
| TypeScript | 5.9 | 类型安全（`strict: false`，但 `strictNullChecks` 等已开） |
| Prisma | 5.22 | ORM（42 模型 / 14 枚举） |
| Bull | 4.16 | 任务队列（review/dwg-vision/cleanup/agent-batch） |
| ioredis | 5.10 | Redis 客户端 |
| jsonwebtoken + bcryptjs | - | 认证与密码加密 |
| multer + express-rate-limit | - | 文件上传与限流 |
| exceljs / docx / xlsx | - | 报告生成与导入导出 |
| Vercel AI SDK + @ai-sdk/openai | 7.x | LLM 流式调用 |
| @node-rs/jieba / tiktoken | - | 中文分词与 Token 计数 |

### 基础设施
| 服务 | 版本 | 说明 |
|---|---|---|
| PostgreSQL | 15 + pgvector | 主数据库 |
| Redis | 7 | 缓存 / 队列 / WebSocket 会话 |
| MaxKB | 2.10 LTS | 知识库服务（:8080，compose 内嵌全家桶） |
| RAGFlow | - | 知识库备选通道（`ragflow.service.ts`） |
| doc-parser | FastAPI (Python) | 文档解析 + OCR（:8000，独立镜像） |
| Nginx | alpine | 前端托管 + 反向代理 |

---

## 🚀 快速启动（开发环境）

### 环境要求
Node.js 18+、Docker + Docker Compose、npm 9+。

### 1. 启动基础设施
```bash
# dev 编排在 offline-deploy-v6/compose-files/（根目录没有 docker-compose.yml）
cd offline-deploy-v6/compose-files
docker compose -f docker-compose.offline.yml -f docker-compose.dev.yml up -d
```
也可只起 postgres/redis/doc-parser 三个服务后在本机 `npm run dev`。

### 2. 后端
```bash
cd backend
npm install
npx prisma generate
npx prisma db push          # 同步表结构（无 migration 历史，dev 用 db push）
npx tsx src/seed.ts         # 种子数据：账号/部门/LLM配置/审查规则/术语/公告
npm run dev                 # ts-node-dev --transpile-only，端口 3000
```
验证：`curl http://localhost:3000/health`。

### 3. 前端
```bash
cd frontend
npm install                 # postinstall 自动拷贝 libredwg/pdfs worker 到 public/
npm run dev                 # Vite，端口 5173，代理 /api 与 /ws → :3000
```
浏览器访问 `http://localhost:5173`。

### 默认账号（以 `backend/src/seed.ts` 为准）
| 角色 | 用户名 | 密码 | 说明 |
|---|---|---|---|
| 管理员 ADMIN | admin | Admin@12345 | 全局权限 |
| 部门主管 MANAGER | manager | Manager@123 | 本部门+子部门数据（首次登录强制改密） |
| 普通员工 USER | user | User@12345 | 仅自己数据（首次登录强制改密） |

---

## 📁 项目目录结构

```
file-compliance-web/
├── backend/                         # 后端服务
│   ├── prisma/schema.prisma         # 42 模型 / 14 枚举（约 1000 行）
│   ├── src/
│   │   ├── app.ts                   # Express 应用（路由挂载/中间件）
│   │   ├── index.ts                 # 启动入口（Bull 队列初始化）
│   │   ├── seed.ts                  # 种子数据
│   │   ├── controllers/             # 18 个控制器
│   │   ├── routes/                  # 23 组路由文件
│   │   ├── services/                # 业务逻辑（12 个子目录）
│   │   │   ├── review/              # 审查编排（8 模式 handler、一致性、合同、DEC、自查）
│   │   │   ├── review-pipeline/     # 审查流水线（handler map、模式配置、AI 审查）
│   │   │   ├── rules/               # 规则引擎（14 个规则文件 + 注册表）
│   │   │   ├── agent/               # Agent 助手（记忆/工具/Skills/批量/安全）
│   │   │   ├── knowledge/           # 知识库（MaxKB/RAGFlow/RAG/Embedding）
│   │   │   ├── llm/                 # LLM 服务（Provider/模型能力/提示词模板）
│   │   │   ├── parser/ file/ standard/ system/ auth/ prompts/
│   │   ├── middlewares/             # auth/rbac/audit/rate-limit/security/error
│   │   └── utils/ types/ config/
│   ├── doc-parser/                  # Python FastAPI 文档解析 + OCR（独立镜像）
│   ├── ocr-service/                 # 旧 OCR 容器，已废弃（功能并入 doc-parser）
│   └── uploads/                     # 上传文件（经 /uploads/ 静态服务）
├── frontend/                        # 前端服务
│   └── src/
│       ├── views/                   # 页面（ReviewEntry/TaskResultsView/Agent/Knowledge/...）
│       ├── api/                     # 17 个 API 封装文件（薄 axios 层）
│       ├── components/              # 布局/全局组件/Provider 配置
│       ├── composables/             # useWebSocket/useAgentChat/useFeatureFlags 等
│       ├── stores/                  # Pinia（user/system-config）
│       ├── router/index.ts          # 路由（meta 权限驱动）
│       └── utils/                   # request/dwg-parser/useMarkdown 等
├── desktop/                         # Tauri 2 桌面端「核审通」（Rust + Vue）
├── offline-deploy-v6/               # 现行生产/离线部署包
│   ├── compose-files/               # docker-compose.offline/dev/split-verify.yml
│   ├── images/                      # 镜像 tar（backend/doc-parser/frontend/maxkb）
│   ├── scripts/                     # build-all/load-images/deploy/update-images/fix-migration
│   └── docs/                        # 部署文档
├── docs/                            # 项目文档库（gitignored，见 docs/00-索引与说明）
├── e2e/                             # Playwright（agent-smoke）
├── nginx.conf                       # 前端生产反代配置（权威版）
├── Dockerfile.backend / Dockerfile.frontend
└── AGENTS.md / CLAUDE.md            # 开发/代理工作笔记（gitignored）
```

---

## 🔌 API 一览（23 组路由）

> 全部端点挂载见 `backend/src/app.ts`。以下为主要端点，完整清单以 `backend/src/routes/*.ts` 为准。

| 前缀 | 模块 | 主要端点 |
|---|---|---|
| `/api/auth` | 认证 | `POST /login`、`POST /logout`、`POST /change-password`、`POST /change-username` |
| `/api/agent` | Agent 助手 | `POST /chat/stream`(SSE)、`GET/POST /sessions*`、`GET/PUT/DELETE /memory*`、`GET/PUT/POST/DELETE /skills*`、`/worktrees`、`/providers`、`/models/test`、`/batch`、`/saves`、`/search`、`/directories/browse`、`POST /issues/false-positive` |
| `/api/tasks` | 审查任务 | `POST /`、`GET /`、`GET /:id`、`GET /:id/details`、`GET /:id/progress`、`POST /:id/review`(重新审查)、`POST /:id/ref-files`、`GET /:id/export`(Excel)、`GET /:id/export-word`、`PATCH /details/:detailId/{false-positive,adopt}`、`PATCH /:id/details/:detailId/review`(人工复核)、`GET/PUT /mode-capabilities`、`POST /upload-only` |
| `/api/standards` | 标准库 | CRUD、`POST /upload`、`POST /import/excel`、`GET /export/excel`、`GET /import/template`、`GET /import/normative-template`、`POST /check`、`POST /extract-refs`、`POST /temp-library*`、`POST /import/normative*` |
| `/api/checkpoint` | DEC 审点 | `POST /standards/:id/checkpoints/generate`、`GET /standards/:id/checkpoints`、`GET /search`、`PATCH/DELETE /checkpoints/:id`、`POST /tasks/:taskId/prebind-checkpoints` |
| `/api/rules` | 审查规则 | `GET /panel-data`、CRUD、`POST /import`、`POST /test-match`、`POST /batch-toggle`、`POST /toggle-by-prefix`、`POST /reset` |
| `/api/rule-libraries` | 语义规则库 | CRUD、`POST /:id/parse`、`/parse-preview*`、`/parse-checkpoints-async`、`/:id/import`、`/:id/items*`、`GET /parse-jobs/:jobId` |
| `/api/terminology` | 术语表 | `GET /categories`、CRUD、`POST /batch` |
| `/api/maxkb` | MaxKB 知识库 | `GET /status`、`GET/PUT /config`、`POST /test-connection`、`POST /initialize`、`GET /knowledge-bases`、`GET /knowledge-tree`、`GET /applications`、`POST /hit-test`、`POST /webhook`(免认证仅打日志) |
| `/api/self-check` | 标准引用自检 | `GET /library-info`、`POST /run` |
| `/api/dwg-vision` + `/api/dwg` | DWG 视觉分析 | `POST /vision-analyze`、`POST /vision-upload-ref`、`GET /vision-stream/:jobKey`、`GET /vision-status`、`GET /vision-history*`、`GET /vision-llm-logs/:traceId`、`POST /vision-cross-compare` |
| `/api/dashboard` | 看板 | `GET /stats`、`GET /trend`、`GET /review-metrics`、`GET /online-users`、`GET /activity`、`GET /llm-usage`、`GET /department-stats`、`POST /tasks/:taskId/details/:detailId/feedback` |
| `/api/standard-folders` | 标准文件夹 | `GET /tree`、CRUD |
| `/api/false-positive-library` | 误报库 | `GET /`、`GET /stats`、`GET /export`、`DELETE /:id` |
| `/api/feedback` | 意见反馈 | `POST /`、`GET /my`、`GET /:id`、`GET /download/:fileId`、管理员 `/admin/list`、`/admin/batch*`、`/admin/stats` |
| `/api/announcements` | 公告 | 管理员 CRUD + `/:id/publish`、`/:id/withdraw`；用户 `GET /unread`、`POST /:id/read`、`POST /read-all`、`GET /history` |
| `/api/system` | 系统 | `GET /rule-registry`、`GET /storage-stats`、`POST /cleanup-files`、`GET/PUT /config-path`、`GET/PUT /feature-flags*` |
| `/api/system-config` | 系统配置/LLM | `GET/PUT /:key`、`POST /test-llm`、`POST /probe-model-caps`、`GET/PUT /llm-profiles`、`POST /llm-profiles/fetch-models`、`GET /ai-call-stats` |
| `/api/departments` | 部门 | `GET /`、CRUD、`POST /resolve-path` |
| `/api/employees` | 员工 | CRUD、`POST /batch-create`、`/batch-update-status`、`/batch-delete`、`/batch-update-usernames`、`POST /reset-password/:id` |
| `/api/audit-logs` | 审计日志 | `GET /`、`GET /export`（ADMIN） |
| `/api/metrics` | 指标 | `GET /llm-log-failures`（ADMIN） |
| `/api/health` 等（挂 `/api`） | 健康检查 | `GET /health`、`GET /metrics*`、`GET /cache/stats`、`POST /cache/clear`、`POST /metrics/reset`、`GET /ocr`、`GET /queue`、`GET /maxkb`、`GET /all`（⚠️ 均免认证） |

---

## 🔒 RBAC 权限模型

三角色 + 部门数据隔离：

| 功能 | ADMIN | MANAGER | USER |
|---|---|---|---|
| 查看全局数据 | ✅ | ❌ | ❌ |
| 查看本部门（含子部门）数据 | ✅ | ✅ | ❌ |
| 查看自己数据 | ✅ | ✅ | ✅ |
| 创建/编辑标准、规则、术语 | ✅ | ✅（部分） | ❌ |
| 删除标准/规则/术语 | ✅ | 部分 | ❌ |
| 管理部门/员工 | ✅ | ❌ | ❌ |
| 更新任务状态 / 人工复核 | ✅ | ✅ | ❌ |
| 系统配置 / AI 引擎 / 功能开关 | ✅ | ❌ | ❌ |
| 反馈管理 | ✅ | ❌ | ❌ |

- **数据隔离**：`getTaskFilterByRole()`（`backend/src/middlewares/rbac.middleware.ts`）是唯一权威——ADMIN 全部、MANAGER 所属部门递归子部门、USER 仅自己。
- **前端**：路由 `meta`（`requiresAdmin` / `requiresAdminOrManager` / `allowViewer`）+ 菜单动态过滤；`allowViewer` 页面普通用户可读但隐藏写操作。

---

## 🗄️ 数据库模型

Prisma schema 共 **42 个模型 / 14 个枚举**（`backend/prisma/schema.prisma`，约 1000 行）。

### 核心表
| 模型 | 说明 |
|---|---|
| Department / User | 部门树（自引用）+ 员工账号（RBAC 三角色） |
| Task / TaskFile / TaskDetail | 审查任务 / 任务文件 / 审查结果明细（含 CAD Handle、误报、采纳、人工复核状态） |
| ReviewRule | 审查规则（`review_rules`，前缀级启停/严重度，运行时读取） |
| Standard / StandardCheckpoint / TempStandardEntry | 标准库 / DEC 审点 / 临时标准 |
| StandardFolder / RuleLibrary / RuleLibraryItem / TerminologyWhitelist | 标准文件夹 / 语义规则库 / 术语白名单 |
| FalsePositiveLibrary / ReviewFeedback | 误报库 / 审查反馈 |
| SystemConfig / FeatureFlag / AuditLog | 系统配置（LLM/MaxKB 等运行时配置）/ 功能开关 / 审计日志 |
| Feedback / SystemAnnouncement / UserAnnouncementRead | 意见反馈 / 公告 / 已读记录 |
| KnowledgeCategory / Document / DocumentVersion / VectorDocument / Tag / DocumentTag / KnowledgeCategoryPermission | 知识库（**大部分为历史死模型，见下**） |
| QASession / QAMessage / UserChatSession / AgentMemory / LlmCallLog / VisionAnalysis / SavedItem / AgentBatchJob | Agent 会话与消息 / 长期记忆 / LLM 调用日志 / DWG 视觉分析 / 收藏 / 批量任务 |

### ⚠️ 历史死模型（本地知识库实体化已废弃，勿读写）
`Document` / `DocumentVersion` / `VectorDocument` / `Tag` / `DocumentTag` / `KnowledgeCategoryPermission` / `SpecificationFolder` / `FileVersion` / `DesignChunkCheckpoint`——实际知识库走 MaxKB（+ RAGFlow）与本地 pgvector embedding，后端无 `prisma.xxx` 调用。新增功能不要读写这些表。

### 关系要点
- `Department.parentId` 自引用树，`getSubDepartmentIds()` 递归。
- `TaskDetail` 通过 `taskFileId → TaskFile → Task` 关联任务。
- `VectorDocument.title` 是文档标题（非文件名），文件名/扩展名在 `metadata->>'original_file'`。

---

## ⚙️ 环境变量

### 后端（`backend/.env`）
```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://file_review_user:file_review_password@localhost:5432/file_review_db
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-jwt-secret
JWT_EXPIRES_IN=7d
PARSER_SERVICE_URL=http://localhost:8000        # doc-parser 服务
LLM_CHAT_API_KEY / LLM_CHAT_API_BASE / LLM_CHAT_MODEL    # seed 默认值（会被 system_configs 表覆盖）
LLM_EMBED_API_KEY / LLM_EMBED_API_BASE / LLM_EMBED_MODEL
```
> ⚠️ **LLM/MaxKB/Embedding/OCR 凭证不在环境变量**，存 `system_configs` 表，管理面板（AI 引擎配置）运行时修改。

### 前端
Vite 代理 `/api` 与 `/ws` → `http://localhost:3000`（`frontend/vite.config.ts`）。

---

## 🧪 测试与 CI

| 层 | 框架 | 规模 | 说明 |
|---|---|---|---|
| 后端单测 | Vitest | 47 文件 / 553 用例 | 全 mock 隔离（无 DB/Redis/LLM 依赖），`cd backend && npm test` |
| 前端单测 | Vitest | 14 文件 / 134 用例 | `cd frontend && npm test` |
| E2E | Playwright | e2e/agent-smoke.spec.ts | `baseURL=:5174`，需 `E2E_RUN=1` |

CI（`.github/workflows/ci.yml`）：push main/v2.0 + PR → 前后端 `npm ci` + `vitest run` + 类型检查（`tsc --noEmit` / `vue-tsc --noEmit`）+ 前端 build。

---

## 📝 开发指南

- **Schema 变更**（无 migration 历史）：改 `backend/prisma/schema.prisma` 后 `cd backend && npx prisma db push && npx prisma generate`。
- **重置数据库**：`cd backend && npx prisma db push --force-reset && npx tsx src/seed.ts`。
- **类型检查**：后端 `npx tsc --noEmit`；前端 `npx vue-tsc --noEmit`（⚠️ `npm run build` 不做类型检查）。
- **提交约定**：Conventional Commits 中文风格，scope：`review` / `rules` / `rag` / `frontend` / `api` / `knowledge` / `deploy` / `llm` / `agent`。未明确要求不提交。

---

## ⚠️ 已知问题与风险（2026-08-07 实测）

| 级别 | 问题 | 说明 |
|---|---|---|
| 高 | **误报/采纳无归属校验** | `PATCH /tasks/details/:detailId/{false-positive,adopt}` 仅要求登录，任意用户猜到 detailId 可篡改任意任务结果 |
| 高 | **health/metrics/queue 免认证** | `GET /health`、`POST /cache/clear`、`POST /metrics/reset`、`GET /queue` 等公开可调（有全局限流无认证） |
| 高 | **源文件编码损坏** | `review.service.ts`、`ai-review.service.ts` 存在 GBK/UTF-8 混排乱码（约 4800 个替换字符），运行时可能推送乱码进度 |
| 中 | **dist 与 src 严重漂移** | `backend/dist` 残留 7 个已删路由（agent-test/generation/llm-proxy/polish/promptTemplate/specification-folder/template），容器跑的是 dist——改码后必须 `npm run build` |
| 中 | **离线部署 tag 不一致** | doc-parser 镜像 tag：build-all 用 v1.0、compose 引用 v2.2、images 导出 v2.0；images/ 缺 pgvector/redis tar；compose-files/nginx.conf 是旧版 |
| 中 | **离线包 README 与编排矛盾** | offline-deploy-v6/README 声称"V2.0 移除 MaxKB"，但 compose 仍部署完整 MaxKB 栈 |
| 低 | **文档同步** | `docs/00-索引与说明` 目录号 11 已在索引但磁盘无目录 |

---

## 🔒 许可证

Copyright © 2026. 内部系统，保留所有权利。
