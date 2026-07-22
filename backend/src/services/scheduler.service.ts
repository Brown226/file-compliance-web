/**
 * 定时任务服务
 * 功能：每天凌晨2点自动清理孤立文件（天数从基础设置读取）
 */
import * as path from 'path';
import prisma from '../config/db';
import FileCleanupService from './file-cleanup.service';
import { getUploadPath } from '../config/upload';

const DEFAULT_CLEANUP_DAYS = 7;

async function getCleanupDays(): Promise<number> {
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: 'basic_settings' } });
    if (cfg?.value && typeof cfg.value === 'object') {
      const days = (cfg.value as any).autoCleanupDays;
      if (typeof days === 'number' && days >= 0) return days;
    }
  } catch {}
  return DEFAULT_CLEANUP_DAYS;
}

// 定时清理孤立文件（每天凌晨2点执行）
function scheduleCleanup() {
  // 计算距离下一个凌晨2点的时间
  const now = new Date();
  const next2AM = new Date(now);
  next2AM.setHours(2, 0, 0, 0);
  if (next2AM <= now) {
    next2AM.setDate(next2AM.getDate() + 1);
  }
  const msUntil2AM = next2AM.getTime() - now.getTime();

  console.log(`[Scheduler] 定时清理任务已注册，下次执行时间: ${next2AM.toLocaleString()}`);

  // 首次延迟执行
  setTimeout(() => {
    runCleanup();
    // 之后每24小时执行一次
    setInterval(runCleanup, 24 * 60 * 60 * 1000);
  }, msUntil2AM);
}

async function runCleanup() {
  console.log('[Scheduler] 开始执行孤立文件清理...');
  try {
    const uploadsDir = getUploadPath();
    const days = await getCleanupDays();
    if (days === 0) {
      console.log('[Scheduler] 自动清理已禁用（配置为 0 天），跳过清理');
      return;
    }
    const result = await FileCleanupService.cleanupOrphanedFiles(uploadsDir, days);
    console.log(`[Scheduler] 清理完成（${days}天前）：删除了 ${result.deleted} 个文件，释放了 ${(result.freedSpace / 1024 / 1024).toFixed(2)} MB 空间`);
  } catch (error: any) {
    console.error('[Scheduler] 清理失败:', error.message);
  }
}

// 启动定时任务（改为显式调用，不再 import 即自启动，便于按进程角色控制）
// 调用方：index.ts 在 worker/all 角色下调用 startScheduler()
export { scheduleCleanup, scheduleCleanup as startScheduler, runCleanup };
