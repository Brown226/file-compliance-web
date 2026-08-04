/**
 * file 工具集 — 文件相关工具的工厂入口
 *
 * 工厂模式：context 携带 userId / sessionId，注入到每个工具，
 * 用于隔离不同用户/会话的临时文件、AgentMemory 等。
 *
 * Task 8：从 2 个工具扩展到 8 个工具
 *   - upload_file / extract_text（Task 4 MVP）
 *   - chunk_document / read_file / list_uploads / delete_file / write_report / download_report（Task 8 新增）
 */

import { createUploadFileTool } from './upload_file';
import { createExtractTextTool } from './extract_text';
import { createChunkDocumentTool } from './chunk_document';
import { createReadFileTool } from './read_file';
import { createListUploadsTool } from './list_uploads';
import { createDeleteFileTool } from './delete_file';
import { createWriteReportTool } from './write_report';
import { createDownloadReportTool } from './download_report';
import { createCompareDocumentsTool } from './compare_documents';
import { createExtractTablesTool } from './extract_tables';
import { createEditFileTool } from './edit_file';
import { createEditDocumentTool } from './edit_document';
import type { ToolContext } from './upload_file';

export {
  createUploadFileTool,
  createExtractTextTool,
  createChunkDocumentTool,
  createReadFileTool,
  createListUploadsTool,
  createDeleteFileTool,
  createWriteReportTool,
  createDownloadReportTool,
  createCompareDocumentsTool,
  createExtractTablesTool,
  createEditFileTool,
  createEditDocumentTool,
};
export type { ToolContext };

/**
 * 创建文件相关工具集（12 个工具）
 * @param context userId / sessionId
 * @returns { upload_file, extract_text, chunk_document, read_file, list_uploads, delete_file, write_report, download_report, compare_documents, extract_tables, edit_file, edit_document }
 */
export function createFileTools(context: ToolContext) {
  return {
    upload_file: createUploadFileTool(context),
    extract_text: createExtractTextTool(context),
    chunk_document: createChunkDocumentTool(context),
    read_file: createReadFileTool(context),
    list_uploads: createListUploadsTool(context),
    delete_file: createDeleteFileTool(context),
    write_report: createWriteReportTool(context),
    download_report: createDownloadReportTool(context),
    compare_documents: createCompareDocumentsTool(context),
    extract_tables: createExtractTablesTool(context),
    edit_file: createEditFileTool(context),
    edit_document: createEditDocumentTool(context),
  };
}
