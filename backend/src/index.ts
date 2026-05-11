import app from './app';
import { env } from './config/env';
import { TerminologyService } from './services/terminology.service';
import { PromptTemplateService } from './services/prompt-template.service';
import { WebSocketService } from './services/websocket.service';
import { closeQueue } from './services/queue.service';

const startServer = async () => {
  try {
    // 初始化术语白名单（从数据库加载到内存缓存）
    await TerminologyService.initialize();

    // 初始化提示词模板（upsert 内置模板，不覆盖用户自定义内容）
    await PromptTemplateService.seedBuiltinTemplates();

    const server = app.listen(env.port, () => {
      console.log(`Server is running in ${env.nodeEnv} mode on port ${env.port}`);
    });

    // 初始化 WebSocket 服务
    WebSocketService.initialize(server);

    // 优雅关闭：处理 SIGTERM/SIGINT
    const shutdown = async (signal: string) => {
      console.log(`\n[${signal}] 收到关闭信号，正在优雅退出...`);
      server.close(async () => {
        await closeQueue();
        console.log('[Shutdown] 服务已关闭');
        process.exit(0);
      });
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
