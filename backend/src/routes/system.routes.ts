import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import FileCleanupService from '../services/file-cleanup.service';
import { PythonParserService } from '../services/python-parser.service';
import { redisClient } from '../utils/redis';
import prisma from '../config/db';
import path from 'path';
import { getRuleRegistryMetadata } from '../services/rules';

const router = Router();

async function checkLlmService(configKey: string, displayName: string, endpoint: string, testBody: Record<string, unknown>): Promise<{ name: string; reachable: boolean; error?: string }> {
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: configKey } });
    if (!cfg?.value || typeof cfg.value !== 'object') {
      return { name: displayName, reachable: false, error: '未配置' };
    }
    const v = cfg.value as any;
    if (!v.apiKey) {
      return { name: displayName, reachable: false, error: '未配置' };
    }
    const baseUrl = (v.apiBaseUrl || '').replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${v.apiKey}` },
      body: JSON.stringify({ model: v.modelName || '', ...testBody }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { name: displayName, reachable: false, error: `HTTP ${response.status}: ${errText.slice(0, 100)}` };
    }
    return { name: displayName, reachable: true };
  } catch (e: any) {
    if (e.message?.includes('未配置')) return { name: displayName, reachable: false, error: e.message };
    return { name: displayName, reachable: false, error: e.message?.slice(0, 120) || '连接失败' };
  }
}

router.get('/health', async (_req: Request, res: Response) => {
  const services: Array<{ name: string; reachable: boolean; error?: string }> = [];

  // 1. Python 文档解析服务（原 MarkItDown，已重构为原生Python库解析）
  try {
    const result = await PythonParserService.healthCheck();
    services.push({ name: 'Python 文档解析服务', ...result });
  } catch (e: any) {
    services.push({ name: 'Python 文档解析服务', reachable: false, error: e.message });
  }

  // 2. Redis
  try {
    await redisClient.getClient().ping();
    services.push({ name: 'Redis', reachable: true });
  } catch (e: any) {
    services.push({ name: 'Redis', reachable: false, error: e.message });
  }

  // 3. PostgreSQL
  try {
    await prisma.$queryRaw`SELECT 1`;
    services.push({ name: 'PostgreSQL', reachable: true });
  } catch (e: any) {
    services.push({ name: 'PostgreSQL', reachable: false, error: e.message });
  }

  // 4. LLM 对话模型
  services.push(await checkLlmService('llm_chat_model', 'LLM 对话模型', '/chat/completions', {
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
  }));

  // 5. OCR 文字识别
  services.push(await checkLlmService('llm_ocr_model', 'OCR 文字识别', '/chat/completions', {
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 1,
  }));

  // 6. Embedding 向量化
  services.push(await checkLlmService('embedding_model', 'Embedding 向量化', '/embeddings', {
    input: ['test'],
    encoding_format: 'float',
  }));

  // 7. Reranker 重排序
  services.push(await checkLlmService('reranker_model', 'Reranker 重排序', '/rerank', {
    query: 'test',
    documents: ['test document'],
    top_n: 1,
  }));

  res.json({ code: 200, data: { services } });
});

router.get('/rule-registry', (_req: Request, res: Response) => {
  const meta = getRuleRegistryMetadata();
  res.json({ code: 200, data: meta });
});

router.get('/storage-stats', authenticate, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const uploadsDir = path.join(__dirname, '../../uploads');
    const stats = await FileCleanupService.getStorageStats(uploadsDir);

    res.json({
      code: 200,
      message: 'success',
      data: {
        ...stats,
        totalSizeMB: (stats.totalSize / 1024 / 1024).toFixed(2),
        referencedSizeMB: (stats.referencedSize / 1024 / 1024).toFixed(2),
        orphanedSizeMB: (stats.orphanedSize / 1024 / 1024).toFixed(2),
      }
    });
  } catch (error: any) {
    console.error('获取存储统计失败:', error);
    res.status(500).json({ success: false, message: '获取存储统计失败', error: error.message });
  }
});

router.post('/cleanup-files', authenticate, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const daysOld = parseInt(req.query.days as string) || 7;
    const uploadsDir = path.join(__dirname, '../../uploads');

    const result = await FileCleanupService.cleanupOrphanedFiles(uploadsDir, daysOld);

    res.json({
      code: 200,
      message: `已清理 ${result.deleted} 个孤立文件，释放 ${(result.freedSpace / 1024 / 1024).toFixed(2)} MB 空间`,
      data: result
    });
  } catch (error: any) {
    console.error('清理文件失败:', error);
    res.status(500).json({ success: false, message: '清理文件失败', error: error.message });
  }
});

export default router;
