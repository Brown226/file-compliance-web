/**
 * CleanupService 单元测试 — agent_temp 按日期目录清理
 *
 * 覆盖：
 * - 超过 maxAgeDays 天的日期目录整目录删除（含 reports/ 子目录）
 * - 未过期的日期目录保留
 * - 存量非日期目录（旧 sessionId）按 mtime 判断超期后删除
 * - 清理后用户目录若为空则删除
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { CleanupService } from '../cleanup.service';

// —— 隔离 agent_temp 根目录：cleanup 测试扫描整个 agent_temp，
//    与其他测试文件（如 extract-chunk-document 创建 2026-08-11 固定日期目录）
//    共享 uploads/agent_temp 时会产生并发竞态（计数多删）。
//    这里把 getAgentTempRoot 指到系统临时目录下的独立根，互不干扰。 ——
vi.mock('../../tools/file/paths', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../tools/file/paths')>();
  const os = await import('os');
  const testRoot = path.join(os.tmpdir(), `agent-temp-cleanup-test-${process.pid}-${Date.now()}`);
  return {
    ...orig,
    getAgentTempRoot: () => testRoot,
  };
});

import { getAgentTempRoot } from '../../tools/file/paths';

const TEST_USER = 'test-cleanup-user';
const USER_DIR = path.join(getAgentTempRoot(), TEST_USER);

/** 构造日期目录及内部文件（可指定目录 mtime） */
function mkDateDir(dateStr: string, fileContent = 'x') {
  const dir = path.join(USER_DIR, dateStr);
  fs.mkdirSync(path.join(dir, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.txt'), fileContent);
  fs.writeFileSync(path.join(dir, 'reports', 'r.md'), fileContent);
  return dir;
}

afterEach(() => {
  fs.rmSync(USER_DIR, { recursive: true, force: true });
});

describe('CleanupService.cleanOldTempFiles', () => {
  it('删除超过 7 天的日期目录，保留 7 天内', async () => {
    // 今天、3 天前、8 天前、15 天前
    const today = new Date();
    const dstr = (offsetDays: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() - offsetDays);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    mkDateDir(dstr(0));
    mkDateDir(dstr(3));
    mkDateDir(dstr(8));
    mkDateDir(dstr(15));

    const result = await CleanupService.cleanOldTempFiles(7);
    expect(result.errors).toBe(0);
    expect(result.deleted).toBe(2); // 8天前 + 15天前

    const remaining = fs.readdirSync(USER_DIR);
    expect(remaining).toContain(dstr(0));
    expect(remaining).toContain(dstr(3));
    expect(remaining).not.toContain(dstr(8));
    expect(remaining).not.toContain(dstr(15));
  });

  it('存量非日期目录（旧 sessionId）按 mtime 判断，超期删除', async () => {
    const oldSess = path.join(USER_DIR, 'old-session-id');
    fs.mkdirSync(path.join(oldSess, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(oldSess, 'b.txt'), 'x');
    // 目录 mtime 设为 20 天前
    const oldT = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    fs.utimesSync(path.join(oldSess, 'b.txt'), oldT, oldT);
    fs.utimesSync(oldSess, oldT, oldT);

    const result = await CleanupService.cleanOldTempFiles(7);
    expect(result.errors).toBe(0);
    expect(result.deleted).toBe(1);
    expect(fs.existsSync(oldSess)).toBe(false);
  });

  it('用户目录下全部清空后，用户目录被删除', async () => {
    mkDateDir('2020-01-01'); // 很久以前
    await CleanupService.cleanOldTempFiles(7);
    expect(fs.existsSync(USER_DIR)).toBe(false);
  });

  it('不存在的 agent_temp 不报错', async () => {
    const result = await CleanupService.cleanOldTempFiles(7);
    expect(result).toEqual({ deleted: 0, errors: 0 });
  });
});
