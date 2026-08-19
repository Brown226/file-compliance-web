/**
 * Agent 文件系统路由 — 授权目录浏览（文件树）
 *
 * 端点（挂载于 /api/agent）：
 *   GET /directories/browse — 浏览授权目录（受 AGENT_ALLOWED_DIRS 白名单约束）
 *
 * 本文件由 agent.routes.ts 拆分而来（P2-2），代码行为与原实现一致。
 */

import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { getUploadDir } from '../../config/upload';

const router = Router();

// ===== 文件树/目录浏览（任务 8）=====

/**
 * 目录白名单（AGENT_ALLOWED_DIRS，逗号分隔的绝对路径，支持 ~ 展开主目录）
 * 未配置时回退到 backend/uploads/agent_temp/{userId}（当前用户临时目录）
 */
const IGNORED_DIR_NAMES = new Set([
  'node_modules', '.git', '.next', '.nuxt', '.venv', 'venv', 'env',
  'dist', 'build', 'out', 'coverage', '.cache', '__pycache__', '.idea', '.vscode',
]);

/** 解析 AGENT_ALLOWED_DIRS 环境变量为规范化绝对路径数组 */
function getAllowedDirRoots(userId: string): string[] {
  const raw = process.env.AGENT_ALLOWED_DIRS;
  const list: string[] = [];
  if (raw && raw.trim()) {
    for (const item of raw.split(',')) {
      const t = item.trim();
      if (!t) continue;
      const expanded = t.startsWith('~/')
        ? path.join(process.env.HOME || process.env.USERPROFILE || '', t.slice(2))
        : t;
      list.push(path.resolve(expanded));
    }
  }
  // 回退：当前用户 agent_temp 目录
  if (list.length === 0) {
    list.push(path.resolve(path.join(getUploadDir(), 'agent_temp', userId)));
  }
  return list;
}

/** 判断路径是否在某个允许根目录内（严格前缀 + path.sep，防路径穿越） */
function isWithinAllowedRoot(resolvedPath: string, roots: string[]): boolean {
  return roots.some((root) => {
    const normalizedRoot = path.resolve(root);
    return resolvedPath === normalizedRoot || resolvedPath.startsWith(normalizedRoot + path.sep);
  });
}

/**
 * GET /api/agent/directories/browse — 浏览授权目录（受白名单约束）
 *
 * Query:
 *   - path?: string — 要列出的目录绝对路径；缺省返回白名单根目录列表
 *
 * 返回：{ success, data: { roots: [...], root: string|null, entries: [...] } }
 *   - roots: 白名单根目录列表（[{ name, path }]）
 *   - root: 当前浏览的根目录路径（path 缺省时为 null）
 *   - entries: 目录条目列表（[{ name, path, type: 'dir'|'file', size, mtime }]）
 *
 * 安全约束：
 *   - path 必须位于某个允许根目录内（AGENT_ALLOWED_DIRS 或 agent_temp/{userId}）
 *   - 忽略 node_modules/.git/.next 等目录
 *   - 目录不存在/越权返回 404/403
 */
router.get('/directories/browse', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;

    const roots = getAllowedDirRoots(userId);
    // 缺省 path → 返回白名单根目录列表
    const rawPath = (req.query.path as string) || '';
    if (!rawPath) {
      const rootEntries = roots.map((root) => ({
        name: path.basename(root) || root,
        path: root,
      }));
      return res.json({ success: true, data: { roots: rootEntries, root: null, entries: [] } });
    }

    const resolvedRaw = path.resolve(rawPath);
    // 越权校验：必须在某个允许根目录内
    if (!isWithinAllowedRoot(resolvedRaw, roots)) {
      return res.status(403).json({ success: false, message: '无权浏览该目录（不在白名单内）' });
    }

    if (!fs.existsSync(resolvedRaw)) {
      return res.status(404).json({ success: false, message: '目录不存在' });
    }
    // realpath 二次校验：symlink 解析后的真实路径也必须位于白名单内
    let resolved: string;
    try {
      resolved = fs.realpathSync(resolvedRaw);
    } catch {
      return res.status(404).json({ success: false, message: '目录不存在' });
    }
    if (!isWithinAllowedRoot(resolved, roots)) {
      return res.status(403).json({ success: false, message: '无权浏览该目录（符号链接指向白名单外）' });
    }
    if (!fs.statSync(resolved).isDirectory()) {
      return res.status(404).json({ success: false, message: '目录不存在' });
    }

    let names: string[] = [];
    try {
      names = fs.readdirSync(resolved);
    } catch (e: any) {
      return res.status(500).json({ success: false, message: `读取目录失败: ${e?.message || e}` });
    }
    // 超大目录条目上限：防止同步 readdirSync + stat 全量阻塞事件循环
    if (names.length > 2000) {
      names = names.slice(0, 2000);
    }

    // 排序：目录在前，文件在后，各自按名称字母序
    const entries: Array<{ name: string; path: string; type: 'dir' | 'file'; size: number; mtime: string }> = [];
    for (const name of names) {
      const full = path.join(resolved, name);
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue; // 单个条目 stat 失败（如权限）跳过
      }
      if (stat.isDirectory()) {
        if (IGNORED_DIR_NAMES.has(name)) continue; // 忽略 node_modules/.git 等
        entries.push({ name, path: full, type: 'dir', size: 0, mtime: stat.mtime.toISOString() });
      } else if (stat.isFile()) {
        entries.push({ name, path: full, type: 'file', size: stat.size, mtime: stat.mtime.toISOString() });
      }
    }
    entries.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));

    return res.json({
      success: true,
      data: {
        roots: roots.map((root) => ({ name: path.basename(root) || root, path: root })),
        root: resolved,
        entries,
      },
    });
  } catch (e: any) {
    console.error('[Agent] 目录浏览失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `目录浏览失败: ${e?.message || e}` });
  }
});

export default router;
