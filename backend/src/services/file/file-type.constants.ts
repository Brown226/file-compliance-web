export enum FileCategory {
  DOCUMENT = 'document',
  IMAGE = 'image',
  CAD = 'cad',
  TEXT = 'text',
  ARCHIVE = 'archive',
  UNKNOWN = 'unknown'
}

export const FILE_TYPE_CONSTANTS = {
  OCR_SUPPORTED: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'] as const,
  TEXT_FORMATS: ['txt', 'md', 'csv', 'json', 'xml', 'html', 'htm', 'log', 'ini', 'yaml', 'yml'] as const,
  CAD_TYPES: ['dwg', 'dxf'] as const,
  DOCUMENT_TYPES: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'] as const,
  IMAGE_TYPES: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tiff'] as const,
  ARCHIVE_TYPES: ['zip', 'rar', '7z'] as const,
  SPECIAL_MAPPING: {
    'doc': 'docx',
  } as const,
  CATEGORY_MAPPING: {
    'pdf': FileCategory.DOCUMENT,
    'doc': FileCategory.DOCUMENT,
    'docx': FileCategory.DOCUMENT,
    'xls': FileCategory.DOCUMENT,
    'xlsx': FileCategory.DOCUMENT,
    'ppt': FileCategory.DOCUMENT,
    'pptx': FileCategory.DOCUMENT,
    'jpg': FileCategory.IMAGE,
    'jpeg': FileCategory.IMAGE,
    'png': FileCategory.IMAGE,
    'gif': FileCategory.IMAGE,
    'webp': FileCategory.IMAGE,
    'bmp': FileCategory.IMAGE,
    'tiff': FileCategory.IMAGE,
    'dwg': FileCategory.CAD,
    'dxf': FileCategory.CAD,
    'txt': FileCategory.TEXT,
    'md': FileCategory.TEXT,
    'csv': FileCategory.TEXT,
    'json': FileCategory.TEXT,
    'xml': FileCategory.TEXT,
    'html': FileCategory.TEXT,
    'zip': FileCategory.ARCHIVE,
    'rar': FileCategory.ARCHIVE,
    '7z': FileCategory.ARCHIVE,
  } as const,
  MIME_TYPE_MAP: {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-excel': 'xls',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'application/vnd.ms-powerpoint': 'ppt',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'image/vnd.dwg': 'dwg',
    'image/vnd.dxf': 'dxf',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'text/csv': 'csv',
    'application/json': 'json',
    'application/xml': 'xml',
    'text/html': 'html',
    'application/zip': 'zip',
    'application/x-rar-compressed': 'rar',
    'application/x-7z-compressed': '7z',
  } as const,
} as const;

export type OcrSupportedType = typeof FILE_TYPE_CONSTANTS.OCR_SUPPORTED[number];
export type TextFormatType = typeof FILE_TYPE_CONSTANTS.TEXT_FORMATS[number];
export type CadType = typeof FILE_TYPE_CONSTANTS.CAD_TYPES[number];
export type DocumentType = typeof FILE_TYPE_CONSTANTS.DOCUMENT_TYPES[number];
export type ImageType = typeof FILE_TYPE_CONSTANTS.IMAGE_TYPES[number];
export type ArchiveType = typeof FILE_TYPE_CONSTANTS.ARCHIVE_TYPES[number];