/**
 * JSON 修复工具 — 三层修复策略
 * 1. 预处理：清理常见 LLM 输出格式问题
 * 2. 原生解析：尝试 JSON.parse
 * 3. 库修复：正则提取 + 结构修复
 */

/**
 * 三层修复入口
 * @param raw LLM 原始输出
 * @returns 解析后的对象，修复失败返回 null
 */
export function repairJson<T = any>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null;

  // 第一层：预处理 + 原生解析
  const preprocessed = preprocess(raw);
  try {
    return JSON.parse(preprocessed) as T;
  } catch {}

  // 第二层：提取 JSON 块 + 原生解析
  const extracted = extractJsonBlock(preprocessed);
  if (extracted) {
    try {
      return JSON.parse(extracted) as T;
    } catch {}
  }

  // 第三层：结构修复
  const repaired = structuralRepair(extracted || preprocessed);
  try {
    return JSON.parse(repaired) as T;
  } catch {}

  return null;
}

/**
 * 预处理：清理 LLM 输出中的常见格式问题
 */
function preprocess(raw: string): string {
  let s = raw.trim();

  // 移除 BOM
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);

  // 移除 markdown 代码块标记
  s = s.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');

  // 移除行尾注释 // ...
  s = s.replace(/\/\/[^\n]*/g, '');

  // 移除尾部逗号：,] 或 ,}
  s = s.replace(/,\s*([\]}])/g, '$1');

  // 修复单引号为双引号（简单场景）
  s = fixSingleQuotes(s);

  return s;
}

/**
 * 从文本中提取第一个 JSON 对象或数组
 */
function extractJsonBlock(text: string): string | null {
  // 尝试找 {...}
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];

  // 尝试找 [...]
  const arrMatch = text.match(/\[[\s\S]*\]/);
  if (arrMatch) return arrMatch[0];

  return null;
}

/**
 * 结构修复：处理更复杂的格式问题
 */
function structuralRepair(text: string): string {
  let s = text;

  // 修复未转义的换行符（在字符串值中）
  s = s.replace(/"([^"]*?)(\n)([^"]*?)"/g, (match, before, nl, after) => {
    return `"${before}\\n${after}"`;
  });

  // 修复缺少引号的键名：{ key: "value" } → { "key": "value" }
  s = s.replace(/(\s)(\w+)(\s*:\s*)/g, (match, pre, key, colon) => {
    if (key === 'true' || key === 'false' || key === 'null') return match;
    return `${pre}"${key}"${colon}`;
  });

  // 修复多余的逗号（连续逗号）
  s = s.replace(/,\s*,/g, ',');

  // 修复尾部逗号（更激进的匹配）
  s = s.replace(/,(\s*[\]}])/g, '$1');

  // 尝试平衡括号
  s = balanceBrackets(s);

  return s;
}

/**
 * 简单的单引号修复（只处理简单的键值对场景）
 */
function fixSingleQuotes(text: string): string {
  // 不处理已有双引号的情况
  if (text.includes('"')) return text;

  // 将单引号替换为双引号
  return text.replace(/'/g, '"');
}

/**
 * 平衡未闭合的括号
 */
function balanceBrackets(text: string): string {
  let openCurly = 0;
  let openSquare = 0;

  for (const ch of text) {
    if (ch === '{') openCurly++;
    else if (ch === '}') openCurly--;
    else if (ch === '[') openSquare++;
    else if (ch === ']') openSquare--;
  }

  // 补齐缺失的闭合括号
  let result = text;
  while (openSquare > 0) {
    result += ']';
    openSquare--;
  }
  while (openCurly > 0) {
    result += '}';
    openCurly--;
  }

  return result;
}
