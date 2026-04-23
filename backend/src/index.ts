import app from './app';
import { env } from './config/env';
import { TerminologyService } from './services/terminology.service';
import { PromptTemplateService } from './services/prompt-template.service';
import { WebSocketService } from './services/websocket.service';

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
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
