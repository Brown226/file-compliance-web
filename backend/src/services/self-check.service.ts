/**
 * 标准引用自检编排服务
 * Normative 核心流程的 Node.js 移植
 *
 * 完整链路：接收设计文件 → 解析文本 → 提取标准引用 → 逐条与标准库比对 → 生成结构化报告
 */

import prisma from '../config/db';
import { ParserService } from './parser.service';
import { StandardExtractorService, ExtractedStandard } from './standard-extractor.service';
import { StandardCheckService, StandardCheckItem } from './standard-check.service';
import { CharDiffService, DiffResult } from './char-diff.service';

// ============ 类型定义 ============

/** 单条标准引用的自检结果 */
export interface SelfCheckItem {
  docStandardNo: string;          // 文档中提取的标准编号
  docStandardName: string;        // 文档中提取的标准名称
  matchResult: {
    matched: boolean;
    matchLevel: number;
    libraryId?: string;
    libraryStandardNo?: string;
    libraryStandardName?: string;
    libraryStandardStatus?: string;
    similarity?: number;
  };
  /** 错误类型 */
  errorTypes: SelfCheckErrorType[];
  /** 编号差异定位 */
  noDiff?: DiffResult | null;
  /** 名称差异定位 */
  nameDiff?: DiffResult | null;
  /** 原始匹配文本 */
  fullMatch: string;
  /** 来源文件 */
  sourceFile: string;
  /** 在原文中的起始字符位置（0-based），Excel提取时为-1 */
  startChar: number;
  /** 在原文中的结束字符位置（0-based, exclusive） */
  endChar: number;
  /** 匹配文本所在行号（1-based），无法确定时为-1 */
  lineNumber: number;
  /** 匹配文本周围的原文上下文（前后各约200字符），用于预览定位 */
  contextText: string;
}

export type SelfCheckErrorType =
  | 'NO_MATCH'           // 标准库中不存在
  | 'NUMBER_MISMATCH'    // 编号错误
  | 'NAME_MISMATCH'      // 名称错误
  | 'ABOLISHED'           // 标准已废止
  | 'UPCOMING'            // 标准尚未实施
  | 'VERSION_MISMATCH';   // 版本号不匹配

/** 自检报告 */
export interface SelfCheckReport {
  id: string;
  totalChecked: number;       // 检查总数
  matchedCount: number;       // 完全匹配数
  errorCount: number;         // 存在错误数
  items: SelfCheckItem[];
  checkedAt: string;
  standardLibraryInfo: {
    name: string;
    total: number;
  };
}

// ============ 服务 ============

export class SelfCheckService {
  /**
   * 执行标准引用自检 - 完整流程
   *
   * @param filePaths 待检文件路径列表 [{path, originalName}]
   * @param standardFolderId 标准库文件夹ID（null表示全部标准）
   * @param onProgress 进度回调（currentFile / totalFiles / message）
   */
  static async execute(
    filePaths: Array<{ path: string; originalName: string; fileType: string }>,
    standardFolderId: string | null,
    onProgress?: (progress: { current: number; total: number; message: string }) => void
  ): Promise<SelfCheckReport> {
    const reportId = `SC-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const allItems: SelfCheckItem[] = [];
    const totalFiles = filePaths.length;

    // 1. 加载标准库
    onProgress?.({ current: 0, total: totalFiles, message: '正在加载标准库...' });
    const standardLibrary = await SelfCheckService.loadStandardLibrary(standardFolderId);
    const libInfo = await SelfCheckService.getLibraryInfo(standardFolderId);

    // 2. 逐文件处理
    for (let i = 0; i < filePaths.length; i++) {
      const file = filePaths[i];
      onProgress?.({ current: i + 1, total: totalFiles, message: `正在检查: ${file.originalName}` });

      try {
        // 2a. 解析文件文本
        const text = await ParserService.parseFile(file.path, file.fileType);
        if (!text || text.trim().length < 5) {
          // 文件内容过短或解析失败，跳过
          continue;
        }

        // 2b. 提取标准引用
        const extractedRefs = StandardExtractorService.extractFromText(text, file.fileType);

        // 2c. 逐条比对标准库
        for (const ref of extractedRefs) {
          const item = await SelfCheckService.checkSingleStandard(ref, standardLibrary, file.originalName, text);
          allItems.push(item);
        }
      } catch (err: any) {
        console.error(`[SelfCheck] 处理文件失败: ${file.originalName}`, err.message);
      }

      // 间隙让出事件循环，避免长时间阻塞
      await new Promise(resolve => setImmediate(resolve));
    }

    // 3. 生成报告
    const matchedCount = allItems.filter(it =>
      it.matchResult.matched &&
      it.errorTypes.length === 0 &&
      it.matchResult.matchLevel <= 2
    ).length;

    const errorCount = allItems.filter(it => it.errorTypes.length > 0).length;

    onProgress?.({ current: totalFiles, total: totalFiles, message: '自检完成，正在生成报告...' });

    return {
      id: reportId,
      totalChecked: allItems.length,
      matchedCount,
      errorCount,
      items: allItems,
      checkedAt: new Date().toISOString(),
      standardLibraryInfo: libInfo,
    };
  }

  /**
   * 单条标准与标准库的比对
   * @param fullText 完整的文档文本（用于提取上下文片段）
   */
  private static async checkSingleStandard(
    ref: ExtractedStandard,
    library: StandardCheckItem[],
    sourceFile: string,
    fullText?: string
  ): Promise<SelfCheckItem> {
    const docItem: StandardCheckItem = {
      standardNo: ref.standardNo,
      standardName: ref.standardName,
      standardIdent: ref.standardIdent,
    };

    const matchResult = StandardCheckService.findBestMatch(docItem, library);
    const errorTypes: SelfCheckErrorType[] = [];

    if (!matchResult.matched) {
      errorTypes.push('NO_MATCH');
    } else if (matchResult.matchedItem) {
      const lib = matchResult.matchedItem;

      // 检查编号差异
      if (ref.standardNo && lib.standardNo && ref.standardNo !== lib.standardNo) {
        errorTypes.push('NUMBER_MISMATCH');
      }

      // 检查名称差异
      if (ref.standardName && lib.standardName && ref.standardName.trim() !== lib.standardName.trim()) {
        errorTypes.push('NAME_MISMATCH');
      }

      // 检查标准状态
      if (lib.standardStatus === 'ABOLISHED') {
        errorTypes.push('ABOLISHED');
      } else if (lib.standardStatus === 'UPCOMING') {
        errorTypes.push('UPCOMING');
      }

      // 检查版本号（从编号中提取年份比对）
      if (ref.standardNo && lib.standardNo) {
        const docYear = SelfCheckService.extractYear(ref.standardNo);
        const libYear = SelfCheckService.extractYear(lib.standardNo);
        if (docYear && libYear && docYear !== libYear) {
          errorTypes.push('VERSION_MISMATCH');
        }
      }
    }

    // 差异定位
    let noDiff: DiffResult | null = null;
    let nameDiff: DiffResult | null = null;

    if (matchResult.matchedItem) {
      const lib = matchResult.matchedItem;
      if (ref.standardNo && lib.standardNo) {
        noDiff = CharDiffService.compare(ref.standardNo, lib.standardNo);
      }
      if (ref.standardName && lib.standardName) {
        nameDiff = CharDiffService.compare(ref.standardName, lib.standardName);
      }
    }

    // 计算行号和上下文（有位置信息时）
    const lineNumber = fullText && ref.startChar >= 0
      ? fullText.substring(0, ref.startChar).split('\n').length
      : -1;
    const contextText = fullText && ref.startChar >= 0
      ? SelfCheckService.extractContext(fullText, ref.startChar, ref.endChar)
      : '';

    return {
      docStandardNo: ref.standardNo,
      docStandardName: ref.standardName,
      matchResult: {
        matched: matchResult.matched,
        matchLevel: matchResult.matchLevel,
        libraryId: matchResult.matchedItem?.id,
        libraryStandardNo: matchResult.matchedItem?.standardNo,
        libraryStandardName: matchResult.matchedItem?.standardName,
        libraryStandardStatus: matchResult.matchedItem?.standardStatus,
        similarity: matchResult.similarity,
      },
      errorTypes,
      noDiff,
      nameDiff,
      fullMatch: ref.fullMatch,
      sourceFile,
      startChar: ref.startChar,
      endChar: ref.endChar,
      lineNumber,
      contextText,
    };
  }

  /**
   * 加载标准库（从数据库）
   * @param folderId 指定文件夹ID，null表示全部
   */
  private static async loadStandardLibrary(folderId: string | null): Promise<StandardCheckItem[]> {
    const where: any = {
      standardNo: { not: null },
    };

    if (folderId) {
      where.folderId = folderId;
    }

    const standards = await prisma.standard.findMany({
      where,
      select: {
        id: true,
        standardNo: true,
        standardName: true,
        standardIdent: true,
        standardStatus: true,
      },
      orderBy: { standardNo: 'asc' },
    });

    return standards
      .filter(s => s.standardNo)
      .map(s => ({
        id: s.id,
        standardNo: s.standardNo!,
        standardName: s.standardName || '',
        standardIdent: s.standardIdent || StandardExtractorService.getIdent(s.standardNo!),
        standardStatus: s.standardStatus || undefined,
      }));
  }

  /**
   * 获取标准库信息
   */
  private static async getLibraryInfo(folderId: string | null): Promise<{ name: string; total: number }> {
    const where: any = folderId ? { folderId } : {};
    const total = await prisma.standard.count({ where });
    let name = '全部标准库';
    if (folderId) {
      const folder = await prisma.standardFolder.findUnique({ where: { id: folderId }, select: { name: true } });
      if (folder) name = folder.name;
    }
    return { name, total };
  }

  /**
   * 从全文截取匹配位置周围的上下文文本（前后各约200字符）
   * @param fullText 完整文档文本
   * @param startChar 匹配起始位置
   * @param endChar 匹配结束位置
   * @param contextLen 上下文长度（默认200字符）
   */
  private static extractContext(
    fullText: string,
    startChar: number,
    endChar: number,
    contextLen: number = 200
  ): string {
    const ctxStart = Math.max(0, startChar - contextLen);
    const ctxEnd = Math.min(fullText.length, endChar + contextLen);
    let ctx = fullText.substring(ctxStart, ctxEnd);
    if (ctxStart > 0) ctx = '…' + ctx;
    if (ctxEnd < fullText.length) ctx = ctx + '…';
    return ctx;
  }

  /**
   * 从标准编号中提取年份
   * 例: "GB/T 50001-2017" → "2017"
   */
  private static extractYear(standardNo: string): string | null {
    const match = standardNo.match(/(\d{4})(?:\D|$)/);
    return match ? match[1] : null;
  }

  /**
   * 将错误类型转为中文描述
   */
  static errorTypeLabel(type: SelfCheckErrorType): string {
    const labels: Record<SelfCheckErrorType, string> = {
      NO_MATCH: '标准库中不存在该标准',
      NUMBER_MISMATCH: '编号错误',
      NAME_MISMATCH: '名称错误',
      ABOLISHED: '该标准已废止',
      UPCOMING: '该标准尚未实施',
      VERSION_MISMATCH: '版本号不匹配',
    };
    return labels[type] || type;
  }
}
