/**
 * 中文文件名乱码修复工具
 *
 * 背景：multer 在 Windows 上会把 multipart 表单的 UTF-8 文件名按 latin1 解码，
 * 导致中文文件名在磁盘上存成乱码（"先初始化" → "åå§ååäºè§£..."）。
 * 该模块提供反向修复函数，把 latin1 乱码字节序列恢复为原始 UTF-8 字符串。
 *
 * 使用场景：
 * - upload 接口（multer filename 回调）：存盘前修复，从根源避免乱码
 * - list_uploads / buildUploadedFilesSection / read_file：读取目录时修复已存在的乱码文件名
 */

/**
 * 修复 UTF-8 被 latin1 误解码导致的乱码文件名。
 *
 * 原理：乱码字符串的每个字符实际是原始 UTF-8 字节按 latin1 解释得到的，
 * 因此 `Buffer.from(str, 'latin1')` 能取回原始字节，再 `toString('utf8')` 恢复。
 *
 * 防御逻辑：
 * - 仅当解码后不含 U+FFFD 替换符（�）时才采用，避免破坏本就正常的文件名
 * - 解码失败（极端情况）时原样返回
 *
 * @param name 可能乱码的文件名
 * @returns 修复后的文件名
 */
export function fixMojibake(name: string): string {
  if (!name) return name;
  try {
    const utf8 = Buffer.from(name, 'latin1').toString('utf8');
    // 解码成功且无替换符才采用；否则说明文件名本来就是正常的 UTF-8/ASCII
    if (!utf8.includes('�')) return utf8;
    return name;
  } catch {
    return name;
  }
}

/**
 * 判断字符串是否为 UTF-8 被 latin1 误解码的乱码。
 *
 * 乱码的典型特征是含大量带重音符号的拉丁字符（å、æ、ç、è、é 等）
 * 且通常是偶数个字符组成一个中文字符。
 *
 * @param name 文件名
 * @returns 是否为乱码
 */
export function isMojibake(name: string): boolean {
  // 含 U+FFFD 说明解码已失败，不是可修复的乱码
  if (name.includes('�')) return false;
  // 统计高字节拉丁字符（原始 UTF-8 中文的每个字节在 latin1 里表现为这些字符）
  const suspicious = (name.match(/[À-ÿ]/g) || []).length;
  // 乱码中文名通常有 >=2 个此类字符；ASCII/正常中文名基本没有
  return suspicious >= 2;
}

/**
 * 修复文件路径中的乱码段。
 *
 * 按路径分隔符拆段，逐段调用 fixMojibake，再拼回完整路径。
 * 用于兼容历史已存在磁盘上的乱码文件名（multer latin1 误解码的存量文件）。
 *
 * @param filePath 可能含乱码段的绝对路径
 * @returns 修复后的路径（若无乱码则原样返回）
 */
export function fixMojibakePath(filePath: string): string {
  if (!filePath) return filePath;
  const sep = filePath.includes('\\') ? '\\' : '/';
  const segments = filePath.split(sep);
  const fixed = segments.map(seg => (isMojibake(seg) ? fixMojibake(seg) : seg));
  return fixed.join(sep);
}
