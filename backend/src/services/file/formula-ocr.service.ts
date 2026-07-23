/**
 * 公式识别服务
 * 当前为占位实现，接口预留，未来对接 LaTeX-OCR/Mathpix
 */

export interface FormulaResult {
  latex: string;          // LaTeX 格式
  mathml?: string;        // MathML 格式
  originalImage?: string; // 原始图片 base64
  confidence: number;     // 置信度 0-1
}

export class FormulaOcrService {
  /**
   * 识别公式（占位实现，未来对接 LaTeX-OCR/Mathpix）
   */
  static async recognizeFormula(imageBase64: string): Promise<FormulaResult> {
    console.warn(
      '[FormulaOcr] 公式识别服务未配置。如需启用，请配置 LaTeX-OCR 或 Mathpix 服务。',
    );
    return {
      latex: '[公式识别未配置]',
      confidence: 0,
    };
  }

  /**
   * 从文本中提取疑似公式区域
   *
   * 检测模式：
   * - 等号 + 数学符号组合（如 a = b + c）
   * - 分数线（/ 或 ÷ 构成的表达式）
   * - 上下标（x², x_n 等模式）
   * - 数学函数（sin, cos, log, ∑, ∫ 等）
   * - 希腊字母 + 等号/不等号
   */
  static detectFormulaRegions(
    text: string,
  ): Array<{ start: number; end: number; text: string }> {
    const regions: Array<{ start: number; end: number; text: string }> = [];
    if (!text) return regions;

    // 公式正则模式
    const patterns: RegExp[] = [
      // 带等号/不等号的数学表达式: 变量 = 数值 运算符 数值
      /[a-zA-Zα-ωΑ-Ω]\s*[=≠≈≤≥<>]\s*[a-zA-Zα-ωΑ-Ω0-9+\-*/().^_%]+/g,
      // 上下标模式: x², x_n, A_{ij}
      /[a-zA-Z][\^_]\{?[^}\s]+\}?/g,
      // 数学函数: sin(x), cos(x), log(x), ln(x), ∑, ∫, ∏
      /(?:sin|cos|tan|log|ln|exp|lim|max|min|det|dim|arg)\s*\([^)]+\)/g,
      // 希腊字母与运算: α + β = γ
      /[α-ωΑ-Ω]\s*[+\-*/=≠≈≤≥<>]\s*[α-ωΑ-Ω0-9]+/g,
      // 行内公式标记: $...$
      /\$[^$]+?\$/g,
      // 求和/积分/连乘符号
      /[∑∫∏∮]\s*[a-zA-Z0-9=+\-*/()^_\s]*/g,
      // 分数线: a/b 模式（排除URL和路径）
      /(?<![a-zA-Z]:\/)\b[a-zA-Z0-9()]+\s*\/\s*[a-zA-Z0-9()]+\b/g,
      // 范围表达式: [0, 100] 或 (a, b)
      /\[[\d.]+\s*,\s*[\d.]+\]/g,
    ];

    // 用于去重
    const seenRanges = new Set<string>();

    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const key = `${match.index}:${match[0]}`;
        if (seenRanges.has(key)) continue;
        seenRanges.add(key);

        // 排除明显不是公式的情况
        const matchedText = match[0].trim();
        if (matchedText.length < 3) continue;
        // 排除纯URL
        if (/^https?:\/\//.test(matchedText)) continue;
        // 排除纯文件路径
        if (/^[A-Za-z]:\\/.test(matchedText)) continue;

        regions.push({
          start: match.index,
          end: match.index + match[0].length,
          text: matchedText,
        });
      }
    }

    // 按位置排序
    regions.sort((a, b) => a.start - b.start);

    // 合并重叠区域
    const merged: typeof regions = [];
    for (const region of regions) {
      if (merged.length > 0 && region.start <= merged[merged.length - 1].end) {
        const last = merged[merged.length - 1];
        last.end = Math.max(last.end, region.end);
        last.text = text.substring(last.start, last.end);
      } else {
        merged.push({ ...region });
      }
    }

    return merged;
  }

  /**
   * 验证 LaTeX 公式语法
   *
   * 基础检查：
   * - 括号配对（{}, (), []）
   * - 常见命令拼写
   * - 环境配对（\begin{...} \end{...}）
   */
  static validateFormulaSyntax(latex: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!latex || !latex.trim()) {
      return { valid: false, errors: ['公式内容为空'] };
    }

    // 1. 括号配对检查
    const bracketPairs: Array<{ open: string; close: string; name: string }> = [
      { open: '{', close: '}', name: '花括号' },
      { open: '(', close: ')', name: '圆括号' },
      { open: '[', close: ']', name: '方括号' },
    ];

    for (const pair of bracketPairs) {
      const stack: number[] = [];
      let inCommand = false;

      for (let i = 0; i < latex.length; i++) {
        const ch = latex[i];

        // 跳过转义字符后的字符
        if (ch === '\\' && i + 1 < latex.length) {
          i++; // 跳过被转义的字符
          continue;
        }

        if (ch === pair.open) {
          stack.push(i);
        } else if (ch === pair.close) {
          if (stack.length === 0) {
            errors.push(`${pair.name}不匹配: 位置 ${i} 处有多余的 '${pair.close}'`);
          } else {
            stack.pop();
          }
        }
      }

      if (stack.length > 0) {
        errors.push(`${pair.name}不匹配: 有 ${stack.length} 个未闭合的 '${pair.open}'`);
      }
    }

    // 2. 环境配对检查: \begin{env} ... \end{env}
    const beginPattern = /\\begin\{([^}]+)\}/g;
    const endPattern = /\\end\{([^}]+)\}/g;

    const beginEnvs: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = beginPattern.exec(latex)) !== null) {
      beginEnvs.push(match[1]);
    }

    const endEnvs: string[] = [];
    while ((match = endPattern.exec(latex)) !== null) {
      endEnvs.push(match[1]);
    }

    // 检查每个 \begin 有对应的 \end
    const beginCopy = [...beginEnvs].sort();
    const endCopy = [...endEnvs].sort();

    for (let i = 0; i < beginCopy.length; i++) {
      if (i >= endCopy.length || beginCopy[i] !== endCopy[i]) {
        errors.push(`环境不匹配: \\begin{${beginCopy[i]}} 缺少对应的 \\end{${beginCopy[i]}}`);
      }
    }

    if (endCopy.length > beginCopy.length) {
      for (let i = beginCopy.length; i < endCopy.length; i++) {
        errors.push(`环境不匹配: \\end{${endCopy[i]}} 缺少对应的 \\begin{${endCopy[i]}}`);
      }
    }

    // 3. 常见命令拼写检查
    const knownCommands = new Set([
      'frac', 'sqrt', 'sum', 'prod', 'int', 'oint', 'lim',
      'sin', 'cos', 'tan', 'log', 'ln', 'exp',
      'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
      'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma',
      'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
      'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega',
      'left', 'right', 'big', 'Big', 'bigg', 'Bigg',
      'text', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathcal',
      'overline', 'underline', 'hat', 'bar', 'dot', 'tilde', 'vec',
      'begin', 'end', 'label', 'ref', 'eqref',
      'substack', 'binom', 'choose', 'quad', 'qquad',
    ]);

    const commandPattern = /\\([a-zA-Z]+)/g;
    while ((match = commandPattern.exec(latex)) !== null) {
      const cmd = match[1];
      if (cmd.length > 1 && !knownCommands.has(cmd)) {
        // 不报告单字母命令（如 \x, \a），可能是自定义命令
        // 仅对长度>=3的未知命令给出提示
        if (cmd.length >= 3) {
          errors.push(`可能的未知命令: \\${cmd}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
