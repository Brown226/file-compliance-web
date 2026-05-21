import { FileCategory, FILE_TYPE_CONSTANTS } from './file-type.constants';

export class FileTypeService {
  private static readonly OCR_SUPPORTED_SET: Set<string> = new Set(FILE_TYPE_CONSTANTS.OCR_SUPPORTED);
  private static readonly TEXT_FORMATS_SET: Set<string> = new Set(FILE_TYPE_CONSTANTS.TEXT_FORMATS);
  private static readonly CAD_TYPES_SET: Set<string> = new Set(FILE_TYPE_CONSTANTS.CAD_TYPES);

  static normalizeFileType(fileType: string, fileName?: string): string {
    const value = (fileType || '').trim().toLowerCase();
    const name = (fileName || '').trim().toLowerCase();

    if (value.startsWith('data:image/')) {
      return 'image';
    }

    let normalizedType = FILE_TYPE_CONSTANTS.MIME_TYPE_MAP[value as keyof typeof FILE_TYPE_CONSTANTS.MIME_TYPE_MAP] || value;

    if (!normalizedType || normalizedType === value) {
      const ext = name.split('.').pop();
      if (ext) {
        normalizedType = FILE_TYPE_CONSTANTS.MIME_TYPE_MAP[ext as keyof typeof FILE_TYPE_CONSTANTS.MIME_TYPE_MAP] || ext;
      }
    }

    return FILE_TYPE_CONSTANTS.SPECIAL_MAPPING[normalizedType as keyof typeof FILE_TYPE_CONSTANTS.SPECIAL_MAPPING] || normalizedType;
  }

  static getFileCategory(fileType: string): FileCategory {
    const normalizedType = this.normalizeFileType(fileType);
    return FILE_TYPE_CONSTANTS.CATEGORY_MAPPING[normalizedType as keyof typeof FILE_TYPE_CONSTANTS.CATEGORY_MAPPING] || FileCategory.UNKNOWN;
  }

  static isOcrSupported(fileType: string): boolean {
    const normalizedType = this.normalizeFileType(fileType);
    return this.OCR_SUPPORTED_SET.has(normalizedType);
  }

  static isTextFormat(fileType: string): boolean {
    const normalizedType = this.normalizeFileType(fileType);
    return this.TEXT_FORMATS_SET.has(normalizedType);
  }

  static isCadFile(fileType: string): boolean {
    const normalizedType = this.normalizeFileType(fileType);
    return this.CAD_TYPES_SET.has(normalizedType);
  }

  static isDocument(fileType: string): boolean {
    return this.getFileCategory(fileType) === FileCategory.DOCUMENT;
  }

  static isImage(fileType: string): boolean {
    return this.getFileCategory(fileType) === FileCategory.IMAGE;
  }

  static getStandardizedType(fileType: string): string {
    const normalizedType = this.normalizeFileType(fileType);
    return FILE_TYPE_CONSTANTS.SPECIAL_MAPPING[normalizedType as keyof typeof FILE_TYPE_CONSTANTS.SPECIAL_MAPPING] || normalizedType;
  }

  static extractFromFileName(fileName: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    return this.normalizeFileType(ext);
  }

  static isSupported(fileType: string): boolean {
    const category = this.getFileCategory(fileType);
    return category !== FileCategory.UNKNOWN;
  }

  static isArchive(fileType: string): boolean {
    return this.getFileCategory(fileType) === FileCategory.ARCHIVE;
  }
}