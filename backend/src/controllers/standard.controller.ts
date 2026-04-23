import { Request, Response } from 'express';
import path from 'path';
import { StandardService } from '../services/standard.service';
import { StandardExtractorService } from '../services/standard-extractor.service';
import { success, error, paginated } from '../utils/response';

export const createStandard = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, version, isActive, folderId, standardNo, standardName, source, importedBy } = req.body;
    if (!title || !version) {
      error(res, '标题和版本号为必填项', 400);
      return;
    }
    const standard = await StandardService.createStandard({ 
      title, version, isActive, folderId, standardNo, standardName, source, importedBy
    });
    success(res, standard, '标准创建成功');
  } catch (err: any) {
    console.error('Create Standard Error:', err);
    error(res, err.message || '服务器内部错误', 400);
  }
};

/** 通过文件上传创建标准 */
export const createStandardFromFile = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      error(res, '请上传标准文件（支持 docx/pdf/xlsx/xls）', 400);
      return;
    }
    const { title, version, isActive, folderId } = req.body;
    if (!title || !version) {
      error(res, '标题和版本号为必填项', 400);
      return;
    }

    const standard = await StandardService.createFromFile({
      filePath: req.file.path,
      fileType: path.extname(req.file.originalname).slice(1),
      title,
      version,
      isActive: isActive === 'true',
      folderId,
    });

    success(res, standard, '标准文件已解析并创建成功');
  } catch (err: any) {
    console.error('Create Standard From File Error:', err);
    if (req.file?.path) { try { require('fs').unlinkSync(req.file.path); } catch {} }
    error(res, err.message || '文件解析失败', 400);
  }
};

export const getStandards = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = req.query.search as string | undefined;
    const folderId = req.query.folderId as string | undefined;
    const includeSubFolders = req.query.includeSubFolders === 'true';

    const skip = (page - 1) * limit;
    const result = await StandardService.getStandards({ skip, take: limit, search, folderId, includeSubFolders });
    paginated(res, result.standards, result.total);
  } catch (err) {
    console.error('Get Standards Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const getStandardById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const standard = await StandardService.getStandardById(id);
    if (!standard) { error(res, '未找到该标准', 404); return; }
    success(res, standard);
  } catch (err) {
    console.error('Get Standard Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/** 获取标准详情 */
export const getStandardDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const detail = await StandardService.getStandardDetail(id);
    if (!detail) { error(res, '未找到该标准', 404); return; }
    success(res, detail);
  } catch (err) {
    console.error('Get Standard Detail Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const updateStandard = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { title, version, isActive, folderId } = req.body;
    const existing = await StandardService.getStandardById(id);
    if (!existing) { error(res, '未找到该标准', 404); return; }

    const standard = await StandardService.updateStandard(id, { title, version, isActive, folderId });
    success(res, standard, '标准更新成功');
  } catch (err) {
    console.error('Update Standard Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

export const deleteStandard = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const existing = await StandardService.getStandardById(id);
    if (!existing) { error(res, '未找到该标准', 404); return; }

    await StandardService.deleteStandard(id);
    success(res, null, '标准删除成功');
  } catch (err) {
    console.error('Delete Standard Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

// ===== Excel 导入导出 =====

export const exportStandardsExcel = async (_req: Request, res: Response): Promise<void> => {
  try {
    const buffer = await StandardService.exportToExcel();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=standards_export.xlsx');
    res.send(buffer);
  } catch (err) {
    console.error('Export Standards Error:', err);
    error(res, '导出失败', 500);
  }
};

export const importStandardsExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) { error(res, '请上传 Excel 文件', 400); return; }
    const result = await StandardService.importFromExcel(req.file.path);
    success(res, result, `成功导入 ${result.imported} 条标准${result.skipped > 0 ? `，跳过 ${result.skipped} 条` : ''}`);
  } catch (err) {
    console.error('Import Standards Error:', err);
    error(res, '导入失败', 500);
  }
};

export const downloadTemplate = async (_req: Request, res: Response): Promise<void> => {
  try {
    const buffer = await StandardService.generateTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=standards_template.xlsx');
    res.send(buffer);
  } catch (err) {
    console.error('Download Template Error:', err);
    error(res, '下载模板失败', 500);
  }
};

/** 实时标准比对预览 */
export const checkStandard = async (req: Request, res: Response): Promise<void> => {
  try {
    const { standardNo, standardName } = req.body;
    if (!standardNo) {
      error(res, '标准编号为必填项', 400);
      return;
    }
    const result = await StandardService.checkStandard(standardNo, standardName);
    success(res, result);
  } catch (err) {
    console.error('Check Standard Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/** 从文本中提取标准引用 */
export const extractStandardRefs = async (req: Request, res: Response): Promise<void> => {
  try {
    const { text, docType } = req.body;
    if (!text) {
      error(res, '文本内容为必填项', 400);
      return;
    }
    const refs = StandardService.extractStandardRefs(text, docType);
    success(res, { refs, count: refs.length });
  } catch (err) {
    console.error('Extract Standard Refs Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/** 从 Excel 文件中按固定列提取标准引用 */
export const extractFromExcelColumn = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) { error(res, '请上传 Excel 文件', 400); return; }
    const { startRow, column, sheetIndex } = req.body;
    const refs = await StandardExtractorService.extractFromExcelByColumn(req.file.path, {
      startRow: startRow ? parseInt(startRow) : undefined,
      column: column ? parseInt(column) : undefined,
      sheetIndex: sheetIndex ? parseInt(sheetIndex) : undefined,
    });
    // 清理临时文件
    try { require('fs').unlinkSync(req.file.path); } catch {}
    success(res, { refs, count: refs.length });
  } catch (err: any) {
    console.error('Extract From Excel Column Error:', err);
    error(res, err.message || '提取失败', 500);
  }
};

// ===== 临时标准库 =====

/** 导入临时标准库（Excel） */
export const importTempLibrary = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) { error(res, '请上传 Excel 文件', 400); return; }
    const result = await StandardService.importTempLibrary(req.file.path, (req as any).user?.id);
    success(res, result, `成功导入 ${result.count} 条临时标准`);
  } catch (err: any) {
    console.error('Import Temp Library Error:', err);
    error(res, '导入失败: ' + err.message, 500);
  }
};

/** 获取当前用户的临时标准库 */
export const getTempLibrary = async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await StandardService.getTempLibrary((req as any).user?.id);
    success(res, result);
  } catch (err: any) {
    console.error('Get Temp Library Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/** 清除临时标准库 */
export const clearTempLibrary = async (req: Request, res: Response): Promise<void> => {
  try {
    await StandardService.clearTempLibrary((req as any).user?.id);
    success(res, null, '临时标准库已清除');
  } catch (err: any) {
    console.error('Clear Temp Library Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/** 使用临时标准库进行比对 */
export const checkStandardWithTempLibrary = async (req: Request, res: Response): Promise<void> => {
  try {
    const { standardNo, standardName } = req.body;
    if (!standardNo) { error(res, '标准编号为必填项', 400); return; }
    const result = await StandardService.checkStandardWithTempLibrary(standardNo, standardName, (req as any).user?.id);
    success(res, result);
  } catch (err: any) {
    console.error('Check Standard With Temp Library Error:', err);
    error(res, '服务器内部错误', 500);
  }
};

/** 将临时标准库条目归档为正式标准 */
export const archiveTempToStandard = async (req: Request, res: Response): Promise<void> => {
  try {
    const { entryIds } = req.body; // 要归档的临时标准条目 ID 列表
    const userId = (req as any).user?.id;

    if (!Array.isArray(entryIds) || entryIds.length === 0) {
      error(res, '请选择要归档的临时标准条目', 400);
      return;
    }

    const result = await StandardService.archiveTempToStandard(entryIds, userId);
    success(res, result, `成功归档 ${result.archived} 条标准，跳过 ${result.skipped} 条已存在的`);
  } catch (err: any) {
    console.error('Archive Temp To Standard Error:', err);
    error(res, err.message || '归档失败', 500);
  }
};

/** 归档所有临时标准库条目 */
export const archiveAllTempToStandard = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const result = await StandardService.archiveAllTempToStandard(userId);
    success(res, result, `成功归档 ${result.archived} 条标准，跳过 ${result.skipped} 条已存在的`);
  } catch (err: any) {
    console.error('Archive All Temp To Standard Error:', err);
    error(res, err.message || '归档失败', 500);
  }
};

// ===== Normative 格式 Excel 解析 =====

/**
 * 导入 Normative 格式 Excel 标准库
 * 
 * 支持的 Excel 格式：
 * - Normative 工具导出的标准库格式
 * - 自定义格式（根据表头自动检测列位置）
 * 
 * 表头要求：
 * - 标准编号（必填）
 * - 标准名称（可选）
 * - 发布日期（可选，格式 YYYY-MM-DD）
 * - 实施日期（可选）
 * - 废止日期（可选）
 */
export const importNormativeExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      error(res, '请上传 Excel 文件', 400);
      return;
    }

    const {
      folderId,
      skipInvalidRows,
      overwriteExisting,
      dryRun,
    } = req.body;

    const result = await StandardService.importNormativeFormatExcel(req.file.path, {
      defaultFolderId: folderId,
      skipInvalidRows: skipInvalidRows !== 'false',
      overwriteExisting: overwriteExisting === 'true',
      dryRun: dryRun === 'true',
    });

    const message = dryRun === 'true'
      ? `试运行完成：共 ${result.total - 1} 行数据，有效 ${result.valid} 行，错误 ${result.errors.length} 行`
      : `导入完成：成功 ${result.imported} 行，跳过 ${result.skipped} 行${result.errors.length > 0 ? `，错误 ${result.errors.length} 行` : ''}`;

    success(res, result, message);
  } catch (err: any) {
    console.error('Import Normative Excel Error:', err);
    if (req.file?.path) {
      try { require('fs').unlinkSync(req.file.path); } catch {}
    }
    error(res, err.message || '导入失败', 500);
  }
};

/**
 * 预览 Normative 格式 Excel 数据（不写入数据库）
 */
export const previewNormativeExcel = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      error(res, '请上传 Excel 文件', 400);
      return;
    }

    const result = await StandardService.importNormativeFormatExcel(req.file.path, {
      dryRun: true,
    });

    success(res, {
      total: result.total - 1,
      valid: result.valid,
      errors: result.errors,
      preview: result.preview,
    }, `预览完成：共 ${result.total - 1} 行数据，有效 ${result.valid} 行`);
  } catch (err: any) {
    console.error('Preview Normative Excel Error:', err);
    if (req.file?.path) {
      try { require('fs').unlinkSync(req.file.path); } catch {}
    }
    error(res, err.message || '预览失败', 500);
  }
};

/**
 * 下载 Normative 格式 Excel 导入模板
 */
export const downloadNormativeTemplate = async (_req: Request, res: Response): Promise<void> => {
  try {
    const buffer = await StandardService.generateNormativeTemplate();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=normative_standards_template.xlsx');
    res.send(buffer);
  } catch (err) {
    console.error('Download Normative Template Error:', err);
    error(res, '下载模板失败', 500);
  }
};
