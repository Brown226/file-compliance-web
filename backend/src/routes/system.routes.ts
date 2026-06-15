import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { requireRole } from '../middlewares/rbac.middleware';
import FileCleanupService from '../services/file-cleanup.service';
import { PythonParserService } from '../services/python-parser.service';
import { redisClient } from '../utils/redis';
import prisma from '../config/db';
import path from 'path';
import fs from 'fs';
import { getRuleRegistryMetadata } from '../services/rules';
import { getUploadPath, getUploadDir, getUploadInfo, setUploadDir, initUploadSubdirs } from '../config/upload';

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

  res.json({ code: 200, data: { services } });
});

router.get('/rule-registry', (_req: Request, res: Response) => {
  const meta = getRuleRegistryMetadata();
  res.json({ code: 200, data: meta });
});

router.get('/storage-stats', authenticate, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const stats = await FileCleanupService.getStorageStats(getUploadPath());

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
    const result = await FileCleanupService.cleanupOrphanedFiles(getUploadPath(), daysOld);

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

// 获取当前存储路径配置
router.get('/config-path', authenticate, requireRole('ADMIN'), async (_req: Request, res: Response) => {
  res.json({ code: 200, data: getUploadInfo() });
});

// 设置存储路径
router.put('/config-path', authenticate, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const { path: newPath } = req.body;
    if (!newPath || typeof newPath !== 'string' || (!newPath.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(newPath))) {
      res.status(400).json({ code: 400, message: '路径必须为以 / 或 X:\\ 开头的绝对路径' });
      return;
    }

    const resolved = path.resolve(newPath);

    // 校验路径可写
    try {
      if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
      const testFile = path.join(resolved, '.write-test-' + Date.now());
      fs.writeFileSync(testFile, '');
      fs.unlinkSync(testFile);
    } catch (e: any) {
      res.status(400).json({ code: 400, message: '路径不可写: ' + e.message });
      return;
    }

    const oldPath = getUploadDir();

    // 统计旧路径文件数
    let filesAtOldPath = 0;
    try {
      filesAtOldPath = FileCleanupService.getPhysicalFiles(oldPath).size;
    } catch { /* 忽略 */ }

    // 写入 DB
    await prisma.systemConfig.upsert({
      where: { key: 'upload_path' },
      update: { value: resolved },
      create: { key: 'upload_path', value: resolved },
    });

    // 热更新内存
    setUploadDir(resolved);

    // 初始化子目录
    initUploadSubdirs(resolved);

    res.json({
      code: 200,
      message: '存储路径已更新',
      data: {
        oldPath,
        newPath: resolved,
        filesAtOldPath,
        warning: filesAtOldPath > 0
          ? `旧路径下仍有 ${filesAtOldPath} 个文件未被迁移，更改后将无法通过 /uploads/ 访问。建议使用迁移脚本 scripts/migrate-uploads.js 处理。`
          : '',
      },
    });
  } catch (e: any) {
    console.error('设置存储路径失败:', e);
    res.status(500).json({ code: 500, message: '设置存储路径失败: ' + e.message });
  }
});

export default router;
