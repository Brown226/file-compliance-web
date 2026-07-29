/**
 * AI 润色服务
 *
 * 提供 10 种润色风格，用户选择风格后对文本进行 AI 润色。
 * 三段式输出：润色结果 + 修改对比 + 优化说明。
 *
 * 风格定义数据源：services/prompts/registry.ts (module='polish')
 * 不再硬编码 prompt 内容，便于运维通过管理面板修改提示词。
 */

import { LlmService } from './llm.service';
import { BUILTIN_TEMPLATES } from '../prompts/registry';
import { PromptLoader } from '../prompts/loader';

export interface PolishRequest {
  text: string;
  style: string; // polish 模块的 variant（如 formal / friendly / ...）
}

export interface PolishResponse {
  original: string;
  polished: string;
  style: string;
  styleName: string;
  diffs: Array<{ original: string; polished: string }>;
  explanations: string[];
}

// polish 模块的 system 模板列表（运行时缓存，避免每次过滤）
const POLISH_STYLE_TEMPLATES = BUILTIN_TEMPLATES.filter(
  tpl => tpl.module === 'polish' && tpl.role === 'system',
);

/**
 * 将 registry 中的模板 name 转换为前端展示用的风格名
 * 例如 "AI润色-正式规范-系统提示词" → "正式规范"
 */
function toStyleName(templateName: string): string {
  return templateName
    .replace(/^AI润色-/, '')
    .replace(/-系统提示词$/, '');
}

export class PolishService {
  /**
   * 获取所有可用风格
   */
  static getStyles(): Array<{ key: string; name: string; description: string }> {
    return POLISH_STYLE_TEMPLATES.map(tpl => ({
      key: tpl.variant,
      name: toStyleName(tpl.name),
      description: tpl.description || '',
    }));
  }

  /**
   * 执行 AI 润色
   */
  static async polish(request: PolishRequest): Promise<PolishResponse> {
    const styleTpl = POLISH_STYLE_TEMPLATES.find(t => t.variant === request.style);
    if (!styleTpl) {
      const available = POLISH_STYLE_TEMPLATES.map(t => t.variant).join(', ');
      throw new Error(`不支持的润色风格: ${request.style}，可用风格: ${available}`);
    }

    const styleName = toStyleName(styleTpl.name);
    // 通过 PromptLoader 加载，用户在管理面板修改 prompt 后会生效
    const systemPrompt = await PromptLoader.loadSystemPrompt('polish', {
      variant: request.style,
    });
    const userContent = `请润色以下文本（风格：${styleName}）：\n\n${request.text}`;

    // 直接调用 LlmService.chat 获取原始文本，不经过 reviewText 的 issue 解析层
    const fullContent = await LlmService.chat(userContent, {
      systemPrompt,
      temperature: 0.7,
      timeout: 120,
    });

    // 提取三段内容
    const polished = this.extractSection(fullContent, '润色结果') || request.text;
    const diffSection = this.extractSection(fullContent, '修改对比') || '';
    const explanationSection = this.extractSection(fullContent, '优化说明') || '';

    // 解析修改对比表格
    const diffs = this.parseDiffTable(diffSection);

    // 解析优化说明列表
    const explanations = explanationSection
      .split('\n')
      .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
      .map(line => line.replace(/^[-*\s]+/, '').trim())
      .filter(Boolean);

    return {
      original: request.text,
      polished,
      style: request.style,
      styleName,
      diffs: diffs.length > 0 ? diffs : [{ original: request.text, polished }],
      explanations: explanations.length > 0 ? explanations : ['润色完成'],
    };
  }

  /**
   * 从 Markdown 中提取指定标题下的内容
   */
  private static extractSection(content: string, sectionTitle: string): string {
    const regex = new RegExp(`## ${sectionTitle}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
    const match = content.match(regex);
    return match ? match[1].trim() : '';
  }

  /**
   * 解析 Markdown 表格为修改对比
   */
  private static parseDiffTable(markdown: string): Array<{ original: string; polished: string }> {
    const lines = markdown.split('\n');
    const diffs: Array<{ original: string; polished: string }> = [];
    let inTable = false;

    for (const line of lines) {
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        if (!inTable) {
          inTable = true;
          continue; // 跳过表头
        }
        // 跳过分隔行
        if (line.includes('---')) continue;

        const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
        if (cells.length >= 2) {
          diffs.push({ original: cells[0], polished: cells[1] });
        }
      } else {
        inTable = false;
      }
    }

    return diffs;
  }
}
