/**
 * Agent 临时文件路径工具
 *
 * 存储结构（按用户 + 按日期划分，跨会话共享）：
 *   uploads/agent_temp/{userId}/{YYYY-MM-DD}/{fileName}
 *
 * 设计说明：
 * - 日期目录：当天上传的所有文件（无论哪个会话）都存入当天文件夹，
 *   解决「同一批上传文件因 sessionId 不一致散落不同会话目录」的问题
 * - 生命周期：超过 7 天的日期目录由 CleanupService 整目录删除
 * - 会话（sessionId）只用于聊天上下文，不再作为存储目录维度
 */

import * as path from 'path';
import { getUploadDir } from '../../../../config/upload';

/** agent_temp 目录绝对路径（backend/uploads/agent_temp） */
export function getAgentTempRoot(): string {
  return path.resolve(path.join(getUploadDir(), 'agent_temp'));
}

/** 当前用户目录绝对路径（agent_temp/{userId}） */
export function getUserAgentTempDir(userId: string): string {
  return path.resolve(path.join(getAgentTempRoot(), userId));
}

/**
 * 生成当前日期的存储目录（agent_temp/{userId}/{YYYY-MM-DD}）
 * 按本地时区取日期，避免跨日边界文件落错目录。
 */
export function getTodayDir(userId: string, now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;
  return path.resolve(path.join(getUserAgentTempDir(userId), dateStr));
}

/** 判断目录名是否为 YYYY-MM-DD 格式（用于识别日期目录） */
const DATE_DIR_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateDirName(name: string): boolean {
  return DATE_DIR_RE.test(name);
}

/**
 * 解析日期目录名为时间戳（本地时区 00:00），非法返回 null。
 * 用于清理逻辑：按目录名判断日期是否超期。
 */
export function parseDateDirName(name: string): number | null {
  if (!isDateDirName(name)) return null;
  const [y, m, d] = name.split('-').map(Number);
  const t = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * 断言 filePath 位于当前用户的 agent_temp 目录内（用户隔离校验）。
 * 不满足时抛出「路径越权」错误，防止跨用户读取/写入他人文件。
 *
 * 用法：在工具 execute 里对传入的 filePath 调用本函数。
 */
export function assertUserFilePath(filePath: string, userId: string): string {
  const userDir = getUserAgentTempDir(userId);
  const normalizedPath = path.resolve(filePath);
  const normalizedUserDir = path.resolve(userDir);
  if (!normalizedPath.startsWith(normalizedUserDir + path.sep) && normalizedPath !== normalizedUserDir) {
    throw new Error('路径越权：只能访问当前用户上传的文件');
  }
  return normalizedPath;
}
