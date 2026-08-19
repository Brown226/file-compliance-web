/**
 * ask_user 工具 — Agent 主动向用户提问（对标 pi-web ExtensionUiRequest 四形态）
 *
 * 调用形态：
 *   - confirm: 确认/取消（如破坏性操作前确认）
 *   - input:   单行自由输入（如缺一个参数值）
 *   - select:  从给定选项列表单选（如多义时让用户选一个）
 *   - editor:  多行文本输入（如让用户补充一段说明）
 *
 * 行为：
 * - execute 把问题写入 AskUserService（挂起），返回结构化标记 { status:'awaiting_user', ... }
 * - 该标记必须穿透 injectionGuardWrapper 的 <tool_result> 包裹（tools/index.ts 已加豁免），
 *   否则前端无法识别"挂起"语义
 * - 主链路 stopWhen 检测到本步含 ask_user 即中断流式循环，前端轮询 pending-ask 弹框
 */

import { z } from 'zod';
import type { ToolContext } from '../file/upload_file';
import AskUserService from '../../ask-user/ask-user.service';

const { tool } = require('@ai-sdk/provider-utils') as typeof import('@ai-sdk/provider-utils');

function genRequestId(): string {
  // 不依赖 crypto 模块，用时间戳 + 随机串
  return 'ask_' + Date.now().toString(36) + '_' + Math.floor(Math.random() * 1e6).toString(36);
}

export function createAskUserTool(context: ToolContext) {
  return tool({
    description:
      '向用户主动提问并等待回复（对标 pi-web 的 ExtensionUiRequest）。' +
      '当信息不足、存在多义、或需要用户确认/补充时调用，可中断当前工作流等待用户回答后再继续。' +
      'method=confirm 适用于破坏性操作前的二次确认（如编辑/写入/删除文件、入库知识库）；' +
      'method=input 适用于缺一个参数值；method=select 适用于多义时让用户从选项中选一个；' +
      'method=editor 适用于让用户补充一段多行说明。' +
      '返回 { status:"awaiting_user", requestId, question, method, options? } 表示已挂起等待用户回复。',
    inputSchema: z
      .object({
        question: z.string().min(1).describe('要问用户的问题（清晰、可执行）'),
        method: z
          .enum(['confirm', 'input', 'select', 'editor'])
          .default('input')
          .describe('提问形态：confirm=确认/取消，input=单行输入，select=选项单选，editor=多行输入'),
        options: z
          .array(z.string())
          .optional()
          .describe('method=select 时的候选项列表（至少 2 项）'),
        timeoutSec: z.number().int().min(10).max(600).optional().default(120)
          .describe('挂起超时秒数（默认 120，超时后前端轮询返回 null）'),
      })
      // 修复：select 模式必须提供 ≥2 个选项，否则前端无法渲染（原 schema 未强制）
      .superRefine((val, ctx) => {
        if (val.method === 'select' && (!Array.isArray(val.options) || val.options.length < 2)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['options'],
            message: 'method=select 时 options 至少提供 2 项',
          });
        }
      }),
    execute: async ({ question, method, options, timeoutSec }): Promise<any> => {
      const requestId = genRequestId();
      // select 模式必须把选项透传，否则前端无法渲染
      const optList = method === 'select' ? (options && options.length > 0 ? options : undefined) : undefined;
      const pending = {
        requestId,
        question: String(question),
        method: method as any,
        options: optList,
        timeoutSec: timeoutSec || 120,
        // toolCallId 在 SDK 执行上下文中不可见，恢复注入时用 requestId 关联即可；
        // 这里给一个占位，主链路若需要真实 toolCallId 可通过 requestId 二次匹配
        toolCallId: requestId,
        createdAt: Date.now(),
      };
      await AskUserService.setPending(context.sessionId, pending as any);
      return {
        status: 'awaiting_user',
        requestId,
        question,
        method,
        options: optList,
        timeoutSec: pending.timeoutSec,
        hint: '已向用户提问，等待用户回复后将继续。',
      };
    },
  });
}

export default createAskUserTool;
