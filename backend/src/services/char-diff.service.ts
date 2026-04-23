/**
 * 字符级差异定位服务
 * 移植自旧系统 Normative CheckDocStandardHelper.CheckChar
 */

export interface CharRange {
  start: number;
  length: number;
}

export interface DiffResult {
  originalRanges: CharRange[];   // 文档文本中的差异区间（标红）
  correctRanges: CharRange[];    // 正确文本中的差异区间（标绿）
}

export class CharDiffService {
  /**
   * 逐字符对齐比较，标记差异区间
   * 移植自旧系统 CheckChar 逻辑
   * 
   * @param standardInfo 文档中的文本（可能有误的）
   * @param correctInfo 正确的文本（标准库中的）
   * @returns 差异区间结果
   */
  static compare(standardInfo: string, correctInfo: string): DiffResult {
    const originalRanges: CharRange[] = [];
    const correctRanges: CharRange[] = [];

    if (!standardInfo || !correctInfo) {
      // 如果任一为空，整体都是差异
      if (standardInfo) originalRanges.push({ start: 0, length: standardInfo.length });
      if (correctInfo) correctRanges.push({ start: 0, length: correctInfo.length });
      return { originalRanges, correctRanges };
    }

    if (standardInfo === correctInfo) {
      return { originalRanges, correctRanges }; // 完全相同，无差异
    }

    const minLen = Math.min(standardInfo.length, correctInfo.length);
    let errorLen = 0;
    let firstNo = 0;

    // 逐字符比较公共长度部分
    for (let i = 0; i < minLen; i++) {
      if (standardInfo[i] === correctInfo[i]) {
        if (errorLen > 0) {
          originalRanges.push({ start: firstNo, length: errorLen });
          correctRanges.push({ start: firstNo, length: errorLen });
        }
        errorLen = 0;
        continue;
      }
      if (errorLen === 0) firstNo = i;
      errorLen++;
    }

    // 尾部处理：公共长度部分的未关闭差异
    if (errorLen > 0) {
      originalRanges.push({ start: firstNo, length: errorLen });
      correctRanges.push({ start: firstNo, length: errorLen });
    }

    // 长度差异部分：较长字符串的多余部分标记为差异
    if (standardInfo.length > correctInfo.length) {
      originalRanges.push({ start: minLen, length: standardInfo.length - minLen });
    } else if (correctInfo.length > standardInfo.length) {
      correctRanges.push({ start: minLen, length: correctInfo.length - minLen });
    }

    return { originalRanges, correctRanges };
  }

  /**
   * 检查两个字符串是否有差异
   */
  static hasDifference(standardInfo: string, correctInfo: string): boolean {
    const result = this.compare(standardInfo, correctInfo);
    return result.originalRanges.length > 0 || result.correctRanges.length > 0;
  }
}
