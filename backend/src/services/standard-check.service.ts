/**
 * 多级标准比对服务 - 8级比对链 + Levenshtein 相似度
 * 移植自旧系统 Normative CheckDocStandardHelper.GetStandardSimilarity
 */

import { StandardExtractorService } from './standard-extractor.service';

export interface StandardCheckItem {
  standardNo: string;
  standardName: string;
  standardIdent: string;
  id?: string;
  standardStatus?: string;
}

export interface MatchResult {
  matched: boolean;
  matchLevel: number;          // 匹配级别 1-8
  matchedItem: StandardCheckItem | null;
  similarity?: number;         // Levenshtein 相似度（仅 level 8）
  isExactMatch: boolean;       // 是否精确匹配（level 1-2）
}

export class StandardCheckService {
  /**
   * 在标准库中查找最佳匹配
   * 移植自旧系统 GetStandardSimilarity，8级比对链
   */
  static findBestMatch(
    docStandard: StandardCheckItem,
    standardLibrary: StandardCheckItem[]
  ): MatchResult {
    if (!standardLibrary.length) {
      return { matched: false, matchLevel: 0, matchedItem: null, isExactMatch: false };
    }

    // Level 1: 精确匹配 - 名称
    for (const lib of standardLibrary) {
      if (lib.standardName && docStandard.standardName && lib.standardName === docStandard.standardName) {
        return { matched: true, matchLevel: 1, matchedItem: lib, isExactMatch: true };
      }
    }

    // Level 2: 精确匹配 - 编号
    for (const lib of standardLibrary) {
      if (lib.standardNo && docStandard.standardNo && lib.standardNo === docStandard.standardNo) {
        return { matched: true, matchLevel: 2, matchedItem: lib, isExactMatch: true };
      }
    }

    // Level 3: 去空格匹配 - 名称
    for (const lib of standardLibrary) {
      if (lib.standardName && docStandard.standardName &&
          this.removeSpaces(lib.standardName) === this.removeSpaces(docStandard.standardName)) {
        return { matched: true, matchLevel: 3, matchedItem: lib, isExactMatch: false };
      }
    }

    // Level 4: 去空格匹配 - 编号
    for (const lib of standardLibrary) {
      if (lib.standardNo && docStandard.standardNo &&
          this.removeSpaces(lib.standardNo) === this.removeSpaces(docStandard.standardNo)) {
        return { matched: true, matchLevel: 4, matchedItem: lib, isExactMatch: false };
      }
    }

    // Level 5: 标点规范化匹配
    // 5a: 标点规范化 - 名称
    for (const lib of standardLibrary) {
      if (lib.standardName && docStandard.standardName &&
          this.normalizePunctuation(lib.standardName, true) === this.normalizePunctuation(docStandard.standardName, true)) {
        return { matched: true, matchLevel: 5, matchedItem: lib, isExactMatch: false };
      }
    }

    // 5b: 标点规范化+大写 - 名称
    for (const lib of standardLibrary) {
      if (lib.standardName && docStandard.standardName &&
          this.normalizePunctuation(lib.standardName, true).toUpperCase() === 
          this.normalizePunctuation(docStandard.standardName, true).toUpperCase()) {
        return { matched: true, matchLevel: 5, matchedItem: lib, isExactMatch: false };
      }
    }

    // 5c: 标点规范化 - 编号
    for (const lib of standardLibrary) {
      if (lib.standardNo && docStandard.standardNo &&
          this.normalizePunctuation(lib.standardNo) === this.normalizePunctuation(docStandard.standardNo)) {
        return { matched: true, matchLevel: 5, matchedItem: lib, isExactMatch: false };
      }
    }

    // 5d: 标点规范化+大写 - 编号
    for (const lib of standardLibrary) {
      if (lib.standardNo && docStandard.standardNo &&
          this.normalizePunctuation(lib.standardNo).toUpperCase() === 
          this.normalizePunctuation(docStandard.standardNo).toUpperCase()) {
        return { matched: true, matchLevel: 5, matchedItem: lib, isExactMatch: false };
      }
    }

    // Level 6: 包含匹配（编号）
    // 6a: 文档编号包含在库编号中（去空格）
    for (const lib of standardLibrary) {
      if (lib.standardNo && docStandard.standardNo &&
          this.removeSpaces(lib.standardNo).includes(this.removeSpaces(docStandard.standardNo))) {
        return { matched: true, matchLevel: 6, matchedItem: lib, isExactMatch: false };
      }
    }

    // 6b: 库编号包含在文档编号中（去空格）
    for (const lib of standardLibrary) {
      if (lib.standardNo && docStandard.standardNo &&
          this.removeSpaces(docStandard.standardNo).includes(this.removeSpaces(lib.standardNo))) {
        return { matched: true, matchLevel: 6, matchedItem: lib, isExactMatch: false };
      }
    }

    // 6c: 文档编号包含在库编号中（标点规范化）
    for (const lib of standardLibrary) {
      if (lib.standardNo && docStandard.standardNo &&
          this.normalizePunctuation(lib.standardNo).includes(this.normalizePunctuation(docStandard.standardNo))) {
        return { matched: true, matchLevel: 6, matchedItem: lib, isExactMatch: false };
      }
    }

    // 6d: 库编号包含在文档编号中（标点规范化）
    for (const lib of standardLibrary) {
      if (lib.standardNo && docStandard.standardNo &&
          this.normalizePunctuation(docStandard.standardNo).includes(this.normalizePunctuation(lib.standardNo))) {
        return { matched: true, matchLevel: 6, matchedItem: lib, isExactMatch: false };
      }
    }

    // 6e: 文档编号包含在库编号中（标点规范化+大写）
    for (const lib of standardLibrary) {
      if (lib.standardNo && docStandard.standardNo &&
          this.normalizePunctuation(lib.standardNo).toUpperCase().includes(
          this.normalizePunctuation(docStandard.standardNo).toUpperCase())) {
        return { matched: true, matchLevel: 6, matchedItem: lib, isExactMatch: false };
      }
    }

    // 6f: 库编号包含在文档编号中（标点规范化+大写）
    for (const lib of standardLibrary) {
      if (lib.standardNo && docStandard.standardNo &&
          this.normalizePunctuation(docStandard.standardNo).toUpperCase().includes(
          this.normalizePunctuation(lib.standardNo).toUpperCase())) {
        return { matched: true, matchLevel: 6, matchedItem: lib, isExactMatch: false };
      }
    }

    // Level 7: 数字段匹配 - 提取核心数字+标识符前缀
    const docNum = this.getStandardNum(docStandard.standardNo, docStandard.standardIdent);
    const docIdent = StandardExtractorService.getIdent(docStandard.standardNo);
    
    if (docNum) {
      for (const lib of standardLibrary) {
        const libNum = this.getStandardNum(lib.standardNo, lib.standardIdent);
        const libIdent = StandardExtractorService.getIdent(lib.standardNo);
        if (libNum && docNum === libNum && docIdent === libIdent) {
          return { matched: true, matchLevel: 7, matchedItem: lib, isExactMatch: false };
        }
      }
    }

    // Level 8: Levenshtein 相似度（旧系统注释掉的功能，建议激活）
    let bestSimilarity = 0;
    let bestMatch: StandardCheckItem | null = null;

    for (const lib of standardLibrary) {
      // 比较编号的相似度
      if (lib.standardNo && docStandard.standardNo) {
        const sim = this.levenshteinSimilarity(
          this.normalizePunctuation(lib.standardNo),
          this.normalizePunctuation(docStandard.standardNo)
        );
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          bestMatch = lib;
        }
      }
    }

    if (bestSimilarity >= 0.6 && bestMatch) {
      return { matched: true, matchLevel: 8, matchedItem: bestMatch, similarity: bestSimilarity, isExactMatch: false };
    }

    // 完全不匹配
    return { matched: false, matchLevel: 0, matchedItem: null, isExactMatch: false };
  }

  /**
   * 去除所有空格
   */
  private static removeSpaces(s: string): string {
    return s.replace(/ /g, '');
  }

  /**
   * 标点规范化链 — 1:1 移植旧系统
   * 全角→半角、去空格、同义词替换
   */
  private static normalizePunctuation(s: string, isName: boolean = false): string {
    let r = s.replace(/ /g, '')
             .replace(/（/g, '(')
             .replace(/）/g, ')')
             .replace(/：/g, ':')
             .replace(/，/g, ',')
             .replace(/－/g, '-')
             .replace(/—/g, '-');
    if (isName) {
      r = r.replace(/及/g, '和').replace(/、/g, '和');
    }
    return r;
  }

  /**
   * 数字段匹配 — 提取核心数字+去除标识符前缀
   * 移植自旧系统 GetStandardNum
   * 
   * 示例：
   *   "GB/T 50001-2017" (ident="GB/T") → "50001"
   *   "NB/T 20292-2014" (ident="NB/T") → "20292"
   */
  private static getStandardNum(standardNo: string, standardIdent: string): string {
    if (!standardNo) return '';
    let num = standardNo;
    if (standardIdent) {
      const idx = num.toUpperCase().indexOf(standardIdent.toUpperCase());
      if (idx >= 0) {
        num = num.substring(idx + standardIdent.length);
      }
    }
    num = num.replace(/（/g, '(').replace(/）/g, ')').replace(/ /g, '');
    if (num.includes('-')) {
      num = num.substring(0, num.indexOf('-'));
    } else if (num.includes('(')) {
      num = num.substring(0, num.indexOf('('));
    }
    return num.trim();
  }

  /**
   * Levenshtein 编辑距离相似度
   * 移植自旧系统 CheckStandardHelper.LevenshteinSimilarity（已注释功能，建议激活）
   * 
   * @returns 0-1 之间的相似度值，1 表示完全相同
   */
  private static levenshteinSimilarity(s1: string, s2: string): number {
    if (!s1 || !s2) return 0;
    if (s1 === s2) return 1;

    const len1 = s1.length;
    const len2 = s2.length;

    // DP 矩阵
    const matrix: number[][] = [];
    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,       // 删除
          matrix[i][j - 1] + 1,       // 插入
          matrix[i - 1][j - 1] + cost // 替换
        );
      }
    }

    return 1.0 - matrix[len1][len2] / Math.max(len1, len2);
  }
}
