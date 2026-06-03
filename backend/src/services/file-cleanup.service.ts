import * as fs from 'fs';
import * as path from 'path';
import prisma from '../config/db';

function walkDir(dir: string, baseDir: string): Set<string> {
  const files = new Set<string>();
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir);
  for (const entry of entries) {
    if (entry.startsWith('.')) continue;
    const fullPath = path.join(dir, entry);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      const subFiles = walkDir(fullPath, baseDir);
      for (const f of subFiles) files.add(f);
    } else {
      const relPath = path.relative(baseDir, fullPath);
      files.add(relPath.replace(/\\/g, '/'));
    }
  }
  return files;
}

class FileCleanupService {
  static getPhysicalFiles(uploadsDir: string): Set<string> {
    return walkDir(uploadsDir, uploadsDir);
  }

  static async getReferencedFiles(): Promise<Set<string>> {
    const [taskFiles, refFiles, feedbacks] = await Promise.all([
      prisma.taskFile.findMany({ select: { filePath: true } }),
      prisma.refFile.findMany({ select: { filePath: true } }),
      prisma.feedback.findMany({ select: { attachmentPaths: true } }),
    ]);
    const referencedPaths = new Set<string>();
    [...taskFiles, ...refFiles].forEach(record => {
      if (record.filePath) {
        const rel = record.filePath.replace(/^\/uploads\//, '');
        referencedPaths.add(rel);
      }
    });
    feedbacks.forEach(fb => {
      if (!fb.attachmentPaths) return;
      const arr = Array.isArray(fb.attachmentPaths) ? fb.attachmentPaths : [];
      arr.forEach((item: any) => {
        if (item?.filePath) {
          const rel = String(item.filePath).replace(/^\/uploads\//, '');
          if (rel) referencedPaths.add(rel);
        }
      });
    });
    return referencedPaths;
  }

  static async cleanupOrphanedFiles(
    uploadsDir: string,
    daysOld: number = 7
  ): Promise<{ deleted: number; freedSpace: number; files: string[] }> {
    const physicalFiles = this.getPhysicalFiles(uploadsDir);
    const referencedFiles = await this.getReferencedFiles();
    const now = Date.now();
    const cutoffTime = now - (daysOld * 24 * 60 * 60 * 1000);

    const orphanedFiles: { relPath: string; filePath: string; size: number }[] = [];

    for (const relPath of physicalFiles) {
      const filePath = path.join(uploadsDir, relPath);
      const stat = fs.statSync(filePath);

      if (stat.mtimeMs > cutoffTime) continue;
      if (referencedFiles.has(relPath)) continue;

      orphanedFiles.push({ relPath, filePath, size: stat.size });
    }

    let totalFreed = 0;
    for (const file of orphanedFiles) {
      try {
        fs.unlinkSync(file.filePath);
        totalFreed += file.size;
        console.log(`[FileCleanup] 已删除: ${file.relPath} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
      } catch (err: any) {
        console.error(`[FileCleanup] 删除失败: ${file.relPath}`, err.message);
      }
    }

    return {
      deleted: orphanedFiles.length,
      freedSpace: totalFreed,
      files: orphanedFiles.map(f => f.relPath),
    };
  }

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

    for (const relPath of physicalFiles) {
      const filePath = path.join(uploadsDir, relPath);
      const stat = fs.statSync(filePath);
      totalSize += stat.size;

      if (referencedFiles.has(relPath)) {
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
