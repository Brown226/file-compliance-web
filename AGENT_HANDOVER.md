# Agent 审查助手 · 项目交接文档

> 生成日期：2026-08-11（由 AI 助手在会话结束时写入，供新会话直接接手）
> 用途：新会话启动后先读本文件，即可无缝接续工作。

---

## 1. 项目概览

- **项目名称**：file-compliance-web（文件合规审查系统，内网部署，v2.0）
- **核心业务**：合同/文件合规审查。包含通用审查、专业审查（合同/图纸等）、Agent 智能审查助手、模型配置等模块。
- **技术栈**：
  - 前端：Vue 3 + Vite + TypeScript + Element Plus + pinia + vue-router + ai-sdk v4（`useChat` 流式）
  - 后端：Node.js + Express + TypeScript + Prisma + Redis + WebSocket（ts-node-dev 运行）
  - 数据库：PostgreSQL（Prisma ORM）
- **参考项目**（Agent 界面复刻对象）：`可参考开源项目/Agent参考项目/pi-web-0.8.5`（Next.js 开源项目，本地已有源码）

---

## 2. 服务启动方式

```bash
# 后端（端口 3000）
cd E:/工作/file-compliance-web/backend && npm run dev

# 前端（端口 5173）
cd E:/工作/file-compliance-web/frontend && npm run dev
```

- 依赖：PostgreSQL + Redis 需先行（后端启动日志会显示连接状态）。
- 验证：`curl http://localhost:3000/api/health`；页面访问 `http://localhost:5173/agent`。
- 登录测试账号：`admin / Admin@12345`（种子账号）。
- **注意**：新会话接手时，若前端 :5173 无响应（000），先启动前端；后端健康检查显示 `embedding: false` 属已知遗留（见 §6）。

---

## 3. Agent 界面关键文件索引

| 文件 | 职责 |
|---|---|
| `frontend/src/views/Agent/AgentChat.vue` | Agent 工作台主页面（三栏布局/消息渲染/过程折叠/顶栏） |
| `frontend/src/views/Agent/agent-theme.css` | Agent 主题变量（`--accent` 等）与全局样式 |
| `frontend/src/views/Agent/components/ChatInputArea.vue` | 输入容器 + 控制条（思考/连接知识库/压缩 + 5 个自绘 SVG 图标） |
| `frontend/src/views/Agent/components/ChatMinimap.vue` | 消息滚动迷你导航（turn 分组/聚焦线/hover 预览/拖拽跳转） |
| `frontend/src/views/Agent/components/ToolCallChip.vue` | 工具调用块（状态色边框/预览/duration/配对 result） |
| `frontend/src/views/Agent/components/AgentSessionList.vue` | 左栏会话列表 + 底部「模型/技能/记忆」按钮 |
| `frontend/src/views/Agent/components/AgentSidePanel.vue` | 右栏纯文件查看器（TabBar + FileViewer） |
| `frontend/src/views/Agent/components/AgentFileViewer.vue` | 右栏文件预览（markdown/图片/PDF） |
| `frontend/src/views/Agent/components/ModelsConfig.vue` | Models 弹窗薄封装（核心在公共组件） |
| `frontend/src/components/provider-config/ProviderConfigPanel.vue` | **Models 配置核心**（1095 行，两级树 + 详情编辑器，mode=dialog/inline 双形态） |
| `frontend/src/composables/useAgentChat.ts` | 聊天组合函数（startNewSession/loadHistory 工具还原/toolPreset 默认 full） |
| `frontend/src/api/agent.ts` | Agent 相关 API 定义 |
| `backend/src/routes/agent.routes.ts` | Agent 路由（chat/stream、sessions、providers、files/read 等） |
| `backend/src/services/agent/agent.service.ts` | 聊天流式核心（onFinish 工具调用持久化 debug.toolCalls） |
| `backend/src/services/agent/qa-session.service.ts` | 会话持久化（persistAssistantMessage 等） |

---

## 4. 已完成工作（本会话主线：Agent 界面对齐 pi-web 0.8.5）

### 4.1 UI 全面对齐（已提交并推送 origin/v2.0）
- **布局**：三栏工作台；主侧栏全局默认折叠；右面板宽度 `clamp(360,42vw,640)`；左右分界线 1px；收起按钮同系列面板图标
- **消息区**：用户消息 markdown 渲染 + 气泡内容自适应（`#eff6ff` 底 + 蓝边框 + 12px 圆角）；助手平铺 + 模型标签行 + 底部操作行（hover 复制按钮 + 时间戳）
- **工具调用块**：ToolCallChip 对齐参考 ToolCallBlock（成功 `#16a34a` 绿/错误红边框、toolName 中文映射 + 等宽字体、输入预览、duration、chevron、配对 result 一体显示）
- **ProcessDetailsGroup**：历史消息的 thinking + 工具调用整体折叠为「过程详情 · N 条消息 · M 次工具调用」（默认折叠、点击展开、流式尾部默认展开）
- **ChatMinimap**：一比一复刻（turn 分组布局、30% 聚焦线激活、1600ms 导航锁定、hover 预览、拖拽跳转、不可滚动自动隐藏）
- **输入区**：820px 宽、textarea 最小高 48px/最大 220px；控制条左侧「上传+模型」/右侧「思考·默认｜连接知识库｜压缩上下文」；5 个图标全部自绘 SVG；下拉带描述文字；勾选 10×10 自绘勾
- **左栏**：54px 会话项 + 2px accent 竖条 + 行内重命名/删除确认 + 底部「模型/技能/记忆」三按钮（弹窗形式）
- **右栏**：纯文件查看器（文件 tab + 业务功能迁移为弹窗）
- **Models 弹窗**：860px 双栏、provider 树 + 详情编辑器、连接测试、AddProviderPicker、保存链路（复用 `llm_profiles`，零后端存储改动）

### 4.2 功能合并
- 「对话 / 知识问答」两种模式合并为单一界面：顶栏无模式切换；知识问答收敛为「**连接知识库**」开关按钮（默认全部工具 `toolPreset='full'`，点击进入 `qa` 仅启用 `search_knowledge`）

### 4.3 关键 Bug 修复（均已验证）
| 问题 | 根因 | 修复 |
|---|---|---|
| 工具调用过程不显示 | ① ToolCallChip 读错字段（工具名嵌在 `type`）；② ai-sdk v4 `useChat` messages 是 shallowRef，part 原地修改不触发重渲染；③ 后端不持久化工具调用；④ 兜底路径用了不存在的 API | ① 从 `type` 解析工具名；② 流结束强制重建 part 触发渲染；③ 后端 `extractToolCallsFromSteps` 存 `debug.toolCalls` + 前端 loadHistory 还原；④ 改用 `pipeUIMessageStreamToResponse` |
| 新建对话无历史记录 | 前端 `clearSession` 置空 sessionId + 数据库 `llm_chat_model` 配置损坏（缺 providerId、value 存成字符串）导致对话 500 | ① `startNewSession()` 生成 UUID sessionId；② 修复 `llm_chat_model` 配置（补 providerId、value 改对象存储） |
| 工具结果不能一键折叠 | 缺 ProcessDetailsGroup | 已实现（见 4.1） |

### 4.4 代码交付状态
- 本会话共 5 批提交已推送到 `origin/v2.0`：① artifacts 忽略 ② Agent UI 全面对齐（14 文件 +4319/-1332）③ 后端能力增强（11 文件）④ 模型配置重构 ⑤ 前端基础设施
- `artifacts/` 已加入 `.gitignore`（验证截图与 Playwright 脚本不入库）

---

## 5. ⚠️ 当前工作区未提交改动（接手时注意）

接手时 `git status` 显示以下 5 个后端文件**已修改但未提交**（属后续其他工作，非本会话 Agent UI 改动，内容涉及合同审查法条存疑标记、人工复核权限、review 去重修复等）：

```
M backend/src/services/agent/tools/knowledge/index.ts
M backend/src/services/agent/tools/knowledge/search_rule_library.ts
M backend/src/services/agent/tools/knowledge/search_standard_checkpoints.ts
M backend/src/services/prompts/registry.ts
M backend/src/services/review-pipeline/review-handlers.ts
```

建议新会话接手后先与大王确认这批改动的提交/处理方式。

---

## 6. 遗留事项（按优先级）

1. **embedding 服务不可用**（健康检查 `embedding: false`，`status: degraded`）——影响「连接知识库」的 `search_knowledge` 向量检索。已确认 database/reranker/cache 正常。**未排查**，接手时优先处理。
2. **`llm_chat_model` 配置修复的根因未深挖**：`value` 曾存成字符串 + 缺 providerId。修复方式是直接改库（补 providerId 指向 CNPE profile、value 改对象）。**建议检查系统设置页保存默认模型后是否还会覆盖回错误格式**。
3. **ProcessDetailsGroup 流式尾部默认展开**（`isStreamingTail` 逻辑）未经确定性实测（mock 环境无法模拟 isLoading），需真实对话验证。
4. **assistant usage 行**（tokens in/out 统计）未接入——依赖后端 usage 数据。
5. **工具块 duration 显示**：当前依赖 `output.durationMs`，参考项目是独立耗时计算，可能不显示耗时（功能细节，未深挖）。

---

## 7. 验证手段备忘（Playwright）

- 验证脚本在 `artifacts/agent-ui-check/*.py`（已 gitignore，不入库，但保留在磁盘）
- **mock 要点**：
  - 登录：先 POST `/api/auth/login`（admin/Admin@12345）拿 token，注入 localStorage key `user`（pinia persist 格式：`{"token": "...", "userInfo": {...}}`）
  - Playwright `route` 匹配必须用 **`urlparse(path).path.startswith('/api/')`**（注意 path 带 `/api` 前缀），不能用 `startswith("/agent/...")`
  - 历史消息 mock 结构：`{code:200, data: [{id, role, content, createdAt, debug:{toolCalls:[...]}}]}`，`loadHistory` 从 `debug.toolCalls` 还原 tool parts
  - **坑**：route glob 勿用 `**/api/**`（会误拦 `/src/api/agent.ts` Vite 模块）
- 前端构建：`cd frontend && npm run build`（约 1 分钟，仅原有 chunk 体积 warning）
- 后端语法：`cd backend && npx tsc --noEmit`（通过）

---

## 8. 其他备注

- 后端 `getLlmConfig()` 有 5 分钟模块级缓存，改库后需 touch 源文件或重启进程清缓存。
- 兜底路径 `chatWithGenerateText` 已修复流式事件（`pipeUIMessageStreamToResponse`），该路径无调用方（死代码保留能力），主链路在路由层。
- 页面崩溃排查经验：`stats.tokens.input` 无 `?.` 守卫会导致整页白屏（已修复，后续新增模板访问建议加守卫）。
- 模型路由：`llm_chat_model.providerId` 引用 `llm_profiles`，保存 Models 配置时必须保留 `profile.provider` 原值（8+ 处服务共享消费）。
