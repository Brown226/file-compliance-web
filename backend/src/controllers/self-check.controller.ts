import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import prisma from '../config/db';
import { SelfCheckService, SelfCheckReport } from '../services/review/self-check.service';
import { SelfCheckExportService } from '../services/review/self-check-export.service';
import { WebSocketService } from '../services/system/websocket.service';
import { success, error } from '../utils/response';
import { toWebPath } from '../config/upload';

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
 *   - files: 待检文件（支持 .docx/.xlsx/.xls/.pdf/.ppt/.pptx/.dwg/.txt）
 *   - standardFolderId: 标准库文件夹ID（可选，不传则使用全部标准库）
 *   - dwgParsedData: DWG前端解析数据JSON（可选，key为文件名，value为DwgParsedData）
 */
export const runSelfCheck = async (req: Request, res: Response): Promise<void> => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      error(res, '请上传至少一个待检文件', 400);
      return;
    }

    const standardFolderId = (req.body.standardFolderId as string) || null;

    // 解析前端传来的 DWG 解析数据
    let dwgParsedData: Record<string, { text: string }> | null = null;
    if (req.body.dwgParsedData) {
      try {
        dwgParsedData = JSON.parse(req.body.dwgParsedData);
      } catch {
        console.warn('[SelfCheck] dwgParsedData JSON 解析失败，忽略');
      }
    }

    // 标准化文件信息
    const filePaths = files.map(f => ({
      path: f.path,
      originalName: decodeFileName(f.originalname),
      fileType: path.extname(f.originalname).slice(1).toLowerCase(),
    }));

    // 1. 创建任务（PROCESSING 状态）+ 文件记录
    const userId = (req as any).user?.id;
    const title = `标准引用自检 - ${new Date().toLocaleString('zh-CN')}`;
    const task = await prisma.task.create({
      data: {
        title,
        status: 'PROCESSING',
        reviewMode: 'SELF_CHECK',
        creatorId: userId,
        files: {
          create: filePaths.map(f => ({
            fileName: f.originalName,
            filePath: toWebPath('selfcheck/' + path.basename(f.path)),
            fileSize: (() => { try { return fs.statSync(f.path)?.size || 0 } catch { return 0 } })(),
            fileType: f.fileType,
            status: 'COMPLETED',
            textLength: 0,
            processedLength: 0,
            errorCount: 0,
          })),
        },
      },
      include: { files: true },
    });

    // 2. 立即返回 taskId，不阻塞
    success(res, { taskId: task.id, status: 'PROCESSING' }, '自检任务已创建，正在后台执行');

    // 3. 后台异步执行自检
    (async () => {
      try {
        WebSocketService.emitTaskProgress(task.id, {
          type: 'self_check_start',
          step: '标准引用自检',
          progress: 5,
          message: '正在初始化自检...',
        });

        const report = await SelfCheckService.execute(
          filePaths,
          standardFolderId,
          (progress) => {
            const pct = Math.round((progress.current / Math.max(progress.total, 1)) * 80) + 10;
            WebSocketService.emitTaskProgress(task.id, {
              type: 'self_check_progress',
              step: `自检中 (${progress.current}/${progress.total})`,
              progress: pct,
              message: progress.message,
            });
          },
          dwgParsedData
        );

        // P1-7: 空库显式告警 — 标准库为空时用户必须能看到「没审到」而非「真合规」
        if ((report as any).warning) {
          WebSocketService.emitTaskProgress(task.id, {
            type: 'lib_empty',
            step: '标准库为空',
            progress: 80,
            message: (report as any).warning,
            phase: 'self_check',
            timestamp: Date.now(),
          });
          try {
            const curStats = ((task as any).stats as any) || {};
            const warnings = Array.isArray(curStats.warnings) ? [...curStats.warnings] : [];
            warnings.push(`标准库为空：${(report as any).warning}`);
            await prisma.task.update({
              where: { id: task.id },
              data: { stats: { ...curStats, warnings } },
            });
          } catch (e) {
            console.warn('[SelfCheck] 空库告警落库失败（不影响主流程）:', e);
          }
        }

        // 更新任务：写入报告 + 标记完成
        await prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'COMPLETED',
            selfCheckReport: report as any,
          },
        });

        // 更新 TaskFile 的 errorCount
        for (const tf of task.files) {
          const fileErrors = report.items.filter(
            (item: any) => item.sourceFile === tf.fileName && item.errorTypes.length > 0
          ).length;
          if (fileErrors > 0) {
            await prisma.taskFile.update({
              where: { id: tf.id },
              data: { errorCount: fileErrors },
            });
          }
        }

        // 缓存报告用于导出
        reportCache.set(task.id, report);
        setTimeout(() => reportCache.delete(task.id), 60 * 60 * 1000);

        WebSocketService.emitTaskProgress(task.id, {
          type: 'completed',
          step: '自检完成',
          progress: 100,
          message: `自检完成：${report.totalChecked} 条引用，${report.errorCount} 条存在错误`,
        });

        console.log(`[SelfCheck] 任务 ${task.id} 后台执行完成`);
      } catch (err: any) {
        console.error(`[SelfCheck] 任务 ${task.id} 后台执行失败:`, err);
        await prisma.task.update({
          where: { id: task.id },
          data: { status: 'FAILED' },
        }).catch(e => console.error('[SelfCheck] 更新失败状态失败:', e));
        WebSocketService.emitTaskProgress(task.id, {
          type: 'error',
          step: '自检失败',
          progress: 0,
          message: err.message || '自检执行失败',
        });
      }
    })();
  } catch (err: any) {
    console.error('[SelfCheck] 创建任务失败:', err);
    error(res, err.message || '创建自检任务失败', 500);
  }
};

/**
 * GET /api/self-check/report/:id/export
 * 导出自检报告为 Excel
 */
export const exportSelfCheckReport = async (req: Request, res: Response): Promise<void> => {
  try {
    const reportId = req.params.id as string;
    let report = reportCache.get(reportId);

    // 缓存未命中时，从数据库 Task.selfCheckReport 字段读取
    if (!report) {
      const task = await prisma.task.findUnique({
        where: { id: reportId },
        select: { selfCheckReport: true },
      });
      if (task?.selfCheckReport) {
        report = task.selfCheckReport as unknown as SelfCheckReport;
      }
    }

    if (!report) {
      error(res, '报告不存在，请重新执行自检', 404);
      return;
    }

    const buffer = await SelfCheckExportService.exportReport(report);
    const fileName = `标准引用自检报告_${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    res.send(buffer);
  } catch (err: any) {
    console.error('[SelfCheck] 导出失败:', err);
    error(res, `导出报告失败: ${err.message || '未知错误'}`, 500);
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
