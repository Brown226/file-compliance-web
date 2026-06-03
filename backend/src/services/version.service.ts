import prisma from '../config/db';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { getUploadPath, resolveFilePath } from '../config/upload';

function VERSIONS_DIR() { return getUploadPath('versions'); }

/**
 * 文件版本管理服务
 * 在文本替换前创建快照，支持版本历史和 diff 对比
 */
export class VersionService {
  /**
   * 创建文件版本快照
   */
  static async createSnapshot(
    fileId: string,
    userId: string | undefined,
    sourceAction: string
  ): Promise<{ versionNo: number; storagePath: string }> {
    const file = await prisma.taskFile.findUnique({ where: { id: fileId } });
    if (!file) throw new Error('File not found');

    // 确保版本目录存在
    if (!fs.existsSync(VERSIONS_DIR())) {
      fs.mkdirSync(VERSIONS_DIR(), { recursive: true });
    }

    // 获取当前最大版本号
    const maxVersion = await prisma.fileVersion.findFirst({
      where: { fileId },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true },
    });

    const newVersionNo = (maxVersion?.versionNo || 0) + 1;

    // 复制当前文件为快照（兼容绝对路径和相对路径）
    const rawPath = file.filePath
    const absolutePath = resolveFilePath(rawPath);

    const snapshotName = `${fileId}-v${newVersionNo}-${uuidv4()}.docx`;
    const snapshotPath = path.join(VERSIONS_DIR(), snapshotName);

    if (fs.existsSync(absolutePath)) {
      fs.copyFileSync(absolutePath, snapshotPath);
    }

    // 创建版本记录
    await prisma.fileVersion.create({
      data: {
        fileId,
        versionNo: newVersionNo,
        sourceAction,
        storagePath: `/uploads/versions/${snapshotName}`,
        createdBy: userId,
      },
    });

    return {
      versionNo: newVersionNo,
      storagePath: `/uploads/versions/${snapshotName}`,
    };
  }

  /**
   * 获取文件的版本历史
   */
  static async getVersions(fileId: string) {
    return prisma.fileVersion.findMany({
      where: { fileId },
      orderBy: { versionNo: 'desc' },
    });
  }

  /**
   * 计算当前文件与指定版本的文本 diff
   */
  static async diffWithVersion(fileId: string, versionNo: number): Promise<Array<{ type: 'equal' | 'delete' | 'insert'; text: string }>> {
    const version = await prisma.fileVersion.findFirst({
      where: { fileId, versionNo },
    });

    if (!version) throw new Error('Version not found');

    const file = await prisma.taskFile.findUnique({ where: { id: fileId } });
    if (!file) throw new Error('File not found');

    // 获取当前文件文本（从缓存）
    const currentText = file.extractedText || '';
    const versionText = version.plainText || '';

    return this.computeDiff(currentText, versionText);
  }

  /**
   * LCS diff 算法
   */
  private static computeDiff(current: string, version: string): Array<{ type: 'equal' | 'delete' | 'insert'; text: string }> {
    const m = current.length;
    const n = version.length;

    // DP 表（滚动数组优化空间）
    let prev = new Uint16Array(n + 1);
    let curr = new Uint16Array(n + 1);

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        curr[j] = current[i - 1] === version[j - 1]
          ? prev[j - 1] + 1
          : Math.max(prev[j], curr[j - 1]);
      }
      [prev, curr] = [curr, prev];
      curr.fill(0);
    }

    // 回溯生成 diff
    const result: Array<{ type: 'equal' | 'delete' | 'insert'; text: string }> = [];
    let i = m, j = n;
    const segments: Array<{ type: 'equal' | 'delete' | 'insert'; char: string }> = [];

    // 重新计算 DP 表用于回溯
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let ii = 1; ii <= m; ii++) {
      for (let jj = 1; jj <= n; jj++) {
        dp[ii][jj] = current[ii - 1] === version[jj - 1]
          ? dp[ii - 1][jj - 1] + 1
          : Math.max(dp[ii - 1][jj], dp[ii][jj - 1]);
      }
    }

    i = m; j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && current[i - 1] === version[j - 1]) {
        segments.push({ type: 'equal', char: current[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        segments.push({ type: 'insert', char: version[j - 1] });
        j--;
      } else {
        segments.push({ type: 'delete', char: current[i - 1] });
        i--;
      }
    }

    segments.reverse();

    // 合并连续同类型段
    let currentType = segments[0]?.type;
    let currentText = '';
    for (const seg of segments) {
      if (seg.type === currentType) {
        currentText += seg.char;
      } else {
        if (currentText) result.push({ type: currentType!, text: currentText });
        currentType = seg.type;
        currentText = seg.char;
      }
    }
    if (currentText) result.push({ type: currentType!, text: currentText });

    return result;
  }
}
