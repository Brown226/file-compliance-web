/**
 * 标准引用规范性检查服务
 *
 * 从 BasePipeline.runStandardRefCheck 提取而来，
 * 负责：提取文档中的标准引用 → 8级比对 → 字符级差异定位。
 */

import { PipelineContext } from './types';
import { ReviewIssue } from '../llm/llm.service';
import { StandardExtractorService } from '../standard/standard-extractor.service';
import { StandardCheckService, StandardCheckItem } from '../standard/standard-check.service';
import { CharDiffService } from '../file/char-diff.service';
import prisma from '../../config/db';

export class StandardRefCheckService {
  /**
   * 公共步骤: 标准引用规范性检查
   * 提取文档中的标准引用 → 8级比对 → 字符级差异定位
   */
  static async runStandardRefCheck(
    ctx: PipelineContext,
    extractedText: string,
  ): Promise<ReviewIssue[]> {
    if (!extractedText || !extractedText.trim()) {
      return [];
    }

    // 1. 提取标准引用
    let extractedRefs = StandardExtractorService.extractFromText(extractedText, ctx.fileType);

    // Excel 文件额外固定列提取
    if (['xlsx', 'xls'].includes(ctx.fileType.toLowerCase()) && ctx.filePath) {
      try {
        const columnRefs = await StandardExtractorService.extractFromExcelByColumn(ctx.filePath);
        const existingNos = new Set(extractedRefs.map(r => r.standardNo));
        for (const ref of columnRefs) {
          if (!existingNos.has(ref.standardNo)) {
            extractedRefs.push(ref);
            existingNos.add(ref.standardNo);
          }
        }
      } catch (e) {
        console.warn('[Pipeline] Excel 固定列提取失败:', e);
      }
    }

    if (extractedRefs.length === 0) return [];

    // 2. 加载标准库
    const standards = await prisma.standard.findMany({
      where: { standardNo: { not: null } },
      select: { id: true, standardNo: true, standardName: true, standardIdent: true, standardStatus: true },
    });

    if (standards.length === 0) {
      console.warn('[StandardRefCheck] 标准库为空，跳过标准引用检查');
      return [{
        issueType: 'COMPLETENESS',
        ruleCode: 'STD_000',
        severity: 'warning',
        originalText: '',
        description: '标准库为空，无法进行标准引用检查，请管理员导入标准规范',
      }];
    }

    const checkLibrary: StandardCheckItem[] = standards
      .filter(s => s.standardNo)
      .map(s => ({
        id: s.id,
        standardNo: s.standardNo!,
        standardName: s.standardName || '',
        standardIdent: s.standardIdent || StandardExtractorService.getIdent(s.standardNo!),
        standardStatus: s.standardStatus,
      }));

    // 3. 逐个引用进行 8 级比对 + 字符差异定位
    const issues: ReviewIssue[] = [];

    for (const ref of extractedRefs) {
      const matchResult = StandardCheckService.findBestMatch(ref, checkLibrary);

      if (!matchResult.matched) {
        issues.push({
          issueType: 'VIOLATION',
          ruleCode: 'STD_001',
          originalText: ref.fullMatch,
          description: `未找到该标准规范: ${ref.standardNo}${ref.standardName ? ` (${ref.standardName})` : ''}`,
        });
      } else if (matchResult.matchedItem) {
        const matchLevel = matchResult.matchLevel;
        const libItem = matchResult.matchedItem;

        // 标准状态检查
        if (libItem.standardStatus === 'ABOLISHED') {
          issues.push({
            issueType: 'VIOLATION', ruleCode: 'STD_003',
            originalText: ref.fullMatch,
            suggestedText: libItem.standardNo,
            description: `该标准已废止: ${libItem.standardNo}`,
          });
          continue;
        }
        if (libItem.standardStatus === 'UPCOMING') {
          issues.push({
            issueType: 'VIOLATION', ruleCode: 'STD_004', severity: 'info',
            originalText: ref.fullMatch,
            suggestedText: libItem.standardNo,
            description: `该标准尚未实施: ${libItem.standardNo}`,
          });
          continue;
        }

        // 版本号检查（年份不匹配）
        if (ref.standardNo && libItem.standardNo && matchLevel >= 3) {
          const docYear = this.extractYear(ref.standardNo);
          const libYear = this.extractYear(libItem.standardNo);
          if (docYear && libYear && docYear !== libYear) {
            issues.push({
              issueType: 'VIOLATION', ruleCode: 'STD_005',
              originalText: ref.fullMatch,
              suggestedText: libItem.standardNo,
              description: `标准版本不一致: 文档引用版本 ${docYear}，标准库版本 ${libYear}`,
            });
            continue;
          }
        }

        // 字符级差异定位
        const noDiff = CharDiffService.compare(ref.standardNo, libItem.standardNo);
        const nameDiff = ref.standardName && libItem.standardName
          ? CharDiffService.compare(ref.standardName, libItem.standardName)
          : { originalRanges: [] as any[], correctRanges: [] as any[] };

        if (noDiff.originalRanges.length > 0 || nameDiff.originalRanges.length > 0) {
          const diffRanges: any = {};
          if (noDiff.originalRanges.length > 0 || noDiff.correctRanges.length > 0) {
            diffRanges.original = noDiff.originalRanges;
            diffRanges.correct = noDiff.correctRanges;
          }
          if (nameDiff.originalRanges.length > 0 || nameDiff.correctRanges.length > 0) {
            diffRanges.nameOriginal = nameDiff.originalRanges;
            diffRanges.nameCorrect = nameDiff.correctRanges;
          }

          issues.push({
            issueType: 'VIOLATION', ruleCode: 'STD_002',
            originalText: ref.standardNo + (ref.standardName ? ` (${ref.standardName})` : ''),
            suggestedText: libItem.standardNo + (libItem.standardName ? ` (${libItem.standardName})` : ''),
            description: `标准引用有误: "${ref.standardNo}" 应为 "${libItem.standardNo}"${matchResult.similarity ? ` (相似度: ${(matchResult.similarity * 100).toFixed(0)}%)` : ''}`,
            diffRanges,
          });
        }
      }
    }

    return issues;
  }

  /**
   * 从标准编号中提取年份（取最后一个4位数字）
   */
  private static extractYear(standardNo: string): string | null {
    const matches = standardNo.match(/\d{4}/g);
    if (!matches || matches.length === 0) return null;
    const last = matches[matches.length - 1];
    const year = parseInt(last, 10);
    return (year >= 1900 && year <= 2099) ? last : null;
  }
}
