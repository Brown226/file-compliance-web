import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../config/db';
import { SelfCheckService, SelfCheckReport } from '../services/self-check.service';
import { SelfCheckExportService } from '../services/self-check-export.service';
import { success, error } from '../utils/response';

// 内存中暂存最近一次报告结果，用于导出
const reportCache = new Map<string, SelfCheckReport>();

/**
 * 修复 multer 中文文件名编码问题
 * 浏览器以 UTF-8 字节发送文件名，multer/HTTP 解析器可能按 Latin-1 解码导致 Mojibake
 * 通过 Latin-1 → UTF-8 转换还原正确中文
 */
function decodeFileName(raw: string): string {
  if (!raw) return raw;
  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');
    if (decoded !== raw && /[\u4e00-\u9fff]/.test(decoded)) return decoded;
  } catch {}
  return raw;
}

/**
 * POST /api/self-check/run
 * 执行标准引用自检
 * 
 * Body (multipart/form-data):
 *   - files: 待检文件（支持 .docx/.xlsx/.xls/.pdf）
 *   - standardFolderId: 标准库文件夹ID（可选，不传则使用全部标准库）
 */
export const runSelfCheck = async (req: Request, res: Response): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      error(res, '请上传至少一个待检文件', 400);
      return;
    }

    const standardFolderId = (req.body.standardFolderId as string) || null;

    // 标准化文件信息
    const filePaths = files.map(f => ({
      path: f.path,
      originalName: decodeFileName(f.originalname),
      fileType: path.extname(f.originalname).slice(1).toLowerCase(),
    }));

    // 执行自检
    const report = await SelfCheckService.execute(filePaths, standardFolderId);

    // 持久化为任务记录（含 TaskFile，以便前端原文定位预览）
    const userId = (req as any).user?.id;
    const task = await prisma.task.create({
      data: {
        title: `标准引用自检 - ${new Date().toLocaleString('zh-CN')}`,
        status: 'COMPLETED',
        reviewMode: 'SELF_CHECK',
        creatorId: userId,
        selfCheckReport: report as any,
        // 创建 TaskFile 记录，让 TaskResultsView 左侧文件列表有数据
        files: {
          create: filePaths.map(f => ({
            fileName: f.originalName,
            filePath: f.path,
            fileSize: (() => { try { return fs.statSync(f.path)?.size || 0 } catch { return 0 } })(),
            fileType: f.fileType,
            status: 'COMPLETED',
            textLength: 0,
            processedLength: 0,
            errorCount: report.items.filter((item: any) => item.sourceFile === f.originalName).length,
          })),
        },
      },
      include: { files: true },
    });

    // 缓存报告用于导出（关联 taskId）
    reportCache.set(task.id, report);
    setTimeout(() => reportCache.delete(task.id), 60 * 60 * 1000); // 1小时

    success(res, { ...report, taskId: task.id }, `自检完成：${report.totalChecked} 条引用，${report.errorCount} 条存在错误`);
  } catch (err: any) {
    console.error('[SelfCheck] 执行失败:', err);
    error(res, err.message || '自检执行失败', 500);
  }
};

/**
 * GET /api/self-check/report/:id/export
 * 导出自检报告为 Excel
 */
export const exportSelfCheckReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const reportId = req.params.id as string;
    const report = reportCache.get(reportId);

    if (!report) {
      error(res, '报告已过期或不存在，请重新执行自检', 404);
      return;
    }

    const buffer = await SelfCheckExportService.exportReport(report);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=标准引用自检报告_${new Date().toISOString().slice(0, 10)}.xlsx`);
    res.send(buffer);
  } catch (err: any) {
    console.error('[SelfCheck] 导出失败:', err);
    error(res, '导出报告失败', 500);
  }
};

/**
 * GET /api/self-check/library-info
 * 获取可用的标准库列表（文件夹树 + 各文件夹标准数）
 */
export const getLibraryInfo = async (_req: Request, res: Response): Promise<void> => {
  try {
    const folders = await prisma.standardFolder.findMany({
      include: { _count: { select: { standards: true } } },
      orderBy: { name: 'asc' },
    });
    
    const totalStandards = await prisma.standard.count();
    
    success(res, {
      folders: folders.map((f: any) => ({
        id: f.id,
        name: f.name,
        count: f._count.standards,
      })),
      total: totalStandards,
    });
  } catch (err: any) {
    console.error('[SelfCheck] 获取标准库信息失败:', err);
    error(res, '获取标准库信息失败', 500);
  }
};
