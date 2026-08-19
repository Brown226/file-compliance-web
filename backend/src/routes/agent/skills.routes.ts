/**
 * Agent 技能路由 — Skills（SKILL.md 场景化能力）+ Worktree（多任务规划工作区）
 *
 * 端点（挂载于 /api/agent）：
 *   GET    /skills          — 列出全部 skills（含禁用）
 *   GET    /skills/:name    — 单个 skill 详情
 *   POST   /skills          — 新建 skill（仅 ADMIN）
 *   PUT    /skills/:name    — 更新 skill（仅 ADMIN）
 *   PATCH  /skills/:name    — 启用/禁用（仅 ADMIN）
 *   DELETE /skills/:name    — 删除 skill（仅 ADMIN）
 *   GET    /worktrees       — 列出全部 worktree（仅 ADMIN）
 *   POST   /worktrees       — 新建 worktree（仅 ADMIN）
 *   DELETE /worktrees       — 删除 worktree（仅 ADMIN）
 *
 * 本文件由 agent.routes.ts 拆分而来（P2-2），代码行为与原实现一致。
 */

import { Router, Response } from 'express';
import { AuthRequest } from '../../middlewares/auth.middleware';
import { requireRole } from '../../middlewares/rbac.middleware';
import { SkillsService } from '../../services/agent/skills/skills.service';
import { WorktreeService } from '../../services/agent/worktree/worktree.service';

const router = Router();

// ===== Skills 管理（2026-08-03 新增：场景化能力 = SKILL.md）=====

/**
 * GET /api/agent/skills — 列出全部 skills（含禁用）
 */
router.get('/skills', async (_req: AuthRequest, res: Response) => {
  try {
    const skills = SkillsService.listSkills();
    return res.json({ success: true, data: skills });
  } catch (e: any) {
    console.error('[Agent] 列出 skills 失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `列出 skills 失败: ${e?.message || e}` });
  }
});

/**
 * GET /api/agent/skills/:name — 单个 skill 详情
 */
router.get('/skills/:name', async (req: AuthRequest, res: Response) => {
  try {
    const skill = SkillsService.getSkill(String(req.params.name || ''));
    if (!skill) return res.status(404).json({ success: false, message: 'skill 不存在' });
    return res.json({ success: true, data: skill });
  } catch (e: any) {
    console.error('[Agent] 读取 skill 失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `读取 skill 失败: ${e?.message || e}` });
  }
});

/**
 * POST /api/agent/skills — 新建 skill
 * Body: { name, description, content }
 * 仅管理员可写（普通用户只读）
 */
router.post('/skills', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, content } = req.body || {};
    if (!name || !content) {
      return res.status(400).json({ success: false, message: 'name 和 content 必填' });
    }
    const skill = SkillsService.createSkill({ name, description: description || '', content });
    return res.json({ success: true, data: skill });
  } catch (e: any) {
    console.error('[Agent] 新建 skill 失败:', e?.message || e);
    return res.status(400).json({ success: false, message: `新建 skill 失败: ${e?.message || e}` });
  }
});

/**
 * PUT /api/agent/skills/:name — 更新 skill
 * Body: { description?, content? }
 * 仅管理员可写（普通用户只读）
 */
router.put('/skills/:name', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { description, content } = req.body || {};
    const skill = SkillsService.updateSkill(String(req.params.name || ''), { description, content });
    return res.json({ success: true, data: skill });
  } catch (e: any) {
    console.error('[Agent] 更新 skill 失败:', e?.message || e);
    return res.status(400).json({ success: false, message: `更新 skill 失败: ${e?.message || e}` });
  }
});

/**
 * PATCH /api/agent/skills/:name — 启用/禁用
 * Body: { enabled: boolean }
 * 仅管理员可写（普通用户只读）
 */
router.patch('/skills/:name', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'enabled 必须为布尔值' });
    }
    const skill = SkillsService.setSkillEnabled(String(req.params.name || ''), enabled);
    return res.json({ success: true, data: skill });
  } catch (e: any) {
    console.error('[Agent] 切换 skill 失败:', e?.message || e);
    return res.status(400).json({ success: false, message: `切换 skill 失败: ${e?.message || e}` });
  }
});

/**
 * DELETE /api/agent/skills/:name — 删除 skill
 * 仅管理员可写（普通用户只读）
 */
router.delete('/skills/:name', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    SkillsService.deleteSkill(String(req.params.name || ''));
    return res.json({ success: true, data: null });
  } catch (e: any) {
    console.error('[Agent] 删除 skill 失败:', e?.message || e);
    return res.status(400).json({ success: false, message: `删除 skill 失败: ${e?.message || e}` });
  }
});

// ===== Worktree 管理（2026-08-03 新增：Agent 多任务规划工作区）=====

/**
 * GET /api/agent/worktrees — 列出全部 worktree
 * 仅管理员可查看（worktree 是项目级 git 共享资源）
 */
router.get('/worktrees', requireRole('ADMIN'), async (_req: AuthRequest, res: Response) => {
  try {
    const list = await WorktreeService.listWorktrees();
    return res.json({ success: true, data: list });
  } catch (e: any) {
    console.error('[Agent] 列出 worktree 失败:', e?.message || e);
    return res.status(500).json({ success: false, message: `列出 worktree 失败: ${e?.message || e}` });
  }
});

/**
 * POST /api/agent/worktrees — 新建 worktree（新分支）
 * Body: { branch: string }
 * 仅管理员可创建（项目级 git 共享资源）
 */
router.post('/worktrees', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const { branch } = req.body || {};
    if (!branch) {
      return res.status(400).json({ success: false, message: 'branch 必填' });
    }
    const worktree = await WorktreeService.addWorktree(String(branch));
    return res.json({ success: true, data: worktree });
  } catch (e: any) {
    console.error('[Agent] 新建 worktree 失败:', e?.message || e);
    return res.status(400).json({ success: false, message: `新建 worktree 失败: ${e?.message || e}` });
  }
});

/**
 * DELETE /api/agent/worktrees?path=<绝对路径> — 删除 worktree（仅限非主工作区）
 * 仅管理员可删除（项目级 git 共享资源）
 */
router.delete('/worktrees', requireRole('ADMIN'), async (req: AuthRequest, res: Response) => {
  try {
    const targetPath = String(req.query.path || '');
    if (!targetPath) {
      return res.status(400).json({ success: false, message: 'path 必填（query 参数）' });
    }
    await WorktreeService.removeWorktree(targetPath);
    return res.json({ success: true, data: null });
  } catch (e: any) {
    console.error('[Agent] 删除 worktree 失败:', e?.message || e);
    return res.status(400).json({ success: false, message: `删除 worktree 失败: ${e?.message || e}` });
  }
});

export default router;
