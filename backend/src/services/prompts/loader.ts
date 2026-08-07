/**
 * 提示词运行时加载器
 *
 * 封装统一的提示词加载逻辑：Registry → 最小兜底
 * 所有调用方通过此加载器获取提示词，不再自行硬编码 fallback。
 * 管理面板移除后不再查询 DB，prompt 内容以 registry.ts 为准。
 *
 * 使用方式：
 *   const systemPrompt = await PromptLoader.loadSystemPrompt('library_review', { hasContext: true });
 *   const userContent = await PromptLoader.loadUserPrompt('library_review', 'with_context', { ragContext: '...', text: '...' });
 */

import { resolveModule, getPromptFallback } from './registry';

/** 模板占位符数据 */
export interface PromptData {
  [key: string]: string;
}

/** 系统提示词加载选项 */
export interface LoadSystemOptions {
  /** 是否有标准上下文（用于选择 default/no_context variant） */
  hasContext?: boolean;
  /** 显式指定 variant（优先级高于 hasContext） */
  variant?: string;
}

/** 系统提示词的最小兜底（所有场景通用） */
const MINIMAL_SYSTEM_FALLBACK = '你是文件合规审查专家。请检查文本中的合规性问题，严格按照 JSON 数组格式输出审查结果。';

/** 用户提示词的最小兜底 */
const MINIMAL_USER_FALLBACK = '【待审查文本】\n${text}\n\n请检查以上文本的合规性问题，严格按照 JSON 数组格式输出审查结果。';

export class PromptLoader {
  /**
   * 加载系统提示词
   *
   * @param scene 审查场景（如 'library_review'）
   * @param options 加载选项
   */
  static async loadSystemPrompt(scene: string, options: LoadSystemOptions = {}): Promise<string> {
    const module = resolveModule(scene);
    const variant = options.variant || (options.hasContext ? 'default' : 'no_context');

    return PromptLoader.resolve(module, 'system', variant, MINIMAL_SYSTEM_FALLBACK);
  }

  /**
   * 加载用户提示词（含占位符替换）
   *
   * @param scene 审查场景
   * @param variant 变体（如 'with_context', 'no_context', 'default'）
   * @param data 占位符替换数据（如 { ragContext: '...', text: '...' }）
   */
  static async loadUserPrompt(scene: string, variant: string, data?: PromptData): Promise<string> {
    const module = resolveModule(scene);
    let template = await PromptLoader.resolve(module, 'user', variant, MINIMAL_USER_FALLBACK);
    if (data) {
      template = PromptLoader.fillTemplate(template, data);
    }
    return template;
  }

  /**
   * 通用提示词解析
   *
   * 优先级：registry.ts（唯一数据源）→ 调用方 fallback
   * registry 未命中指定 variant 时自动降级到 default（getPromptFallback 内部处理）。
   */
  static async resolve(module: string, role: string, variant: string, fallback: string): Promise<string> {
    const registryValue = getPromptFallback(module, role, variant);
    if (registryValue) return registryValue;
    return fallback;
  }

  /**
   * 模板占位符填充（${xxx} → value）
   */
  static fillTemplate(template: string, data: PromptData): string {
    let result = template;
    for (const [key, value] of Object.entries(data)) {
      result = result.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), value);
    }
    return result;
  }
}
