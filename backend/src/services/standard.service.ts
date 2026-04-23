import prisma from '../config/db';
import { Standard } from '@prisma/client';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { ParserService } from './parser.service';
import { StandardFolderService } from './standardFolder.service';
import { MaxKBService } from './maxkb.service';
import { StandardExtractorService } from './standard-extractor.service';
import { StandardCheckService, StandardCheckItem } from './standard-check.service';
import { CharDiffService } from './char-diff.service';

export class StandardService {
  // 临时标准库已迁移到数据库 TempStandardEntry，内存缓存仅作为查询加速层
  private static tempLibraryCache = new Map<string, StandardCheckItem[]>();

  /** 清除字符串中的 null 字节和其他非法 UTF-8 字符，防止 PostgreSQL 报错 */
  private static sanitizeUtf8(str: string): string {
    if (!str) return str;
    return str.replace(/\x00/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  /**
   * 检测内容是否为乱码/二进制垃圾数据
   * 规则: 1) 替换字符(�)占比>5% → 编码错误; 2) 可读字符<30% → 二进制/扫描件; 3) 连续控制字符 → 二进制数据
   */
  static detectGarbledText(text: string): { isGarbled: boolean; reason: string } {
    if (!text || text.length === 0) return { isGarbled: true, reason: '内容为空' };
    const len = text.length;
    const replacementCount = (text.match(/[\uFFFD]/g) || []).length;
    if (replacementCount / len > 0.05) {
      return { isGarbled: true, reason: `含 ${Math.round(replacementCount / len * 100)}% 的乱码字符(�)` };
    }
    const readableCount = (text.match(/[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u0020-\u007E\u3000-\u303F\uFF00-\uFFEF]/g) || []).length;
    if (readableCount / len < 0.3 && len > 50) {
      return { isGarbled: true, reason: `可读文字仅占 ${Math.round(readableCount / len * 100)}%，可能是扫描版/加密文件` };
    }
    if ((text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]{5,}/g) || []).length > 0) {
      return { isGarbled: true, reason: '包含二进制控制字符' };
    }
    return { isGarbled: false, reason: '' };
  }

  static async createStandard(data: { 
    title: string; version: string; isActive?: boolean; folderId?: string;
    standardNo?: string; standardName?: string;
    source?: string; importedBy?: string;
  }): Promise<Standard> {
    // 校验文件夹存在
    if (data.folderId) {
      const folder = await prisma.standardFolder.findUnique({ where: { id: data.folderId } });
      if (!folder) throw new Error('文件夹不存在');
    }
    // 自动提取标识符
    const standardIdent = data.standardNo 
      ? StandardExtractorService.getIdent(data.standardNo) 
      : null;
    
    return prisma.standard.create({
      data: {
        title: StandardService.sanitizeUtf8(data.title),
        version: StandardService.sanitizeUtf8(data.version),
        isActive: data.isActive ?? true,
        folderId: data.folderId || null,
        standardNo: data.standardNo ? StandardService.sanitizeUtf8(data.standardNo) : null,
        standardName: data.standardName ? StandardService.sanitizeUtf8(data.standardName) : null,
        standardIdent,
        source: data.source || null,
        importedBy: data.importedBy || null,
      },
      include: { folder: true },
    });
  }

  /**
   * 通过上传文件创建标准：解析文件内容验证质量后创建索引记录
   * 注意：content 字段已移除，文件全文由 MaxKB 知识库管理，此方法仅验证文件可读性
   */
  static async createFromFile(fileData: {
    filePath: string;
    fileType: string;
    title: string;
    version: string;
    isActive?: boolean;
    folderId?: string;
  }): Promise<Standard> {
    const content = await ParserService.parseFile(fileData.filePath, fileData.fileType);
    
    if (!content || content.trim().length < 10) {
      throw new Error('文件内容为空或过短，无法作为标准规范');
    }

    // 质量检测：拦截乱码/二进制垃圾内容
    const garbageCheck = StandardService.detectGarbledText(content);
    if (garbageCheck.isGarbled) {
      throw new Error(`解析的文件内容质量不合格: ${garbageCheck.reason}。可能的原因：1) 文件是扫描版PDF(图片)需OCR处理；2) 文件加密/损坏；3) 文件格式不匹配`);
    }

    // 校验文件夹存在
    if (fileData.folderId) {
      const folder = await prisma.standardFolder.findUnique({ where: { id: fileData.folderId } });
      if (!folder) throw new Error('文件夹不存在');
    }

    const standard = await prisma.standard.create({
      data: {
        title: StandardService.sanitizeUtf8(fileData.title),
        version: StandardService.sanitizeUtf8(fileData.version),
        isActive: fileData.isActive ?? true,
        folderId: fileData.folderId || null,
        source: 'import',
      },
    });

    // 清理临时文件
    try { fs.unlinkSync(fileData.filePath); } catch {}

    return standard;
  }

  static async getStandards(params: { skip?: number; take?: number; search?: string; folderId?: string; includeSubFolders?: boolean }): Promise<{ total: number; standards: any[] }> {
    const { skip = 0, take = 10, search, folderId, includeSubFolders } = params;

    const conditions: any[] = [];

    if (search) {
      conditions.push({
        OR: [
          { title: { contains: search, mode: 'insensitive' as const } },
          { standardNo: { contains: search, mode: 'insensitive' as const } },
          { standardName: { contains: search, mode: 'insensitive' as const } },
        ]
      });
    }

    if (folderId === 'unclassified') {
      // 筛选未分类标准（folderId 为 null）
      conditions.push({ folderId: null });
    } else if (folderId) {
      if (includeSubFolders) {
        // 包含子文件夹中的标准
        const folderIds = await StandardFolderService.getDescendantFolderIds(folderId);
        conditions.push({ folderId: { in: folderIds } });
      } else {
        conditions.push({ folderId });
      }
    }
    // 未指定 folderId 时不做过滤（显示全部）

    const where = conditions.length > 0 ? { AND: conditions } : {};

    const [total, standards] = await Promise.all([
      prisma.standard.count({ where }),
      prisma.standard.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, version: true, isActive: true,
          folderId: true,
          folder: { select: { id: true, name: true } },
          maxkbDocId: true,
          source: true,
          // Normative 导入字段
          standardNo: true,
          standardName: true,
          standardIdent: true,
          standardStatus: true,
          publishDate: true,
          implementDate: true,
          abolishDate: true,
          createdAt: true, updatedAt: true,
          _count: { select: { tasks: true } },
        },
      })
    ]);

    return { total, standards };
  }

  static async getStandardById(id: string): Promise<Standard | null> {
    return prisma.standard.findUnique({
      where: { id }
    });
  }

  /** 获取标准详情 */
  static async getStandardDetail(id: string): Promise<any | null> {
    return prisma.standard.findUnique({
      where: { id },
      include: {
        folder: { select: { id: true, name: true } },
        _count: { select: { tasks: true } },
      },
    });
  }

  static async updateStandard(
    id: string,
    data: Partial<{
      title: string
      version: string
      isActive: boolean
      folderId: string | null
      // Normative 特有字段
      standardNo?: string
      standardName?: string
      standardIdent?: string
      standardStatus?: string
      publishDate?: string | null
      implementDate?: string | null
      abolishDate?: string | null
    }>
  ): Promise<Standard> {
    const updateData: any = { ...data }
    // folderId 显式设为 null 时清除文件夹关联
    if (data.folderId !== undefined) {
      updateData.folderId = data.folderId || null
    }
    // 日期字段转换
    if (data.publishDate !== undefined) {
      updateData.publishDate = data.publishDate ? new Date(data.publishDate) : null
    }
    if (data.implementDate !== undefined) {
      updateData.implementDate = data.implementDate ? new Date(data.implementDate) : null
    }
    if (data.abolishDate !== undefined) {
      updateData.abolishDate = data.abolishDate ? new Date(data.abolishDate) : null
    }
    // 状态枚举转换
    if (data.standardStatus !== undefined) {
      updateData.standardStatus = data.standardStatus as any
    }
    return prisma.standard.update({ where: { id }, data: updateData })
  }

  static async deleteStandard(id: string): Promise<Standard> {
    // 删除前检查是否有 MaxKB 关联文档，如有则自动清理
    const standard = await prisma.standard.findUnique({ where: { id } });
    if (standard?.maxkbDocId) {
      try {
        await MaxKBService.deleteStandardDocument(id);
        console.log(`[Standard] 已自动清理 MaxKB 文档: ${standard.title}`);
      } catch (e: any) {
        console.warn(`[Standard] 清理 MaxKB 文档失败 (${standard.title}):`, e.message);
      }
    }
    return prisma.standard.delete({ where: { id } });
  }

  /**
   * 导出标准库为 Excel
   */
  static async exportToExcel(): Promise<Buffer> {
    const standards = await prisma.standard.findMany({
      orderBy: { createdAt: 'desc' },
      include: { folder: { select: { name: true } } },
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('标准规范库');

    worksheet.columns = [
      { header: '标准号', key: 'title', width: 25 },
      { header: '标准编号', key: 'standardNo', width: 25 },
      { header: '标准名称', key: 'standardName', width: 30 },
      { header: '所属文件夹', key: 'folderName', width: 20 },
      { header: '版本', key: 'version', width: 15 },
      { header: '启用状态', key: 'isActive', width: 12 },
      { header: '来源', key: 'source', width: 12 },
      { header: '创建时间', key: 'createdAt', width: 20 },
      { header: '更新时间', key: 'updatedAt', width: 20 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };

    const sourceLabels: Record<string, string> = { maxkb: 'MaxKB', manual: '手动', import: '导入', temp_archive: '归档' };

    standards.forEach((std) => {
      worksheet.addRow({
        title: std.title,
        standardNo: std.standardNo || '',
        standardName: std.standardName || '',
        folderName: std.folder?.name || '',
        version: std.version,
        isActive: std.isActive ? '启用' : '停用',
        source: sourceLabels[std.source || ''] || std.source || '手动',
        createdAt: std.createdAt.toLocaleString('zh-CN'),
        updatedAt: std.updatedAt.toLocaleString('zh-CN'),
      });
    });

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  /**
   * 从 Excel 导入标准库
   */
  static async importFromExcel(filePath: string, defaultFolderId?: string): Promise<{ imported: number; skipped: number }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error('Excel 文件中没有工作表');

    let imported = 0; let skipped = 0;

    // 查找各列的位置
    const headerRow = worksheet.getRow(1);
    let noCol = -1, nameCol = -1, folderColIndex = -1, versionCol = -1;
    for (let c = 1; c <= headerRow.cellCount; c++) {
      const header = headerRow.getCell(c).value?.toString()?.trim();
      if (!header) continue;
      if (/标准号|编号/.test(header) && !/标准名称/.test(header)) noCol = c;
      else if (/标准名称|名称/.test(header)) nameCol = c;
      else if (/所属文件夹/.test(header)) folderColIndex = c;
      else if (/版本/.test(header)) versionCol = c;
    }

    // 回退列索引
    if (noCol === -1) noCol = 1;
    if (versionCol === -1) versionCol = folderColIndex > 0 ? 4 : 3;

    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      const title = row.getCell(noCol).value?.toString()?.trim();
      const standardNo = title;
      const standardName = nameCol > 0 ? row.getCell(nameCol).value?.toString()?.trim() : null;
      const version = row.getCell(versionCol).value?.toString()?.trim() || 'v1.0';
      const folderName = folderColIndex > 0 ? row.getCell(folderColIndex).value?.toString()?.trim() : null;

      if (!title) { skipped++; continue; }

      // 尝试按文件夹名称匹配文件夹
      let folderId: string | null = defaultFolderId || null;
      if (folderName) {
        const folder = await prisma.standardFolder.findFirst({
          where: { name: folderName },
        });
        if (folder) folderId = folder.id;
      }

      await prisma.standard.create({
        data: {
          title,
          standardNo,
          standardName,
          version,
          isActive: true,
          folderId,
          source: 'import',
        },
      });
      imported++;
    }

    try { fs.unlinkSync(filePath); } catch {}
    return { imported, skipped };
  }

  /**
   * 实时标准比对预览（输入编号，返回匹配结果）
   */
  static async checkStandard(standardNo: string, standardName?: string): Promise<{
    matched: boolean;
    matchLevel: number;
    matchedItem: any | null;
    similarity?: number;
    diffRanges?: any;
  }> {
    const docStandard: StandardCheckItem = {
      standardNo,
      standardName: standardName || '',
      standardIdent: StandardExtractorService.getIdent(standardNo),
    };

    const standards = await prisma.standard.findMany({
      where: { standardNo: { not: null } },
      select: {
        id: true,
        standardNo: true,
        standardName: true,
        standardIdent: true,
        standardStatus: true,
      },
    });

    const checkLibrary: StandardCheckItem[] = standards
      .filter(s => s.standardNo)
      .map(s => ({
        id: s.id,
        standardNo: s.standardNo!,
        standardName: s.standardName || '',
        standardIdent: s.standardIdent || StandardExtractorService.getIdent(s.standardNo!),
        standardStatus: s.standardStatus,
      }));

    const result = StandardCheckService.findBestMatch(docStandard, checkLibrary);

    let diffRanges: any = null;
    if (result.matchedItem && result.matched) {
      const noDiff = CharDiffService.compare(standardNo, result.matchedItem.standardNo);
      const nameDiffRes = standardName && result.matchedItem.standardName
        ? CharDiffService.compare(standardName, result.matchedItem.standardName)
        : { originalRanges: [], correctRanges: [] };

      if (noDiff.originalRanges.length > 0 || nameDiffRes.originalRanges.length > 0) {
        diffRanges = {
          original: noDiff.originalRanges,
          correct: noDiff.correctRanges,
          nameOriginal: nameDiffRes.originalRanges,
          nameCorrect: nameDiffRes.correctRanges,
        };
      }
    }

    return {
      matched: result.matched,
      matchLevel: result.matchLevel,
      matchedItem: result.matchedItem ? {
        id: result.matchedItem.id,
        standardNo: result.matchedItem.standardNo,
        standardName: result.matchedItem.standardName,
        standardIdent: result.matchedItem.standardIdent,
        standardStatus: result.matchedItem.standardStatus,
      } : null,
      similarity: result.similarity,
      diffRanges,
    };
  }

  /**
   * 从文本中提取标准引用（供外部调用）
   */
  static extractStandardRefs(text: string, docType?: string) {
    return StandardExtractorService.extractFromText(text, docType);
  }

  /** 生成导入模板 */
  static async generateTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('标准规范导入模板');

    worksheet.columns = [
      { header: '标准号', key: 'title', width: 25 },
      { header: '标准编号', key: 'standardNo', width: 25 },
      { header: '标准名称', key: 'standardName', width: 30 },
      { header: '所属文件夹', key: 'folderName', width: 20 },
      { header: '版本', key: 'version', width: 15 },
    ];

    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
    worksheet.addRow({ title: 'GB/T 50xxx-2024', standardNo: 'GB/T 50xxx-2024', standardName: '房屋建筑制图统一标准', folderName: '国家标准', version: 'v1.0' });
    worksheet.addRow([]);
    worksheet.addRow({ title: '说明：所属文件夹填写文件夹名称（需已存在），全文内容请在 MaxKB 知识库中管理' });

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  // ===== 临时标准库（已持久化到 DB） =====

  /** 导入临时标准库（持久化到数据库） */
  static async importTempLibrary(filePath: string, userId?: string): Promise<{ count: number }> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error('Excel 文件中没有工作表');

    const key = userId || 'default';

    // 先清除该用户已有的临时标准
    await prisma.tempStandardEntry.deleteMany({ where: { userId: key } });

    // 智能检测列格式：第一行为表头
    const headerRow = worksheet.getRow(1);
    let noCol = -1, nameCol = -1, identCol = -1;

    for (let c = 1; c <= headerRow.cellCount; c++) {
      const header = headerRow.getCell(c).value?.toString()?.trim();
      if (!header) continue;
      if (/标准编号|标准号|编号/.test(header)) noCol = c;
      else if (/标准名称|名称/.test(header)) nameCol = c;
      else if (/标识符|前缀/.test(header)) identCol = c;
    }

    // 如果没有找到标准编号列，尝试按固定列位置
    if (noCol === -1) noCol = 1;
    if (nameCol === -1 && headerRow.cellCount >= 2) nameCol = 2;

    const entries: any[] = [];
    const items: StandardCheckItem[] = [];

    for (let i = 2; i <= worksheet.rowCount; i++) {
      const row = worksheet.getRow(i);
      const standardNo = row.getCell(noCol).value?.toString()?.trim();
      if (!standardNo) continue;

      const standardName = nameCol > 0 ? row.getCell(nameCol).value?.toString()?.trim() || '' : '';
      const standardIdent = identCol > 0
        ? row.getCell(identCol).value?.toString()?.trim() || ''
        : StandardExtractorService.getIdent(standardNo);

      entries.push({
        userId: key,
        standardNo,
        standardName: standardName || null,
        standardIdent: standardIdent || null,
        sourceFile: path.basename(filePath),
        importType: 'excel',
      });

      items.push({ standardNo, standardName, standardIdent });
    }

    // 批量写入数据库
    if (entries.length > 0) {
      await prisma.tempStandardEntry.createMany({ data: entries });
    }

    // 更新内存缓存（查询加速）
    this.tempLibraryCache.set(key, items);

    try { fs.unlinkSync(filePath); } catch {}
    return { count: items.length };
  }

  /** 获取临时标准库（优先内存缓存，否则从 DB 加载） */
  static async getTempLibrary(userId?: string): Promise<{ items: StandardCheckItem[]; count: number }> {
    const key = userId || 'default';

    // 命中内存缓存
    const cached = this.tempLibraryCache.get(key);
    if (cached) {
      return { items: cached, count: cached.length };
    }

    // 从数据库加载
    const entries = await prisma.tempStandardEntry.findMany({
      where: { userId: key },
      orderBy: { createdAt: 'asc' },
    });

    const items: StandardCheckItem[] = entries.map(e => ({
      standardNo: e.standardNo,
      standardName: e.standardName || '',
      standardIdent: e.standardIdent || StandardExtractorService.getIdent(e.standardNo),
      id: e.id,
    }));

    // 写入缓存
    this.tempLibraryCache.set(key, items);

    return { items, count: items.length };
  }

  /** 清除临时标准库（DB + 内存缓存） */
  static async clearTempLibrary(userId?: string): Promise<void> {
    const key = userId || 'default';
    await prisma.tempStandardEntry.deleteMany({ where: { userId: key } });
    this.tempLibraryCache.delete(key);
  }

  /** 使用临时标准库进行比对 */
  static async checkStandardWithTempLibrary(standardNo: string, standardName?: string, userId?: string): Promise<any> {
    const key = userId || 'default';
    const { items: tempLibrary } = await this.getTempLibrary(key);

    if (tempLibrary.length === 0) {
      return { matched: false, matchLevel: 0, matchedItem: null, error: '临时标准库为空，请先导入' };
    }

    const docStandard: StandardCheckItem = {
      standardNo,
      standardName: standardName || '',
      standardIdent: StandardExtractorService.getIdent(standardNo),
    };

    const result = StandardCheckService.findBestMatch(docStandard, tempLibrary);

    let diffRanges: any = null;
    if (result.matchedItem && result.matched) {
      const noDiff = CharDiffService.compare(standardNo, result.matchedItem.standardNo);
      const nameDiffRes = standardName && result.matchedItem.standardName
        ? CharDiffService.compare(standardName, result.matchedItem.standardName)
        : { originalRanges: [], correctRanges: [] };

      if (noDiff.originalRanges.length > 0 || nameDiffRes.originalRanges.length > 0) {
        diffRanges = {
          original: noDiff.originalRanges,
          correct: noDiff.correctRanges,
          nameOriginal: nameDiffRes.originalRanges,
          nameCorrect: nameDiffRes.correctRanges,
        };
      }
    }

    return {
      matched: result.matched,
      matchLevel: result.matchLevel,
      matchedItem: result.matchedItem,
      similarity: result.similarity,
      diffRanges,
      librarySource: 'temp',
    };
  }

  /** 将临时标准库条目归档为正式标准 */
  static async archiveTempToStandard(entryIds: string[], userId?: string): Promise<{ archived: number; skipped: number }> {
    const entries = await prisma.tempStandardEntry.findMany({
      where: { id: { in: entryIds } },
    });

    let archived = 0;
    let skipped = 0;

    for (const entry of entries) {
      // 检查是否已存在该标准编号
      const existing = await prisma.standard.findFirst({
        where: { standardNo: entry.standardNo },
      });

      if (existing) {
        skipped++;
        continue;
      }

      // 创建正式标准
      await prisma.standard.create({
        data: {
          title: entry.standardNo,
          version: 'v1.0',
          isActive: true,
          standardNo: entry.standardNo,
          standardName: entry.standardName,
          standardIdent: entry.standardIdent || StandardExtractorService.getIdent(entry.standardNo),
          source: 'temp_archive',
          importedBy: userId || null,
        },
      });

      // 删除临时条目
      await prisma.tempStandardEntry.delete({
        where: { id: entry.id },
      });

      // 清除缓存
      this.tempLibraryCache.delete(userId || 'default');

      archived++;
    }

    return { archived, skipped };
  }

  /** 归档所有临时标准库条目 */
  static async archiveAllTempToStandard(userId?: string): Promise<{ archived: number; skipped: number }> {
    const key = userId || 'default';
    const entries = await prisma.tempStandardEntry.findMany({
      where: { userId: key },
    });

    if (entries.length === 0) {
      return { archived: 0, skipped: 0 };
    }

    const entryIds = entries.map(e => e.id);
    return this.archiveTempToStandard(entryIds, userId);
  }

  // ===== Normative 格式 Excel 标准库解析 =====

  /**
   * Normative 格式 Excel 标准库解析
   * 
   * 兼容 Normative 工具导出的 Excel 格式，表头列：
   * - 列0: 状态 (PurchasingStatus) - 如 "采购中"、"已采购"
   * - 列1: 标准编号 (StandardStatus) - 如 "现行"、"即将实施"
   * - 列2: 标准编号 (StandardNo) - 如 "GB/T 50001-2017"
   * - 列3: 标准名称 (StandardName) - 如 "房屋建筑制图统一标准"
   * - 列4: 发布日期 (PublishDate) - 如 "2017-01-01"
   * - 列5: 实施日期 (ImplementDate) - 如 "2017-07-01"
   * - 列6: 废止日期 (RepealDate) - 如 "2025-01-01"（可选）
   * 
   * 同时支持灵活列检测，会根据表头名称自动匹配列位置。
   * 
   * @param filePath Excel 文件路径
   * @param options 解析选项
   * @returns 解析结果统计
   */
  static async importNormativeFormatExcel(
    filePath: string,
    options: {
      defaultFolderId?: string;
      skipInvalidRows?: boolean;  // 是否跳过无效行（默认跳过）
      overwriteExisting?: boolean; // 是否覆盖已存在的标准（默认不覆盖）
      dryRun?: boolean;           // 试运行模式，仅返回预览不写入
    } = {}
  ): Promise<{
    success: boolean;
    total: number;           // 总行数（含表头）
    valid: number;          // 有效行数
    imported: number;        // 导入成功数
    skipped: number;         // 跳过数
    errors: Array<{ row: number; message: string; data?: any }>;
    preview: Array<{
      row: number;
      standardNo: string;
      standardName: string;
      standardIdent: string;
      status: string;
      publishDate?: string;
      implementDate?: string;
      repealDate?: string;
      isValid: boolean;
      error?: string;
    }>;
  }> {
    const { 
      defaultFolderId, 
      skipInvalidRows = true, 
      overwriteExisting = false,
      dryRun = false 
    } = options;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new Error('Excel 文件中没有工作表');
    }

    // ===== 检测列位置 =====
    const headerRow = worksheet.getRow(1);
    const columnMap: Record<string, number> = {}; // 列名 -> 列索引（从1开始）
    
    // Normative 格式的列名映射（支持多种命名）
    // 注意：不要让不同字段匹配相同的表头
    const columnMappings: Record<string, string[]> = {
      purchasingStatus: ['状态', ' PurchasingStatus', '采购状态'],
      standardNo: ['标准编号', 'StandardNo', '编号'],
      standardName: ['标准名称', 'StandardName', '名称'],
      publishDate: ['发布日期', 'PublishDate', '发布', '出版日期'],
      implementDate: ['实施日期', 'ImplementDate', '实施'],
      repealDate: ['废止日期', 'RepealDate', '废止'],
    };

    for (let c = 1; c <= headerRow.cellCount; c++) {
      const header = headerRow.getCell(c).value?.toString()?.trim() || '';
      for (const [field, names] of Object.entries(columnMappings)) {
        if (names.some(name => header.includes(name) || header === name)) {
          if (!columnMap[field]) {
            columnMap[field] = c;
          }
        }
      }
    }

    // 如果找不到标准编号列，尝试使用固定列位置（Normative 默认格式）
    // 列1=状态, 列2=编号, 列3=名称, 列4=发布, 列5=实施, 列6=废止
    if (!columnMap.standardNo) {
      columnMap.purchasingStatus = 1;
      columnMap.standardStatus = 2;
      columnMap.standardNo = 3;
      columnMap.standardName = 4;
      columnMap.publishDate = 5;
      columnMap.implementDate = 6;
      columnMap.repealDate = 7;
    }

    // ===== 解析数据行 =====
    const preview: Array<{
      row: number;
      standardNo: string;
      standardName: string;
      standardIdent: string;
      status: string;
      publishDate?: string;
      implementDate?: string;
      repealDate?: string;
      isValid: boolean;
      error?: string;
    }> = [];
    
    const errors: Array<{ row: number; message: string; data?: any }> = [];
    let validCount = 0;
    let importedCount = 0;
    let skippedCount = 0;

    for (let i = 2; i <= worksheet.rowCount; i++) {
      const rowNum = i;
      const row = worksheet.getRow(i);

      try {
        // 获取单元格值
        const getCellValue = (colName: string): string => {
          const col = columnMap[colName];
          if (!col) return '';
          const cell = row.getCell(col);
          if (!cell.value) return '';
          // 处理日期类型
          if (cell.type === ExcelJS.ValueType.Date) {
            const date = cell.value as Date;
            return date.toISOString().split('T')[0];
          }
          return String(cell.value).trim();
        };

        const standardNo = getCellValue('standardNo');
        const standardName = getCellValue('standardName');
        const purchasingStatus = getCellValue('purchasingStatus');
        const standardStatus = getCellValue('standardStatus');
        const publishDateStr = getCellValue('publishDate');
        const implementDateStr = getCellValue('implementDate');
        const repealDateStr = getCellValue('repealDate');

        // 跳过空行：标准编号列为空且标准名称列也为空
        if (!standardNo && !standardName) {
          continue;
        }

        // 跳过模板说明行：标准编号列包含说明关键字
        const descKeywords = ['说明', '状态列', '标准编号格式', '日期格式', '系统会', '必填列', '填写：', '格式：', '标识符'];
        if (descKeywords.some(kw => standardNo.includes(kw) || standardName.includes(kw))) {
          continue;
        }

        // 解析日期
        const parseDate = (str: string): Date | null => {
          if (!str) return null;
          try {
            const date = new Date(str);
            return isNaN(date.getTime()) ? null : date;
          } catch {
            return null;
          }
        };

        const publishDate = parseDate(publishDateStr);
        const implementDate = parseDate(implementDateStr);
        const repealDate = parseDate(repealDateStr);

        // 验证必填字段
        if (!standardNo) {
          preview.push({
            row: rowNum,
            standardNo: '',
            standardName,
            standardIdent: '',
            status: purchasingStatus || standardStatus || '',
            isValid: false,
            error: '标准编号为空',
          });
          errors.push({ row: rowNum, message: '标准编号为空', data: { standardName } });
          skippedCount++;
          continue;
        }

        // 自动提取标识符
        const standardIdent = StandardExtractorService.getIdent(standardNo);

        // 确定标准状态
        let mappedStatus: 'CURRENT' | 'UPCOMING' | 'ABOLISHED' = 'CURRENT';
        if (repealDate && repealDate <= new Date()) {
          mappedStatus = 'ABOLISHED';
        } else if (implementDate && implementDate > new Date()) {
          mappedStatus = 'UPCOMING';
        }

        validCount++;
        preview.push({
          row: rowNum,
          standardNo,
          standardName,
          standardIdent,
          status: purchasingStatus || standardStatus || '',
          publishDate: publishDateStr,
          implementDate: implementDateStr,
          repealDate: repealDateStr,
          isValid: true,
        });

        // 如果不是试运行，则写入数据库
        if (!dryRun) {
          // 检查是否已存在
          const existing = await prisma.standard.findFirst({
            where: { standardNo },
          });

          if (existing) {
            if (overwriteExisting) {
              // 更新已存在的标准
              await prisma.standard.update({
                where: { id: existing.id },
                data: {
                  standardName: standardName || existing.standardName,
                  standardIdent: standardIdent || existing.standardIdent,
                  standardStatus: mappedStatus,
                  publishDate,
                  implementDate,
                  abolishDate: repealDate,
                },
              });
              importedCount++;
            } else {
              skippedCount++;
            }
          } else {
            // 创建新标准
            await prisma.standard.create({
              data: {
                title: standardNo,
                version: 'v1.0',
                isActive: mappedStatus !== 'ABOLISHED',
                standardNo,
                standardName: standardName || null,
                standardIdent: standardIdent || null,
                standardStatus: mappedStatus,
                publishDate,
                implementDate,
                abolishDate: repealDate,
                folderId: defaultFolderId || null,
                source: 'normative_import',
              },
            });
            importedCount++;
          }
        }
      } catch (err: any) {
        const errorMsg = err.message || '未知错误';
        preview.push({
          row: rowNum,
          standardNo: '',
          standardName: '',
          standardIdent: '',
          status: '',
          isValid: false,
          error: errorMsg,
        });
        errors.push({ row: rowNum, message: errorMsg });
        skippedCount++;
      }
    }

    // 清理临时文件
    try { fs.unlinkSync(filePath); } catch {}

    return {
      success: errors.length === 0,
      total: worksheet.rowCount,
      valid: validCount,
      imported: dryRun ? 0 : importedCount,
      skipped: skippedCount,
      errors: skipInvalidRows ? errors : errors.filter(e => e.message !== '标准编号为空'),
      preview,
    };
  }

  /**
   * 生成 Normative 格式的 Excel 导入模板
   */
  static async generateNormativeTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('标准规范库');

    // 设置表头行
    worksheet.columns = [
      { header: '状态', key: 'status', width: 12 },
      { header: '标准编号', key: 'standardNo', width: 25 },
      { header: '标准名称', key: 'standardName', width: 35 },
      { header: '发布日期', key: 'publishDate', width: 15 },
      { header: '实施日期', key: 'implementDate', width: 15 },
      { header: '废止日期', key: 'repealDate', width: 15 },
    ];

    // 表头样式
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

    // 示例数据（涵盖多种标准类型和状态）
    const sampleData = [
      // 现行标准
      { status: '现行', standardNo: 'GB/T 50001-2017', standardName: '房屋建筑制图统一标准', publishDate: '2017-01-01', implementDate: '2017-07-01', repealDate: '' },
      { status: '现行', standardNo: 'GB 50016-2014', standardName: '建筑设计防火规范（2018年版）', publishDate: '2014-08-01', implementDate: '2015-05-01', repealDate: '' },
      { status: '现行', standardNo: 'GB 50009-2012', standardName: '建筑结构荷载规范', publishDate: '2012-09-01', implementDate: '2012-12-01', repealDate: '' },
      { status: '现行', standardNo: 'GB 50367-2013', standardName: '混凝土结构加固设计规范', publishDate: '2013-08-08', implementDate: '2014-06-01', repealDate: '' },
      { status: '现行', standardNo: 'GB 50108-2008', standardName: '地下工程防水技术规范', publishDate: '2008-09-18', implementDate: '2009-04-01', repealDate: '' },
      { status: '现行', standardNo: 'GB 50487-2008', standardName: '水利水电工程地质勘察规范', publishDate: '2008-12-15', implementDate: '2009-07-01', repealDate: '' },
      { status: '现行', standardNo: 'NB/T 20292-2014', standardName: '压水堆核电厂核岛混凝土结构设计规范', publishDate: '2014-03-21', implementDate: '2014-08-01', repealDate: '' },
      { status: '现行', standardNo: 'NB/T 20358.1-2015', standardName: '核电厂建设工程计算分析规范', publishDate: '2015-10-15', implementDate: '2016-03-01', repealDate: '' },
      { status: '现行', standardNo: 'JGJ 94-2010', standardName: '建筑桩基技术规范', publishDate: '2010-07-15', implementDate: '2011-10-01', repealDate: '' },
      { status: '现行', standardNo: 'JGJ 118-2011', standardName: '冻土地区建筑地基基础设计规范', publishDate: '2011-02-11', implementDate: '2011-12-01', repealDate: '' },
      // 即将实施标准
      { status: '即将实施', standardNo: 'GB 55001-2021', standardName: '工程结构通用规范', publishDate: '2021-04-09', implementDate: '2022-01-01', repealDate: '' },
      { status: '即将实施', standardNo: 'GB 55002-2021', standardName: '建筑与市政工程抗震通用规范', publishDate: '2021-04-09', implementDate: '2022-01-01', repealDate: '' },
      // 已废止标准
      { status: '已废止', standardNo: 'GBJ 16-87', standardName: '建筑设计防火规范（修订本）', publishDate: '1987-05-14', implementDate: '1988-05-01', repealDate: '2015-05-01' },
      { status: '已废止', standardNo: 'GB 50009-2001', standardName: '建筑结构荷载规范', publishDate: '2001-12-21', implementDate: '2002-07-01', repealDate: '2012-12-01' },
    ];

    for (const data of sampleData) {
      worksheet.addRow(data);
    }

    // 添加说明行
    worksheet.addRow([]);
    worksheet.addRow({ standardNo: '说明：' });
    worksheet.addRow({ standardNo: '1. 状态列填写：现行/即将实施/已废止（可不填，系统自动根据日期判断）' });
    worksheet.addRow({ standardNo: '2. 标准编号格式：GB/T 50001-2017、NB/T 20292-2014 等' });
    worksheet.addRow({ standardNo: '3. 日期格式：YYYY-MM-DD（如 2017-01-01）' });
    worksheet.addRow({ standardNo: '4. 系统会自动提取标识符（如 GB、GB/T、NB/T）' });
    worksheet.addRow({ standardNo: '5. 必填列：标准编号；可选列：标准名称、发布日期、实施日期、废止日期' });

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }
}
