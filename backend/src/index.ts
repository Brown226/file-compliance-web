import app from './app';
import { env } from './config/env';
import { TerminologyService } from './services/standard/terminology.service';
import { PromptTemplateService } from './services/llm/prompt-template.service';
import { WebSocketService } from './services/system/websocket.service';
import { initQueueProcessors, closeQueue } from './services/system/queue.service';
import { startScheduler } from './services/system/scheduler.service';
import { presenceService } from './services/system/presence.service';
import prisma from './config/db';
import { setUploadDir, initUploadSubdirs, getUploadDir } from './config/upload';
import type { Server } from 'http';

// 进程角色：all（默认，单进程 API+Worker）/ api（仅 HTTP+WS）/ worker（仅队列+定时任务）
const role = env.processRole;
const runApi = role === 'all' || role === 'api';
const runWorker = role === 'all' || role === 'worker';

const startServer = async () => {
  try {
    console.log(`[Bootstrap] 进程角色: ${role} (API=${runApi}, Worker=${runWorker})`);

    // 从数据库加载存储路径配置（API 与 Worker 均需要）
    const uploadPathCfg = await prisma.systemConfig.findUnique({ where: { key: 'upload_path' } });
    if (uploadPathCfg?.value && typeof uploadPathCfg.value === 'string') {
      setUploadDir(uploadPathCfg.value);
      initUploadSubdirs(uploadPathCfg.value);
      console.log(`[Upload] DB 配置存储路径: ${uploadPathCfg.value}`);
    } else {
      initUploadSubdirs(getUploadDir());
    }

    // 初始化术语白名单（内存缓存，API 术语接口与 Worker 审查均需要）
    await TerminologyService.initialize();

    // 初始化提示词模板（幂等 upsert，不覆盖用户自定义内容）
    await PromptTemplateService.seedBuiltinTemplates();

    // 迁移旧的 LLM 凭证副本配置为 Provider 引用（幂等，已迁移则跳过）
    const { migrateLlmConfigsToProviderRef } = await import('./services/llm/profile-migration.service');
    await migrateLlmConfigsToProviderRef();

    // ===== API 角色：启动 HTTP 服务 + WebSocket =====
    let server: Server | undefined;
    if (runApi) {
      server = app.listen(env.port, () => {
        console.log(`Server is running in ${env.nodeEnv} mode on port ${env.port}`);
      });
      WebSocketService.initialize(server);
      // 启动 presence 兜底清理任务（每 60 秒清理过期的在线会话）
      presenceService.startCleanupTimer();
    } else {
      console.log('[Bootstrap] worker 角色：跳过 HTTP/WebSocket 启动');
    }

    // ===== Worker 角色：启动审查队列处理器 + 定时清理 =====
    if (runWorker) {
      await initQueueProcessors().catch((e) => console.error('[Queue] 初始化失败:', e));
      startScheduler();
      console.log('[Bootstrap] worker 已启动：审查队列处理器 + 定时清理');
    } else {
      console.log('[Bootstrap] api 角色：不消费审查队列（仅入队）');
    }

    // 优雅关闭：处理 SIGTERM/SIGINT
    const shutdown = async (signal: string) => {
      console.log(`\n[${signal}] 收到关闭信号，正在优雅退出...`);
      const finalize = async () => {
        await closeQueue();
        presenceService.stopCleanupTimer();
        console.log('[Shutdown] 服务已关闭');
        process.exit(0);
      };
      if (server) {
        server.close(finalize);
      } else {
        await finalize();
      }
      // 10秒后强制退出
      setTimeout(() => process.exit(1), 10000);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
