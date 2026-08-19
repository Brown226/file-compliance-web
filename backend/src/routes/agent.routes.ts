/**
 * Agent 路由汇总 — 基于 Vercel AI SDK v7 的 Agentic 审查引擎对外端点
 *
 * P2-2 拆分：原单文件 2164 行按域拆分为 routes/agent/ 下 8 个子路由文件，
 * 本文件保留为汇总入口（挂载路径 /api/agent 不变，app.ts 与既有测试引用不受影响）：
 *   - chat.routes.ts       — POST /chat/stream、POST /upload、GET /files/read
 *   - session.routes.ts    — /sessions 系列（CRUD/消息/统计/自动命名/压缩/挂起提问）
 *   - memory.routes.ts     — /memory、/steer、/summary
 *   - skills.routes.ts     — /skills、/worktrees
 *   - model.routes.ts      — /models、/providers（含 discover/catalog/test）
 *   - feedback.routes.ts   — /issues/false-positive、/saves、/search
 *   - filesystem.routes.ts — /directories/browse
 *   - batch.routes.ts      — /batch 系列
 *
 * 约定（与项目既有路由一致）：
 *   - 用 `import` 引入项目内部模块 + Node 内置模块 + 类型化第三方包
 *   - AgentService 内部用 `require` 引入 ESM-only 的 ai / @ai-sdk/openai
 */

import { Router } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import chatRoutes from './agent/chat.routes';
import sessionRoutes from './agent/session.routes';
import memoryRoutes from './agent/memory.routes';
import skillsRoutes from './agent/skills.routes';
import modelRoutes from './agent/model.routes';
import feedbackRoutes from './agent/feedback.routes';
import filesystemRoutes from './agent/filesystem.routes';
import batchRoutes from './agent/batch.routes';

const router = Router();

// 所有 Agent 接口都需要认证（对全部子路由生效）
router.use(authenticate);

// 按域挂载子路由（路径保持原样，最终拼在 /api/agent 下）
router.use(chatRoutes);
router.use(sessionRoutes);
router.use(memoryRoutes);
router.use(skillsRoutes);
router.use(modelRoutes);
router.use(feedbackRoutes);
router.use(filesystemRoutes);
router.use(batchRoutes);

// re-export：SSRF 防护函数供单元测试直接引用（agent-ssrf.test.ts 从本文件导入）
export { assertSafeFetchUrl } from './agent/model.routes';

export default router;
