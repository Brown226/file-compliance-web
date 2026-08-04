/**
 * edit_document 工具 — 编辑已上传文档的指定内容
 *
 * 计划任务 5：Agent 工作流第 11 步「修改文档」对应的编辑类工具。
 * 复用 edit_file 的完整编辑能力（replace 精确替换 + patch unified diff，
 * 支持纯文本与 DOCX 受控替换），以更贴近业务语义的文档编辑入口暴露给 Agent：
 * - 对纯文本/常见格式（txt/md/csv/log/json/xml/yaml/yml）：替换文本或应用补丁
 * - 对 DOCX：走 DocxReplaceService 受控替换（保留格式，仅 replace 模式）
 *
 * 安全约束与 edit_file 完全一致（只能编辑当前会话上传的文件，防路径穿越）。
 * 返回变更摘要，供 LLM 确认改动范围。
 */

import { createEditFileTool } from './edit_file';
import type { ToolContext } from './upload_file';

/**
 * 创建 edit_document 工具
 *
 * edit_file 提供底层编辑实现；edit_document 作为工作流级入口包装它，
 * 通过 descriptionOverride 覆盖默认 description，以「修改文档内容」的业务
 * 语义呈现（与系统提示词第 11 步一致），参数结构与 execute 完全复用 edit_file。
 */
export function createEditDocumentTool(context: ToolContext) {
  return createEditFileTool(
    context,
    '修改已上传文档的指定内容（工作流第 11 步「修改文档」）。支持两种模式：① replace：把文档中的 oldText 精确替换为 newText（occurrence 指定第几次出现，replaceAll 全量替换）；② patch：应用 unified diff 补丁（@@ -a,b +c,d @@ 头 + 上下文行，仅纯文本）。支持纯文本（txt/md/csv/log/json/xml/yaml/yml）与 DOCX（受控替换保留格式，仅 replace 模式）。只能编辑当前会话上传的文件，返回变更摘要供确认。编辑前建议先 read_file 查看原文件内容。',
  );
}
