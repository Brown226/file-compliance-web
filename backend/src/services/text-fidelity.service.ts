/**
 * OPT-029: LLM originalText 忠实度校验
 *
 * LLM 输出的 originalText 可能改写原文（同义替换、省略、合并），
 * 导致前端高亮定位失败。本服务在入库前校验并修正 originalText。
 *
 * 匹配策略（按优先级）：
 * 1. exact: 精确子串匹配
 * 2. normalized: 去空白/标点后匹配
 * 3. fuzzy: 滑动窗口 + Jaccard 相似度找最接近片段
 * 4. not_found: 无法匹配
 */

export interface FidelityResult {
  /** 是否在原文中找到 */
  found: boolean;
  /** 修正后的文本（fuzzy 匹配时返回最接近的原文片段） */
  correctedText?: string;
  /** 匹配置信度 */
  confidence: 'exact' | 'normalized' | 'fuzzy' | 'not_found';
  /** 模糊匹配相似度（0-1，仅 fuzzy 时有值） */
  similarity?: number;
}

// ===== 统计 =====
let totalCount = 0;
let exactCount = 0;
let normalizedCount = 0;
let fuzzyCount = 0;
let notFoundCount = 0;

/**
 * 归一化文本：去除所有空白字符和常见标点差异
 */
function normalizeForMatch(text: string): string {
  return text
    .replace(/[\s\u3000]+/g, '')  // 去除所有空白（含全角空格）
    .replace(/[，。、；：""''（）【】《》]/g, '')  // 去除中文标点
    .replace(/[,.;:'"()\[\]{}<>]/g, '')  // 去除英文标点
    .toLowerCase();
}

/**
 * 计算两个字符串的 Jaccard 相似度（基于 bigram）
 */
function jaccardSimilarity(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) {
    return a === b ? 1 : 0;
  }
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) {
    bigramsA.add(a.slice(i, i + 2));
    bigramsB.add(b.slice(i, i + 2));
  }
  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }
  const union = bigramsA.size + bigramsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * 校验 originalText 是否忠实于原文
 *
 * @param originalText LLM 输出的"原文引用"
 * @param fullText 完整的待审文本
 * @param options 配置项
 */
export function validateOriginalText(
  originalText: string,
  fullText: string,
  options?: {
    /** 模糊匹配阈值（默认 0.6） */
    fuzzyThreshold?: number;
    /** 是否启用模糊匹配（默认 true，大文本可关闭以提升性能） */
    enableFuzzy?: boolean;
    /** 模糊匹配最大搜索范围（字符数，默认 50000） */
    maxSearchLength?: number;
  }
): FidelityResult {
  totalCount++;

  if (!originalText || originalText.trim().length === 0) {
    notFoundCount++;
    return { found: false, confidence: 'not_found' };
  }

  if (!fullText || fullText.length === 0) {
    notFoundCount++;
    return { found: false, confidence: 'not_found' };
  }

  const trimmedOriginal = originalText.trim();

  // 1. 精确匹配
  if (fullText.includes(trimmedOriginal)) {
    exactCount++;
    return { found: true, confidence: 'exact' };
  }

  // 2. 归一化匹配
  const normalizedOriginal = normalizeForMatch(trimmedOriginal);
  const normalizedFull = normalizeForMatch(fullText);

  if (normalizedOriginal.length > 0 && normalizedFull.includes(normalizedOriginal)) {
    normalizedCount++;
    // 尝试在原文中找到对应的实际片段（通过位置映射）
    const correctedText = findOriginalSegment(fullText, trimmedOriginal);
    return {
      found: true,
      confidence: 'normalized',
      correctedText: correctedText || undefined,
    };
  }

  // 3. 模糊匹配（滑动窗口）
  const enableFuzzy = options?.enableFuzzy ?? true;
  const fuzzyThreshold = options?.fuzzyThreshold ?? 0.6;
  const maxSearchLength = options?.maxSearchLength ?? 50000;

  if (enableFuzzy && trimmedOriginal.length >= 6) {
    const searchFullText = fullText.length > maxSearchLength
      ? fullText.slice(0, maxSearchLength)
      : fullText;

    const windowSize = trimmedOriginal.length;
    const step = Math.max(1, Math.floor(windowSize * 0.3)); // 步长为窗口大小的 30%
    let bestMatch = '';
    let bestSimilarity = 0;

    for (let i = 0; i <= searchFullText.length - windowSize; i += step) {
      const candidate = searchFullText.slice(i, i + windowSize);
      const sim = jaccardSimilarity(
        normalizeForMatch(candidate),
        normalizedOriginal
      );
      if (sim > bestSimilarity) {
        bestSimilarity = sim;
        bestMatch = candidate;
      }
    }

    // 在最佳位置附近精细搜索
    if (bestSimilarity >= fuzzyThreshold) {
      const bestIdx = searchFullText.indexOf(bestMatch);
      const fineStart = Math.max(0, bestIdx - step);
      const fineEnd = Math.min(searchFullText.length, bestIdx + windowSize + step);
      const fineRegion = searchFullText.slice(fineStart, fineEnd);

      // 在精细区域内用更小步长搜索
      const fineStep = Math.max(1, Math.floor(windowSize * 0.1));
      for (let i = 0; i <= fineRegion.length - windowSize; i += fineStep) {
        const candidate = fineRegion.slice(i, i + windowSize);
        const sim = jaccardSimilarity(
          normalizeForMatch(candidate),
          normalizedOriginal
        );
        if (sim > bestSimilarity) {
          bestSimilarity = sim;
          bestMatch = candidate;
        }
      }
    }

    if (bestSimilarity >= fuzzyThreshold) {
      fuzzyCount++;
      return {
        found: true,
        confidence: 'fuzzy',
        correctedText: bestMatch.trim(),
        similarity: bestSimilarity,
      };
    }
  }

  // 4. 未找到
  notFoundCount++;
  return { found: false, confidence: 'not_found' };
}

/**
 * 尝试在原文中找到与 normalized 匹配对应的实际片段
 */
function findOriginalSegment(fullText: string, originalText: string): string | null {
  // 简单策略：用 originalText 的前 N 个字符在 fullText 中搜索
  const prefix = originalText.slice(0, Math.min(20, originalText.length));
  const idx = fullText.indexOf(prefix);
  if (idx >= 0) {
    // 从匹配位置截取与 originalText 等长的片段
    return fullText.slice(idx, idx + originalText.length);
  }
  return null;
}

/**
 * 获取忠实度统计
 */
export function getFidelityStats() {
  const rate = totalCount > 0 ? (exactCount / totalCount * 100).toFixed(1) : '0';
  return {
    total: totalCount,
    exact: exactCount,
    normalized: normalizedCount,
    fuzzy: fuzzyCount,
    notFound: notFoundCount,
    exactRate: `${rate}%`,
  };
}

/**
 * 重置统计（测试用）
 */
export function resetFidelityStats(): void {
  totalCount = 0;
  exactCount = 0;
  normalizedCount = 0;
  fuzzyCount = 0;
  notFoundCount = 0;
}
