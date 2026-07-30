/**
 * Agent 临时文件清理服务
 *
 * 扫描 `uploads/agent_temp/` 目录，递归遍历 userId/sessionId/ 子目录，
 * 删除超过 maxAgeDays 天的旧文件，并清理空目录结构。
 *
 * 安全约束：
 * - 只操作 agent_temp 目录下的文件，不碰同级其他目录
 * - 文件删除失败不中断，累计 errors 后返回
 */

import * as fs from 'fs';
import * as path from 'path';

/** agent_temp 相对于本项目根目录的路径 */
const AGENT_TEMP_REL = '../../../../uploads/agent_temp';

export class CleanupService {
  /**
   * 清理过期临时文件
   * @param maxAgeDays 文件最长存活天数，默认 7 天
   * @returns { deleted: 成功删除的文件数, errors: 删除失败的文件数 }
   */
  static async cleanOldTempFiles(maxAgeDays: number = 7): Promise<{ deleted: number; errors: number }> {
    const agentTempDir = path.resolve(__dirname, AGENT_TEMP_REL);
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

      // 读取 sessionId 列表（第二层子目录）
      let sessionIdEntries: fs.Dirent[];
      try {
        sessionIdEntries = fs.readdirSync(userIdPath, { withFileTypes: true });
      } catch (err) {
        // 无法读取该用户目录，跳过并计数
        console.error(`[Cleanup] 读取用户目录失败: ${userIdPath}`, err);
        errors++;
        continue;
      }

      let userDirEmpty = true; // 标记 userId 下是否所有 session 目录都为空

      for (const sessionEntry of sessionIdEntries) {
        if (!sessionEntry.isDirectory()) continue;

        const sessionPath = path.join(userIdPath, sessionEntry.name);

        // 递归收集该 session 目录下的所有文件
        const files = collectFiles(sessionPath);

        let sessionEmpty = true; // 标记当前 session 目录下是否还有文件残留

        for (const filePath of files) {
          try {
            const stat = fs.statSync(filePath);
            const ageMs = now - stat.mtimeMs;

            if (ageMs > maxAgeMs) {
              // 文件超过 maxAgeDays，删除
              fs.unlinkSync(filePath);
              deleted++;
            } else {
              // 文件未过期，该 session 目录非空
              sessionEmpty = false;
            }
          } catch (err) {
            // 删除失败不中断，计入 errors
            console.error(`[Cleanup] 删除文件失败: ${filePath}`, err);
            errors++;
            // 无法确定文件是否还在，保守认为该 session 非空
            sessionEmpty = false;
          }
        }

        // 如果 session 目录下所有文件都被删了，尝试删除空目录
        if (sessionEmpty) {
          try {
            // 递归删除空子目录（如 reports/ 等）
            removeEmptyDirs(sessionPath);
            // 尝试删除 session 目录本身
            fs.rmdirSync(sessionPath);
          } catch (err) {
            // 目录不为空或删除失败，则不处理
          }
        } else {
          userDirEmpty = false;
        }
      }

      // 如果 userId 下所有 session 目录都为空，尝试删除 userId 目录
      if (userDirEmpty) {
        try {
          fs.rmdirSync(userIdPath);
        } catch (err) {
          // 目录不为空或删除失败，则不处理
        }
      }
    }

    return { deleted, errors };
  }
}

/**
 * 递归收集目录下的所有文件路径（不包含目录自身）
 */
function collectFiles(dirPath: string): string[] {
  const result: string[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        result.push(...collectFiles(fullPath));
      } else if (entry.isFile()) {
        result.push(fullPath);
      }
    }
  } catch {
    // 忽略无法读取的目录
  }

  return result;
}

/**
 * 递归删除空目录（从最深层开始向上删除空目录）
 */
function removeEmptyDirs(dirPath: string): void {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subPath = path.join(dirPath, entry.name);
        removeEmptyDirs(subPath);
        try {
          fs.rmdirSync(subPath);
        } catch {
          // 子目录非空，跳过
        }
      }
    }
  } catch {
    // 忽略无法读取的目录
  }
}
