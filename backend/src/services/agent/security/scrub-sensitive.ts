/**
 * 敏感信息清洗工具
 *
 * 用于在日志记录前对文本进行脱敏处理，避免敏感信息泄露。
 * 参考 Reasonix scrubSensitiveText 实现。
 */

// 按优先级排序的正则替换规则
const SCRUB_PATTERNS: { regex: RegExp; replacement: string }[] = [
  // 1. Windows 用户路径
  { regex: /C:\\Users\\[^\s\\,;]+/g, replacement: '[user-path]' },
  // 2. Unix 用户路径
  { regex: /\/home\/[^/\s,;]+/g, replacement: '[user-path]' },
  // 3. JWT token
  { regex: /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, replacement: '[jwt]' },
  // 4. Bearer token
  { regex: /Bearer\s+[a-zA-Z0-9._\-+/=]+/g, replacement: 'Bearer [bearer-token]' },
  // 5. API key — sk- 前缀格式
  { regex: /sk-[a-zA-Z0-9]{20,}/g, replacement: '[api-key]' },
  // 5. API key — 32 位以上字母数字（长密钥/令牌）
  { regex: /[a-zA-Z0-9]{32,}/g, replacement: '[api-key]' },
  // 6. 邮箱
  { regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[email]' },
  // 7. Base64 编码长字符串（60 字符以上）
  { regex: /[A-Za-z0-9+/=]{60,}/g, replacement: '[base64]' },
];

/**
 * 对文本进行敏感信息脱敏处理。
 * 按优先级依次匹配并替换路径、令牌、密钥、邮箱和 base64 长串。
 *
 * @param text - 原始文本
 * @returns 脱敏后的文本
 */
export function scrubSensitive(text: string): string {
  if (!text) return text;

  let result = text;
  for (const { regex, replacement } of SCRUB_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}
