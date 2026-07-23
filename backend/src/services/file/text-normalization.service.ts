/**
 * OPT-014: 格式归一化工具服务
 *
 * 提供文本归一化函数，用于：
 * 1. 一致性审查前的预处理（消除非实质性格式差异）
 * 2. 误报过滤时的文本比较
 * 3. 半角/全角标点检测
 *
 * 归一化层级：
 * - Level 1 (空白): 合并连续空白为单空格，去除首尾空白
 * - Level 2 (标点): 全角标点→半角，统一引号/括号
 * - Level 3 (语义): 去除所有空白和标点，仅保留文字和数字
 */

// ===== 全角→半角 映射 =====
const FULLWIDTH_TO_HALFWIDTH: Record<string, string> = {
  '，': ',', '。': '.', '；': ';', '：': ':', '！': '!', '？': '?',
  '（': '(', '）': ')', '【': '[', '】': ']', '｛': '{', '｝': '}',
  '“': '"', '”': '"', '‘': "'", '’': "'",
  '、': ',', '《': '<', '》': '>',
  '　': ' ', // 全角空格
  '０': '0', '１': '1', '２': '2', '３': '3', '４': '4',
  '５': '5', '６': '6', '７': '7', '８': '8', '９': '9',
  'Ａ': 'A', 'Ｂ': 'B', 'Ｃ': 'C', 'Ｄ': 'D', 'Ｅ': 'E',
  'Ｆ': 'F', 'Ｇ': 'G', 'Ｈ': 'H', 'Ｉ': 'I', 'Ｊ': 'J',
  'Ｋ': 'K', 'Ｌ': 'L', 'Ｍ': 'M', 'Ｎ': 'N', 'Ｏ': 'O',
  'Ｐ': 'P', 'Ｑ': 'Q', 'Ｒ': 'R', 'Ｓ': 'S', 'Ｔ': 'T',
  'Ｕ': 'U', 'Ｖ': 'V', 'Ｗ': 'W', 'Ｘ': 'X', 'Ｙ': 'Y', 'Ｚ': 'Z',
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e',
  'ｆ': 'f', 'ｇ': 'g', 'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j',
  'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n', 'ｏ': 'o',
  'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't',
  'ｕ': 'u', 'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x', 'ｙ': 'y', 'ｚ': 'z',
};

// 反向映射（半角→全角，用于检测）
const HALFWIDTH_PUNCT = new Set([',', '.', ';', ':', '!', '?', '(', ')', '[', ']', '{', '}']);
const FULLWIDTH_PUNCT_MAP: Record<string, string> = {
  ',': '，', '.': '。', ';': '；', ':': '：', '!': '！', '?': '？',
  '(': '（', ')': '）', '[': '【', ']': '】', '{': '｛', '}': '｝',
};

/**
 * Level 1: 空白归一化
 * 合并连续空白为单空格，去除首尾空白
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/[\s\u3000]+/g, ' ').trim();
}

/**
 * Level 2: 标点归一化
 * 全角标点→半角，统一引号
 */
export function normalizePunctuation(text: string): string {
  let result = '';
  for (const ch of text) {
    result += FULLWIDTH_TO_HALFWIDTH[ch] || ch;
  }
  // 统一引号为半角双引号
  return result.replace(/[""„‟]/g, '"').replace(/[''‚‛]/g, "'");
}

/**
 * Level 3: 完全归一化（用于语义比较）
 * 去除所有空白和标点，仅保留文字和数字，转小写
 */
export function normalizeForSemanticCompare(text: string): string {
  return text
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：""''（）【】《》,.:;'"()\[\]{}<>!?！？·—\-_~`@#$%^&*+=|\\/]/g, '')
    .toLowerCase();
}

/**
 * 完整归一化管线（Level 1 + Level 2）
 * 用于一致性审查前的预处理
 */
export function normalizeText(text: string): string {
  return normalizePunctuation(normalizeWhitespace(text));
}

/**
 * 检测文本中半角/全角标点混用的情况
 * 返回混用标点的列表
 */
export function detectMixedPunctuation(text: string): Array<{
  char: string;
  position: number;
  expected: string;
  context: string;
}> {
  const results: Array<{ char: string; position: number; expected: string; context: string }> = [];

  // 策略：如果文本中中文占比 > 30%，则应使用全角标点
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const totalChars = text.replace(/\s/g, '').length;
  const isChineseDominant = totalChars > 0 && chineseChars / totalChars > 0.3;

  if (isChineseDominant) {
    // 中文为主：检测不应出现的半角标点
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (HALFWIDTH_PUNCT.has(ch)) {
        // 排除数字中的小数点和英文缩写
        const prevChar = text[i - 1] || '';
        const nextChar = text[i + 1] || '';
        if (ch === '.' && /\d/.test(prevChar) && /\d/.test(nextChar)) continue; // 数字小数点
        if (ch === '.' && /[a-zA-Z]/.test(prevChar)) continue; // 英文缩写

        const start = Math.max(0, i - 10);
        const end = Math.min(text.length, i + 11);
        results.push({
          char: ch,
          position: i,
          expected: FULLWIDTH_PUNCT_MAP[ch] || ch,
          context: text.slice(start, end),
        });
      }
    }
  }

  return results;
}

/**
 * 判断两段文本在归一化后是否实质相同
 * 用于过滤非实质性格式差异
 */
export function isSubstantiallySame(textA: string, textB: string): boolean {
  return normalizeForSemanticCompare(textA) === normalizeForSemanticCompare(textB);
}
