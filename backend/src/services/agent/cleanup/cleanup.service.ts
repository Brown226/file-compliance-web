/**
 * Agent 临时文件清理服务
 *
 * 存储结构（按用户 + 按日期划分）：
 *   uploads/agent_temp/{userId}/{YYYY-MM-DD}/...
 *
 * 清理策略：
 * - 日期目录（YYYY-MM-DD）：按目录名解析日期，超过 maxAgeDays 天的目录整目录删除
 * - 存量非日期目录（旧 sessionId 目录）：按目录 mtime 判断，超过 maxAgeDays 天整目录删除
 * - 删除后清理空目录结构
 *
 * 安全约束：
 * - 只操作 agent_temp 目录下的内容，不碰同级其他目录
 * - 目录删除失败不中断，累计 errors 后返回
 */

import * as fs from 'fs';
import * as path from 'path';
import { getAgentTempRoot, parseDateDirName } from '../tools/file/paths';

/** 递归删除目录（含内部所有文件与子目录） */
function rmrf(dirPath: string): boolean {
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/** 判断目录是否为空（目录不存在视为空） */
function isEmptyDir(dirPath: string): boolean {
  try {
    const entries = fs.readdirSync(dirPath);
    return entries.length === 0;
  } catch {
    return true;
  }
}

export class CleanupService {
  /**
   * 清理过期临时文件
   *
   * @param maxAgeDays 文件/目录最长存活天数，默认 7 天
   * @returns { deleted: 成功删除的目录数, errors: 删除失败的目录数 }
   */
  static async cleanOldTempFiles(maxAgeDays: number = 7): Promise<{ deleted: number; errors: number }> {
    const agentTempDir = getAgentTempRoot();
    let deleted = 0;
    let errors = 0;

    // 如果目录不存在，直接返回
    if (!fs.existsSync(agentTempDir)) {
      console.log(`[Cleanup] agent_temp 目录不存在: ${agentTempDir}`);
      return { deleted, errors };
    }

    const now = Date.now();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

    // 读取 userId 列表（第一层子目录）
    let userIdEntries: fs.Dirent[];
    try {
      userIdEntries = fs.readdirSync(agentTempDir, { withFileTypes: true });
    } catch (err) {
      console.error(`[Cleanup] 读取 agent_temp 目录失败: ${agentTempDir}`, err);
      return { deleted, errors };
    }

    for (const userIdEntry of userIdEntries) {
      if (!userIdEntry.isDirectory()) continue;

      const userIdPath = path.join(agentTempDir, userIdEntry.name);

      // 读取第二层子目录（日期目录 或 存量 sessionId 目录）
      let subEntries: fs.Dirent[];
      try {
        subEntries = fs.readdirSync(userIdPath, { withFileTypes: true });
      } catch (err) {
        console.error(`[Cleanup] 读取用户目录失败: ${userIdPath}`, err);
        errors++;
        continue;
      }

      for (const subEntry of subEntries) {
        if (!subEntry.isDirectory()) continue;

        const subPath = path.join(userIdPath, subEntry.name);
        let expired = false;

        // 日期目录：按目录名解析日期判断是否超期
        const dateTs = parseDateDirName(subEntry.name);
        if (dateTs !== null) {
          // 日期目录以当天 00:00 为基准；超过 (maxAgeDays) 天的 00:00 即视为过期
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const cutoff = today.getTime() - maxAgeMs;
          expired = dateTs < cutoff;
        } else {
          // 存量非日期目录（旧 sessionId）：按 mtime 判断
          try {
            const stat = fs.statSync(subPath);
            expired = now - stat.mtimeMs > maxAgeMs;
          } catch {
            errors++;
            continue;
          }
        }

        if (!expired) continue;

        // 超期：整目录删除（含内部所有文件与 reports/ 子目录）
        if (rmrf(subPath)) {
          deleted++;
          console.log(`[Cleanup] 已删除过期目录: ${path.relative(agentTempDir, subPath)}`);
        } else {
          console.error(`[Cleanup] 删除目录失败: ${subPath}`);
          errors++;
        }
      }

      // 用户目录下已无任何子目录时，尝试删除用户目录
      if (isEmptyDir(userIdPath)) {
        try {
          fs.rmdirSync(userIdPath);
        } catch {
          // 目录不为空或删除失败，不处理
        }
      }
    }

    return { deleted, errors };
  }
}
