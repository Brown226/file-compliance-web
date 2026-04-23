/**
 * 跨文件一致性检查服务
 * 检测同名参数在不同文件中的不一致取值
 *
 * 规则代码: CROSS_CONSIST_001（参数值跨文件不一致）
 */

import prisma from '../config/db';
import { ParserService } from './parser.service';
import { OcrService } from './ocr.service';
import path from 'path';

/** 参数抽取结果 */
interface ParamEntry {
  paramName: string;
  value: string;
  position: number; // 在原文中的偏移位置
}

/** 按参数名分组的索引项 */
interface ParamIndexEntry {
  fileName: string;
  fileId: string;
  value: string;
  position: number;
}

/** 不一致对 */
interface InconsistencyPair {
  paramName: string;
  entries: ParamIndexEntry[];
}

export class CrossFileConsistencyService {
  /**
   * 执行跨文件一致性检查
   * @param taskId 任务 ID
   * @param files 任务文件列表
   */
  static async check(taskId: string, files: Array<{ id: string; fileName: string; filePath: string; fileType: string }>): Promise<number> {
    if (!files || files.length < 2) {
      console.log('[CrossConsist] 文件数不足2，跳过跨文件一致性检查');
      return 0;
    }

    console.log(`[CrossConsist] 开始跨文件一致性检查，共 ${files.length} 个文件`);

    // 1. 提取每个文件的文本和参数
    const allParams: Array<{ fileId: string; fileName: string; params: ParamEntry[] }> = [];

    for (const file of files) {
      try {
        const text = await this.extractText(file);
        const params = this.extractParameters(text);
        if (params.length > 0) {
          allParams.push({ fileId: file.id, fileName: file.fileName, params });
          console.log(`[CrossConsist] ${file.fileName}: 抽取到 ${params.length} 个参数`);
        }
      } catch (e) {
        console.warn(`[CrossConsist] 文件处理失败: ${file.fileName}`, e);
      }
    }

    if (allParams.length < 2) {
      console.log('[CrossConsist] 有效参数文件不足2，跳过');
      return 0;
    }

    // 2. 构建参数索引
    const paramIndex = this.buildParamIndex(allParams);

    // 3. 比对一致性
    const inconsistencies = this.findInconsistencies(paramIndex);

    if (inconsistencies.length === 0) {
      console.log('[CrossConsist] 未发现跨文件参数不一致');
      return 0;
    }

    console.log(`[CrossConsist] 发现 ${inconsistencies.length} 个跨文件参数不一致`);

    // 4. 写入 TaskDetail
    const details = inconsistencies.map((inc) => {
      const valuesDesc = inc.entries
        .map((e) => `${e.fileName}: "${e.value}"`)
        .join('; ');
      // 取第一个文件作为 primary fileId
      const primaryEntry = inc.entries[0];

      return {
        taskId,
        fileId: primaryEntry.fileId,
        issueType: 'CONSISTENCY',
        ruleCode: 'CROSS_CONSIST_001',
        severity: 'error' as const,
        originalText: inc.paramName,
        suggestedText: null,
        description: `参数 "${inc.paramName}" 在不同文件中取值不一致: ${valuesDesc}`,
      };
    });

    await prisma.taskDetail.createMany({ data: details });

    // 更新相关文件的错误计数
    const affectedFileIds = new Set(inconsistencies.flatMap((inc) => inc.entries.map((e) => e.fileId)));
    for (const fileId of affectedFileIds) {
      await this.updateFileErrorCount(fileId);
    }

    return details.length;
  }

  /**
   * 提取文件文本（复用 ParserService + OCR 降级逻辑）
   */
  private static async extractText(file: { fileName: string; filePath: string; fileType: string }): Promise<string> {
    const uploadsDir = path.join(__dirname, '../../uploads');
    const absolutePath = path.join(uploadsDir, path.basename(file.filePath));

    let text = '';
    try {
      text = await ParserService.parseFile(absolutePath, file.fileType);
    } catch (e) {
      console.warn(`[CrossConsist] 文件解析失败: ${file.fileName}`, e);
    }

    // OCR 降级
    if (ParserService.needsOcr(text, file.fileType) && OcrService.isOcrSupported(file.fileType)) {
      try {
        const ocrText = await OcrService.recognizeFile(absolutePath, file.fileType);
        if (ocrText) text = ocrText;
      } catch (e) {
        console.warn(`[CrossConsist] OCR 处理失败: ${file.fileName}`, e);
      }
    }

    return text;
  }

  /**
   * 参数抽取：从文本中抽取"参数名=参数值"对
   * 匹配模式：
   *   - 参数名[：:=]参数值，如 "设计温度：350°C"
   *   - 参数名[：:=]\s*参数值，如 "设计压力=17.5MPa"
   */
  static extractParameters(text: string): ParamEntry[] {
    const params: ParamEntry[] = [];
    if (!text) return params;

    // 主匹配模式：参数名 + 分隔符 + 参数值
    // 参数名：2~20个中文字符或字母数字组合
    // 分隔符：冒号（中英文）或等号
    // 参数值：非空白字符开头的值，包含数字、单位、特殊字符
    const paramPattern = /([^\s\n\r：:=]{2,20})\s*[：:=]\s*([^\s\n\r,，。；;]{1,50})/g;

    let match: RegExpExecArray | null;
    while ((match = paramPattern.exec(text)) !== null) {
      const name = match[1].trim();
      const value = match[2].trim();

      // 过滤：参数名应包含至少一个中文字符或为常见技术术语
      if (!this.isValidParamName(name)) continue;

      // 过滤：参数值应包含数字或可度量的值
      if (!this.isValidParamValue(value)) continue;

      // 规范化参数名（去空格、统一大小写）
      const normalizedName = this.normalizeParamName(name);
      const normalizedValue = this.normalizeParamValue(value);

      params.push({
        paramName: normalizedName,
        value: normalizedValue,
        position: match.index,
      });
    }

    // 去重：同一文件中同名参数只保留第一次出现的
    const seen = new Set<string>();
    return params.filter((p) => {
      const key = p.paramName;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * 构建参数索引：按参数名分组
   */
  static buildParamIndex(
    allParams: Array<{ fileId: string; fileName: string; params: ParamEntry[] }>,
  ): Map<string, ParamIndexEntry[]> {
    const index = new Map<string, ParamIndexEntry[]>();

    for (const fileParams of allParams) {
      for (const param of fileParams.params) {
        const key = param.paramName;
        if (!index.has(key)) {
          index.set(key, []);
        }
        index.get(key)!.push({
          fileName: fileParams.fileName,
          fileId: fileParams.fileId,
          value: param.value,
          position: param.position,
        });
      }
    }

    return index;
  }

  /**
   * 一致性比对：检测同名参数在不同文件中的不同取值
   */
  static findInconsistencies(paramIndex: Map<string, ParamIndexEntry[]>): InconsistencyPair[] {
    const results: InconsistencyPair[] = [];

    for (const [paramName, entries] of paramIndex) {
      // 只比较出现在2个以上文件中的参数
      const fileIds = new Set(entries.map((e) => e.fileId));
      if (fileIds.size < 2) continue;

      // 检查是否存在不一致
      const distinctValues = this.getDistinctValues(entries);
      if (distinctValues.length >= 2) {
        results.push({ paramName, entries });
      }
    }

    return results;
  }

  /**
   * 获取去重后的不同值列表
   * 忽略大小写差异、忽略数值差异<1%的、智能合并同义单位
   */
  private static getDistinctValues(entries: ParamIndexEntry[]): string[] {
    const normalizedValues: Array<{ original: string; numeric: number | null; unit: string }> = [];

    for (const entry of entries) {
      const parsed = this.parseNumericValue(entry.value);
      normalizedValues.push(parsed);
    }

    // 两两比较
    const distinct: string[] = [];
    const matched = new Set<number>();

    for (let i = 0; i < normalizedValues.length; i++) {
      if (matched.has(i)) continue;

      let isDuplicate = false;
      for (let j = 0; j < i; j++) {
        if (matched.has(j)) continue;

        if (this.valuesAreEqual(normalizedValues[i], normalizedValues[j])) {
          isDuplicate = true;
          break;
        }
      }

      if (!isDuplicate) {
        distinct.push(normalizedValues[i].original);
      } else {
        matched.add(i);
      }
    }

    return distinct;
  }

  /**
   * 判断两个值是否"相等"
   * - 忽略大小写
   * - 忽略纯数值差异<1%
   * - 智能合并同义单位（如 °C 和 度）
   */
  private static valuesAreEqual(
    a: { original: string; numeric: number | null; unit: string },
    b: { original: string; numeric: number | null; unit: string },
  ): boolean {
    // 完全相同（忽略大小写和前后空格）
    if (a.original.trim().toLowerCase() === b.original.trim().toLowerCase()) {
      return true;
    }

    // 如果两个都能解析为数值，比较数值
    if (a.numeric !== null && b.numeric !== null) {
      // 先尝试单位统一
      const aInBase = this.convertToBaseUnit(a.numeric, a.unit);
      const bInBase = this.convertToBaseUnit(b.numeric, b.unit);

      if (aInBase !== null && bInBase !== null) {
        const diff = Math.abs(aInBase - bInBase);
        const avg = (Math.abs(aInBase) + Math.abs(bInBase)) / 2;
        // 忽略差异<1%
        if (avg > 0 && diff / avg < 0.01) {
          return true;
        }
        // 零值特殊处理
        if (aInBase === 0 && bInBase === 0) {
          return true;
        }
      }

      // 直接数值比较（无单位转换时）
      const diff = Math.abs(a.numeric - b.numeric);
      const avg = (Math.abs(a.numeric) + Math.abs(b.numeric)) / 2;
      if (avg > 0 && diff / avg < 0.01) {
        return true;
      }
    }

    return false;
  }

  /**
   * 解析数值+单位
   * 如 "350°C" → { numeric: 350, unit: "°C" }
   * 如 "17.5MPa" → { numeric: 17.5, unit: "MPa" }
   */
  private static parseNumericValue(value: string): { original: string; numeric: number | null; unit: string } {
    const match = value.match(/^([+-]?\d+\.?\d*)\s*(.*)$/);
    if (match) {
      const numeric = parseFloat(match[1]);
      const unit = match[2].trim();
      return { original: value, numeric: isNaN(numeric) ? null : numeric, unit };
    }
    return { original: value, numeric: null, unit: '' };
  }

  /**
   * 尝试将带单位的值转换为基准单位
   * 目前支持温度和压力的常见单位换算
   */
  private static convertToBaseUnit(value: number, unit: string): number | null {
    const normalizedUnit = unit.toLowerCase().replace(/\s/g, '');

    // 温度：都以 °C 为基准
    if (['°c', '℃', '度', 'oc'].includes(normalizedUnit)) {
      return value; // 已经是摄氏度
    }
    if (['°f', '℉', 'of'].includes(normalizedUnit)) {
      return (value - 32) * 5 / 9; // 华氏度转摄氏度
    }
    if (normalizedUnit === 'k') {
      return value - 273.15; // 开尔文转摄氏度
    }

    // 压力：都以 MPa 为基准
    if (['mpa', '兆帕'].includes(normalizedUnit)) {
      return value;
    }
    if (['kpa', '千帕'].includes(normalizedUnit)) {
      return value / 1000;
    }
    if (['pa', '帕'].includes(normalizedUnit)) {
      return value / 1000000;
    }
    if (normalizedUnit === 'bar') {
      return value * 0.1;
    }
    if (['atm', '标准大气压'].includes(normalizedUnit)) {
      return value * 0.101325;
    }

    // 无单位或未知单位，不做转换
    return null;
  }

  /**
   * 判断是否为有效的参数名
   * 至少包含一个中文字符，或者为常见英文技术术语
   */
  private static isValidParamName(name: string): boolean {
    // 包含中文
    if (/[\u4e00-\u9fa5]/.test(name)) return true;

    // 常见英文技术参数缩写
    const commonEnglishParams = /^(temp|pressure|flow|rate|speed|power|voltage|current|freq|width|height|depth|length|diameter|thickness|weight|density|volume|area|capacity|load|torque|rpm|ph|humidity|voltage|resistance)$/i;
    if (commonEnglishParams.test(name)) return true;

    return false;
  }

  /**
   * 判断是否为有效的参数值
   * 应包含数字或可度量的值
   */
  private static isValidParamValue(value: string): boolean {
    // 包含数字
    if (/\d/.test(value)) return true;
    // 包含常见单位标识
    if (/[°℃℉MPaPaKkWVAmAmmcmsmgkNt]/i.test(value)) return true;
    return false;
  }

  /**
   * 规范化参数名
   */
  private static normalizeParamName(name: string): string {
    return name
      .replace(/\s+/g, '') // 去空格
      .toLowerCase();
  }

  /**
   * 规范化参数值
   */
  private static normalizeParamValue(value: string): string {
    return value
      .trim()
      // 统一全角数字和符号为半角
      .replace(/０/g, '0').replace(/１/g, '1').replace(/２/g, '2').replace(/３/g, '3')
      .replace(/４/g, '4').replace(/５/g, '5').replace(/６/g, '6').replace(/７/g, '7')
      .replace(/８/g, '8').replace(/９/g, '9')
      .replace(/℃/g, '°C')
      .replace(/℉/g, '°F');
  }

  /**
   * 更新文件的错误计数
   */
  private static async updateFileErrorCount(fileId: string): Promise<void> {
    const count = await prisma.taskDetail.count({
      where: { fileId },
    });
    await prisma.taskFile.update({
      where: { id: fileId },
      data: { errorCount: count },
    });
  }
}
