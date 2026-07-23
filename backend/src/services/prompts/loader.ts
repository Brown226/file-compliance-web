/**
 * 提示词运行时加载器
 *
 * 封装统一的提示词加载逻辑：DB → Registry fallback → 最小兜底
 * 所有调用方通过此加载器获取提示词，不再自行硬编码 fallback。
 *
 * 使用方式：
 *   const systemPrompt = await PromptLoader.loadSystemPrompt('library_review', { hasContext: true });
 *   const userContent = await PromptLoader.loadUserPrompt('library_review', 'with_context', { ragContext: '...', text: '...' });
 */

import { PromptTemplateService } from '../llm/prompt-template.service';
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
   * 加载链：DB(configurable) → Registry(fallback) → 最小兜底
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
   * 优先级判断逻辑：
   *  1. 查 DB 看 content 和 defaultValue
   *  2. content === defaultValue → 用户没改过 → 用 registry.ts 最新值（热更新）
   *  3. content !== defaultValue → 用户在前端改过 → 用 DB content
   *  4. DB 不可达 → 用 registry 回退
   */
  static async resolve(module: string, role: string, variant: string, fallback: string): Promise<string> {
    // 从 registry 获取最新默认值（始终是代码中最新的）
    const registryValue = getPromptFallback(module, role, variant);

    // 查 DB，看用户是否手动修改过
    try {
      const meta = await PromptTemplateService.getPromptBySceneWithMeta(
        module, role as 'system' | 'user', variant,
      );
      if (meta) {
        // content === defaultValue → 用户没改过 → 用 registry 最新值
        if (meta.content === meta.defaultValue && registryValue) {
          return registryValue;
        }
        // content !== defaultValue → 用户在前端手动改过 → 用用户的版本
        return meta.content;
      }
    } catch (e) {
      // DB 不可达，继续降级
    }

    // DB 不可达或无记录 → 用 registry 回退
    if (registryValue) return registryValue;

    // 最终兜底
    return fallback;
  }

  /**
   * 按 key 加载提示词（兼容旧接口）
   */
  static async loadPromptByKey(key: string, fallback?: string): Promise<string> {
    try {
      return await PromptTemplateService.getPrompt(key, fallback);
    } catch {
      return fallback || '';
    }
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
