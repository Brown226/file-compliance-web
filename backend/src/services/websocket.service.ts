import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import prisma from '../config/db';

interface WsClient {
  ws: WebSocket;
  userId: string;
  tasks: Set<string>;
}

/**
 * WebSocket 实时进度推送服务
 * 
 * 功能:
 * 1. 用户连接时通过 JWT 认证
 * 2. 用户可订阅特定任务的进度更新
 * 3. 后端在任务处理过程中主动推送进度
 * 4. 支持心跳保活
 */
export class WebSocketService {
  private static wss: WebSocketServer | null = null;
  private static clients: Map<string, WsClient> = new Map();
  private static taskSubscribers: Map<string, Set<string>> = new Map();

  static initialize(server: any) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url || '', 'http://localhost');
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(1008, 'Missing token');
        return;
      }

      this.handleConnection(ws, token);
    });

    console.log('[WebSocket] Server initialized on /ws');
  }

  private static async handleConnection(ws: WebSocket, token: string) {
    try {
      const jwt = await import('jsonwebtoken');
      const { env } = await import('../config/env');
      const decoded = jwt.verify(token, env.jwtSecret) as any;
      const userId = decoded.id;

      const client: WsClient = { ws, userId, tasks: new Set() };
      const clientId = `${userId}_${Date.now()}`;
      this.clients.set(clientId, client);

      ws.on('message', (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(clientId, client, msg);
        } catch (e) {
          // ignore invalid messages
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        this.removeFromAllTasks(clientId);
      });

      ws.on('error', () => {
        this.clients.delete(clientId);
        this.removeFromAllTasks(clientId);
      });

      // 发送心跳
      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        } else {
          clearInterval(heartbeat);
        }
      }, 30000);

      ws.send(JSON.stringify({
        type: 'connected',
        userId,
        message: 'WebSocket connected',
      }));

      console.log(`[WebSocket] Client connected: ${clientId} (user: ${userId})`);
    } catch (e) {
      ws.close(1008, 'Invalid token');
    }
  }

  private static handleMessage(clientId: string, client: WsClient, msg: any) {
    switch (msg.type) {
      case 'subscribe':
        client.tasks.add(msg.taskId);
        if (!this.taskSubscribers.has(msg.taskId)) {
          this.taskSubscribers.set(msg.taskId, new Set());
        }
        this.taskSubscribers.get(msg.taskId)!.add(clientId);
        client.ws.send(JSON.stringify({
          type: 'subscribed',
          taskId: msg.taskId,
        }));
        break;

      case 'unsubscribe':
        client.tasks.delete(msg.taskId);
        this.removeSubscriber(msg.taskId, clientId);
        client.ws.send(JSON.stringify({
          type: 'unsubscribed',
          taskId: msg.taskId,
        }));
        break;

      case 'pong':
        // heartbeat response
        break;
    }
  }

  /**
   * 推送分片增量审查结果
   * 每个 AI 分片审查完成后立即推送该片的 issues 给前端实时追加展示
   */
  static emitChunkResult(taskId: string, data: {
    fileId: string;
    fileName: string;
    chunkIndex: number;
    totalChunks: number;
    /** 该分片审查出的问题数量 */
    issueCount: number;
    /** 该分片的原始问题数据（供前端直接追加到列表） */
    issues: Array<{
      issueType: string;
      ruleCode: string | null;
      severity: string;
      originalText: string;
      suggestedText: string | null;
      description: string | null;
      standardRef: string | null;
      sourceReferences: any | null;
      matchLevel: number | null;
      similarity: number | null;
      diffRanges: any | null;
      textPosition: any | null;
    }>;
    /** 引擎名称 */
    engine: string;
  }) {
    const subscribers = this.taskSubscribers.get(taskId);
    if (!subscribers || subscribers.size === 0) return;

    const payload = JSON.stringify({
      type: 'chunk_result',
      taskId,
      ...data,
      timestamp: Date.now(),
    });

    subscribers.forEach(clientId => {
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(payload);
        } catch (e) {
          this.removeSubscriber(taskId, clientId);
        }
      }
    });
  }

  /**
   * 推送任务进度给所有订阅者
   */
  static emitTaskProgress(taskId: string, data: {
    type: string;
    step?: string;
    progress?: number;
    message?: string;
    fileName?: string;
    errorCount?: number;
    result?: any;
    phase?: string;        // 'phase1' | 'phase2'
    ruleCount?: number;    // 阶段1规则问题数
    stdRefCount?: number;  // 阶段1标准引用问题数
    aiCount?: number;      // 阶段2 AI 问题数
    usedEngine?: string;   // 阶段2使用引擎
    timestamp?: number;
  }) {
    const subscribers = this.taskSubscribers.get(taskId);
    if (!subscribers || subscribers.size === 0) return;

    const payload = JSON.stringify({
      type: 'task_progress',
      taskId,
      progressType: data.type,
      step: data.step,
      progress: data.progress,
      message: data.message,
      fileName: data.fileName,
      errorCount: data.errorCount,
      result: data.result,
      timestamp: data.timestamp || Date.now(),
    });

    subscribers.forEach(clientId => {
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(payload);
        } catch (e) {
          this.removeSubscriber(taskId, clientId);
        }
      }
    });
  }

  /**
   * 推送通知给特定用户
   */
  static emitToUser(userId: string, data: {
    type: string;
    title: string;
    message: string;
    [key: string]: any;
  }) {
    this.clients.forEach((client, clientId) => {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(JSON.stringify({
            type: 'notification',
            notificationType: data.type,
            title: data.title,
            message: data.message,
            timestamp: Date.now(),
          }));
        } catch (e) {
          // ignore
        }
      }
    });
  }

  private static removeSubscriber(taskId: string, clientId: string) {
    const subscribers = this.taskSubscribers.get(taskId);
    if (subscribers) {
      subscribers.delete(clientId);
      if (subscribers.size === 0) {
        this.taskSubscribers.delete(taskId);
      }
    }
  }

  private static removeFromAllTasks(clientId: string) {
    this.taskSubscribers.forEach((subscribers, taskId) => {
      subscribers.delete(clientId);
      if (subscribers.size === 0) {
        this.taskSubscribers.delete(taskId);
      }
    });
  }

  /**
   * 获取当前连接数（用于监控）
   */
  static getStats() {
    return {
      totalConnections: this.clients.size,
      totalTaskSubscriptions: this.taskSubscribers.size,
      tasksWithSubscribers: Array.from(this.taskSubscribers.keys()),
    };
  }
}
