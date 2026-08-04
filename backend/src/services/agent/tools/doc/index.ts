/**
 * doc 工具集 — 文档摘要 / 起草（P1-④⑤）
 */

import { createSummarizeDocumentTool } from './summarize_document';
import { createDraftDocumentTool } from './draft_document';
import type { ToolContext } from '../file/upload_file';

export { createSummarizeDocumentTool, createDraftDocumentTool };

/** 创建 doc 工具集（2 个工具） */
export function createDocTools(context: ToolContext) {
  return {
    summarize_document: createSummarizeDocumentTool(context),
    draft_document: createDraftDocumentTool(context),
  };
}
