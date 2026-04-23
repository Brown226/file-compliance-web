/**
 * 文件清理服务
 * 功能：清理孤立的物理文件（数据库中不再引用的上传文件）
 */
import * as fs from 'fs';
import * as path from 'path';
import prisma from '../config/db';

class FileCleanupService {
  /**
   * 获取 uploads 目录中所有的物理文件
   */
  static getPhysicalFiles(uploadsDir: string): Set<string> {
    if (!fs.existsSync(uploadsDir)) {
      return new Set();
    }
    const files = fs.readdirSync(uploadsDir);
    return new Set(files.filter(f => !f.startsWith('.')));
  }

  /**
   * 获取数据库中所有被引用的文件名
   */
  static async getReferencedFiles(): Promise<Set<string>> {
    // 从 TaskFile 表获取所有文件路径
    const taskFiles = await prisma.taskFile.findMany({
      select: { filePath: true },
    });

    // 从 RefFile 表获取所有参照文件路径
    const refFiles = await prisma.refFile.findMany({
      select: { filePath: true },
    });

    // 合并并提取文件名
    const referencedNames = new Set<string>();
    [...taskFiles, ...refFiles].forEach(record => {
      if (record.filePath) {
        const filename = path.basename(record.filePath);
        referencedNames.add(filename);
      }
    });

    return referencedNames;
  }

  /**
   * 清理孤立文件
   * @param uploadsDir - 上传目录路径
   * @param daysOld - 只清理多少天前的文件（默认7天，避免清理正在使用的文件）
   */
  static async cleanupOrphanedFiles(
    uploadsDir: string,
    daysOld: number = 7
  ): Promise<{ deleted: number; freedSpace: number; files: string[] }> {
    const physicalFiles = this.getPhysicalFiles(uploadsDir);
    const referencedFiles = await this.getReferencedFiles();
    const now = Date.now();
    const cutoffTime = now - (daysOld * 24 * 60 * 60 * 1000);

    const orphanedFiles: { filename: string; filePath: string; size: number }[] = [];

    for (const filename of physicalFiles) {
      // 跳过目录
      const filePath = path.join(uploadsDir, filename);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) continue;

      // 跳过新文件（保护期内的文件不清理）
      if (stat.mtimeMs > cutoffTime) continue;

      // 跳过被数据库引用的文件
      if (referencedFiles.has(filename)) continue;

      orphanedFiles.push({ filename, filePath, size: stat.size });
    }

    // 删除孤立文件
    let totalFreed = 0;
    for (const file of orphanedFiles) {
      try {
        fs.unlinkSync(file.filePath);
        totalFreed += file.size;
        console.log(`[FileCleanup] 已删除: ${file.filename} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      } catch (err: any) {
        console.error(`[FileCleanup] 删除失败: ${file.filename}`, err.message);
      }
    }

    return {
      deleted: orphanedFiles.length,
      freedSpace: totalFreed,
      files: orphanedFiles.map(f => f.filename),
    };
  }

  /**
   * 统计存储使用情况
   */
  static async getStorageStats(uploadsDir: string): Promise<{
    totalFiles: number;
    totalSize: number;
    referencedFiles: number;
    referencedSize: number;
    orphanedFiles: number;
    orphanedSize: number;
  }> {
    const physicalFiles = this.getPhysicalFiles(uploadsDir);
    const referencedFiles = await this.getReferencedFiles();

    let totalSize = 0;
    let referencedSize = 0;
    let orphanedCount = 0;
    let orphanedSize = 0;

    for (const filename of physicalFiles) {
      const filePath = path.join(uploadsDir, filename);
      const stat = fs.statSync(filePath);
      totalSize += stat.size;

      if (referencedFiles.has(filename)) {
        referencedSize += stat.size;
      } else {
        orphanedCount++;
        orphanedSize += stat.size;
      }
    }

    return {
      totalFiles: physicalFiles.size,
      totalSize,
      referencedFiles: referencedFiles.size,
      referencedSize,
      orphanedFiles: orphanedCount,
      orphanedSize,
    };
  }
}

export default FileCleanupService;
