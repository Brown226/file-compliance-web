/**
 * 审查报告生成服务（2026-09-10）
 *
 * 目标：每个审查任务产出一份「可展示、可导出 PDF」的 Markdown 报告，
 * 供「审查摘要」页替代原先被用户反馈"没什么用"的统计卡片聚合视图。
 *
 * 生成策略（双保险，报告永不为空）：
 *   1. 优先让 AI 基于最终结构化问题写一份自然的 Markdown 报告（一次调用）
 *   2. AI 不可用 / 失败 / 产出为空 → 回落到确定性拼装（review-report.builder）
 *
 * 为什么是「任务级一次调用」而非「分片各自输出报告」：
 * 分片各自输出的报告片段无法拼成一份连贯报告（每片都只见局部、且会重复
 * 元信息/摘要），故报告在任务收尾阶段统一生成。
 */

import prisma from '../../config/db';
import { LlmService } from '../llm/llm.service';
import {
  buildReviewReportMarkdown,
  computeReportStats,
  sortIssuesForReport,
  ISSUE_TYPE_LABELS,
} from './review-report.builder';

/** 审查模式中文名（与前端 getModeLabel / review-handlers MODE_META 口径一致） */
const REVIEW_MODE_LABELS: Record<string, string> = {
  LIBRARY_REVIEW: '以库审文',
  DOC_REVIEW: '以文审文',
  CONSISTENCY: '上下文一致性',
  TYPO_GRAMMAR: '基础校对',
  RULE_ONLY: '仅规则审查',
  CONTRACT_REVIEW: '合同风险审查',
  SELF_CHECK: '标准引用自检',
  DEC_REVIEW: '设计文档审查',
};

export class ReportService {
  /**
   * 为任务生成并落库 Markdown 报告。
   *
   * 永不抛错（内部全部 try/catch）：报告属于附加值，不能让它的失败影响
   * 审查任务本身的完成状态。失败时静默保留 builder 拼装结果。
   *
   * @returns 落库的 Markdown 文本（便于调用方/测试断言）
   */
  static async generateAndStore(taskId: string): Promise<string> {
    let markdown = '';
    try {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { files: { select: { fileName: true } } },
      });
      if (!task) return '';

      const details = await prisma.taskDetail.findMany({
        where: { taskId },
        orderBy: { createdAt: 'asc' },
      }) as any[];

      const modeLabel = REVIEW_MODE_LABELS[String(task.reviewMode)] || String(task.reviewMode);
      const fileNames = (task.files || []).map((f: any) => f.fileName).join('、');

      // 1) 确定性拼装：始终先生成一份作为兜底（也是 AI 失败时的最终产物）
      const fallback = buildReviewReportMarkdown({
        issues: details,
        sourceFile: fileNames,
        reviewMode: modeLabel,
        taskTitle: task.title,
        notice: task.degradedReason
          ? `本次审查存在降级/未完整环节，结论可能不完整：${task.degradedReason}`
          : undefined,
      });
      markdown = fallback;

      // 2) 尝试 AI 叙述版报告（best-effort，失败静默回落）
      const aiReport = await ReportService.tryGenerateByAi({
        taskTitle: task.title,
        modeLabel,
        fileNames,
        details,
      }).catch(() => '');
      if (aiReport && aiReport.trim().length > 0) {
        markdown = aiReport.trim();
      }

      await prisma.task.update({
        where: { id: taskId },
        data: { reportMarkdown: markdown } as any,
      });
      return markdown;
    } catch (e: any) {
      console.warn('[Report] 生成审查报告失败（不影响任务结果）:', e?.message || e);
      return markdown || '';
    }
  }

  /**
   * 让 AI 基于最终问题清单撰写 Markdown 报告。
   * 无 LLM 配置、超时、产出异常时返回空串，由调用方回落到拼装版。
   */
  private static async tryGenerateByAi(params: {
    taskTitle: string;
    modeLabel: string;
    fileNames: string;
    details: any[];
  }): Promise<string> {
    const { taskTitle, modeLabel, fileNames, details } = params;
    const stats = computeReportStats(details);
    const sorted = sortIssuesForReport(details).slice(0, 200); // 上限防止 prompt 过大

    // 只把必要字段喂给模型，避免无关字段（id/时间戳/坐标）浪费上下文
    const compact = sorted.map((d: any, i: number) => ({
      序: i + 1,
      类型: ISSUE_TYPE_LABELS[d.issueType] || d.issueType,
      严重度: d.severity || '',
      风险: d.riskLevel || '',
      原文: String(d.originalText || '').slice(0, 300),
      建议: String(d.suggestedText || '').slice(0, 300),
      描述: String(d.description || '').slice(0, 300),
      标准引用: d.standardRef || '',
      规则编号: d.ruleCode || '',
    }));

    const systemPrompt = `你是核电工程文件审查报告的撰写专家。你会收到一次审查任务的统计与问题清单，请据此撰写一份结构化的中文 Markdown 审查报告。

要求：
- 只输出 Markdown 正文，不要输出任何解释性开场白/结语，不要用代码块包裹整篇报告
- 使用标准 Markdown：# 一级标题、## 二级标题、表格、有序/无序列表
- 报告必须包含以下章节（标题名可微调，顺序固定）：
  1. 标题（# 文件合规审查报告）
  2. 元信息（任务名称、审查模式、被审查文件、问题总数、高严重度数）
  3. 问题摘要（用 Markdown 表格按问题类型统计数量，并给出严重度分布说明）
  4. 总体结论（2-4 句，概括文档整体质量与主要风险；若有高严重度问题须明确指出）
  5. 重点问题（列出最需要优先处理的若干条，每条给出：问题、原文片段、修改建议）
  6. 整改建议（可执行的整改步骤清单）
- 数据必须严格来自输入，禁止编造未在清单中出现的问题或数值
- 原文片段逐字引用，不要改写`;

    const userPrompt = `【任务信息】
任务名称：${taskTitle}
审查模式：${modeLabel}
被审查文件：${fileNames || '（未记录）'}
问题总数：${stats.total}
高严重度（error / 高风险）：${stats.highSeverity}
按类型统计：${JSON.stringify(stats.byType)}
按严重度统计：${JSON.stringify(stats.bySeverity)}

【问题清单（JSON，按严重度排序，最多 ${compact.length} 条）】
${JSON.stringify(compact, null, 1)}

请据此撰写 Markdown 审查报告。`;

    const text = await LlmService.chat(userPrompt, {
      systemPrompt,
      temperature: 0.3,
      timeout: 180,
    });
    return typeof text === 'string' ? text : '';
  }
}
