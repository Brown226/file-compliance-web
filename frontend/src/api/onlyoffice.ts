import request from '@/utils/request'

/** 获取文件的 OnlyOffice 编辑器配置 */
export const getEditorConfigApi = (fileId: string) =>
  request.get(`/onlyoffice/editor-config/${fileId}`)

/** 单条文本替换 */
export const replaceTextApi = (fileId: string, data: { originalText: string; suggestedText: string }) =>
  request.post(`/onlyoffice/replace-text/${fileId}`, data)

/** 批量文本替换 */
export const batchReplaceApi = (fileId: string, data: { suggestions: Array<{ originalText: string; suggestedText: string }> }) =>
  request.post(`/onlyoffice/batch-replace/${fileId}`, data)

/** 强制保存 */
export const forceSaveApi = (fileId: string) =>
  request.post(`/onlyoffice/force-save/${fileId}`)

/** 获取版本历史 */
export const getVersionsApi = (fileId: string) =>
  request.get(`/onlyoffice/versions/${fileId}`)

/** 获取版本 diff */
export const getVersionDiffApi = (fileId: string, versionNo: number) =>
  request.get(`/onlyoffice/diff/${fileId}/${versionNo}`)

/** 获取 OnlyOffice 服务 URL */
export const getOnlyOfficeUrlApi = () =>
  request.get('/onlyoffice/url')
