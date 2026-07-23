/**
 * 模板匹配服务
 *
 * 代理 OpenSpec Agent 的模板匹配能力，按专业标签和业态标签
 * 匹配最适合的文档模板。
 * 底层调用 Python Agent 的 /agent/template/match 接口。
 */

import { OpenSpecAgentService } from '../llm/openspec-agent.service';

export interface TemplateMatchRequest {
  text: string;
  professionTagId?: number;
  businessTypeTagId?: number;
}

export interface TemplateMatchResponse {
  matched: boolean;
  templateId: string | null;
  templateName: string | null;
  score: number;
  variables?: Record<string, string>;
}

export class TemplateMatcherService {
  /**
   * 匹配模板
   * 根据文本内容 + 专业标签，返回最匹配的模板
   */
  static async match(request: TemplateMatchRequest): Promise<TemplateMatchResponse> {
    return OpenSpecAgentService.matchTemplate(
      request.text,
      request.professionTagId,
      request.businessTypeTagId,
    );
  }

  /**
   * 批量匹配模板名称
   * 根据文件名称列表，批量推断对应的模板
   */
  static async batchMatchNames(
    fileNames: string[],
    professionTagId?: number,
  ): Promise<Array<{ fileName: string; matched: boolean; templateName: string | null }>> {
    const results: Array<{ fileName: string; matched: boolean; templateName: string | null }> = [];

    for (const fileName of fileNames) {
      try {
        const result = await this.match({ text: fileName, professionTagId });
        results.push({
          fileName,
          matched: result.matched,
          templateName: result.templateName,
        });
      } catch {
        results.push({ fileName, matched: false, templateName: null });
      }
    }

    return results;
  }
}
