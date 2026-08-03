/**
 * Worktree 服务 — git worktree 管理（2026-08-03 新增）
 *
 * 用途：Agent 自主拆分任务规划时，可为每个任务创建独立 git 工作区（分支级隔离）。
 * 基于真 git worktree：`git worktree add -b <branch> <dir>`，与 pi-web 的 worktree
 * 语义一致（工作区建在 <repoRoot>-worktrees/<branch>）。
 *
 * 配置：环境变量 AGENT_REPO_ROOT 指向主仓库路径（可选）。未配置时列表为空、
 * 创建/删除报错提示，不影响 Agent 其他功能。
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  /** 工作区绝对路径 */
  path: string;
  /** 分支名 */
  branch: string;
  /** HEAD commit 短哈希 */
  head: string;
  /** 是否主工作区 */
  isMain: boolean;
}

const BRANCH_RE = /^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/;

function getRepoRoot(): string | null {
  const r = process.env.AGENT_REPO_ROOT;
  return r && r.trim() ? r.trim() : null;
}

/** 工作区根：<repoRoot 同级的父目录>/<repoName>-worktrees */
function getWorktreesRoot(repo: string): string {
  return path.join(path.dirname(repo), `${path.basename(repo)}-worktrees`);
}

function sanitizeBranch(branch: string): string {
  const b = branch.trim();
  if (!BRANCH_RE.test(b)) {
    throw new Error(`非法分支名：${branch}（允许字母/数字/./_/-，不能以 - 开头）`);
  }
  return b;
}

async function git(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: cwd || getRepoRoot() || undefined,
    timeout: 15000,
  });
  return stdout;
}

export class WorktreeService {
  /** 列出全部 worktree（含主工作区） */
  static async listWorktrees(): Promise<WorktreeInfo[]> {
    const repo = getRepoRoot();
    if (!repo) return [];
    try {
      const out = await git(['worktree', 'list', '--porcelain']);
      const result: WorktreeInfo[] = [];
      let cur: Partial<WorktreeInfo> | null = null;
      for (const line of out.split(/\r?\n/)) {
        if (line.startsWith('worktree ')) {
          if (cur) result.push(cur as WorktreeInfo);
          cur = { path: line.slice('worktree '.length).trim(), branch: '', head: '', isMain: false };
        } else if (line.startsWith('branch ')) {
          if (cur) cur.branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
        } else if (line.startsWith('HEAD ')) {
          if (cur) cur.head = line.slice('HEAD '.length).trim().slice(0, 7);
        } else if (line.startsWith('detached') && cur) {
          cur.branch = '(detached)';
        } else if (line.trim() === '') {
          if (cur) {
            cur.isMain = cur.path === repo;
            result.push(cur as WorktreeInfo);
          }
          cur = null;
        }
      }
      if (cur) result.push(cur as WorktreeInfo);
      return result;
    } catch (e) {
      console.warn('[Worktree] 列出 worktree 失败:', (e as Error).message);
      return [];
    }
  }

  /** 新建 worktree（新分支） */
  static async addWorktree(branch: string): Promise<WorktreeInfo> {
    const repo = getRepoRoot();
    if (!repo) throw new Error('未配置 AGENT_REPO_ROOT，无法创建 worktree');
    const b = sanitizeBranch(branch);
    const dir = path.join(getWorktreesRoot(repo), b.replace(/[^a-zA-Z0-9_-]/g, '-'));
    // 已存在同分支 worktree 则直接返回
    const existing = await WorktreeService.listWorktrees();
    const dup = existing.find((w) => w.branch === b);
    if (dup) return dup;
    await git(['worktree', 'add', '-b', b, dir]);
    const created = await WorktreeService.listWorktrees();
    const found = created.find((w) => w.branch === b);
    if (!found) throw new Error('worktree 创建后读取失败');
    return found;
  }

  /** 删除 worktree（仅允许删除 worktree 列表内的非主工作区） */
  static async removeWorktree(targetPath: string): Promise<void> {
    const repo = getRepoRoot();
    if (!repo) throw new Error('未配置 AGENT_REPO_ROOT');
    const list = await WorktreeService.listWorktrees();
    const target = list.find((w) => w.path === targetPath);
    if (!target) throw new Error('目标路径不是已登记的 worktree');
    if (target.isMain) throw new Error('不能删除主工作区');
    await git(['worktree', 'remove', '--force', target.path]);
  }
}
