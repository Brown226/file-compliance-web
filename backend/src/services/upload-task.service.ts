/**
 * 简易内存任务追踪器 — 用于文档上传异步处理
 * 生产环境可替换为 Redis/Bull 队列
 */

export interface UploadTaskStatus {
  id: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;      // 0-100
  message: string;
  chunks?: number;
  error?: string;
  createdAt: number;
}

const tasks = new Map<string, UploadTaskStatus>();

export class UploadTaskService {
  static createTask(fileName: string): string {
    const id = `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    tasks.set(id, {
      id,
      fileName,
      status: 'pending',
      progress: 0,
      message: '等待处理...',
      createdAt: Date.now(),
    });
    // 自动清理 30 分钟前的任务
    for (const [key, task] of tasks) {
      if (Date.now() - task.createdAt > 30 * 60 * 1000) tasks.delete(key);
    }
    return id;
  }

  static updateTask(id: string, update: Partial<UploadTaskStatus>) {
    const task = tasks.get(id);
    if (task) Object.assign(task, update);
  }

  static getTask(id: string): UploadTaskStatus | undefined {
    return tasks.get(id);
  }

  static getTasks(): UploadTaskStatus[] {
    return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
}
