import { FileTypeService } from '../file-type.service';
import { FileCategory } from '../file-type.constants';

describe('FileTypeService', () => {
  describe('normalizeFileType', () => {
    it('should normalize MIME type to extension', () => {
      expect(FileTypeService.normalizeFileType('application/pdf')).toBe('pdf');
      expect(FileTypeService.normalizeFileType('application/msword')).toBe('docx'); // SPECIAL_MAPPING: doc→docx
    });

    it('should normalize image data URI to "image"', () => {
      expect(FileTypeService.normalizeFileType('data:image/png;base64,xxx')).toBe('image');
    });

    it('should use fileName extension as fallback', () => {
      expect(FileTypeService.normalizeFileType('', 'report.pdf')).toBe('pdf');
      expect(FileTypeService.normalizeFileType('unknown', 'file.docx')).toBe('docx');
    });

    it('should apply special mapping (doc → docx)', () => {
      expect(FileTypeService.normalizeFileType('doc')).toBe('docx');
      expect(FileTypeService.normalizeFileType('docx')).toBe('docx');
    });

    it('should handle empty input', () => {
      expect(FileTypeService.normalizeFileType('')).toBe('');
    });

    it('should handle case insensitivity', () => {
      expect(FileTypeService.normalizeFileType('PDF')).toBe('pdf');
      expect(FileTypeService.normalizeFileType('application/PDF')).toBe('pdf');
    });
  });

  describe('getFileCategory', () => {
    it('should return DOCUMENT for pdf', () => {
      expect(FileTypeService.getFileCategory('pdf')).toBe(FileCategory.DOCUMENT);
    });

    it('should return IMAGE for png', () => {
      expect(FileTypeService.getFileCategory('png')).toBe(FileCategory.IMAGE);
    });

    it('should return CAD for dwg', () => {
      expect(FileTypeService.getFileCategory('dwg')).toBe(FileCategory.CAD);
    });

    it('should return TEXT for txt', () => {
      expect(FileTypeService.getFileCategory('txt')).toBe(FileCategory.TEXT);
    });

    it('should return ARCHIVE for zip', () => {
      expect(FileTypeService.getFileCategory('zip')).toBe(FileCategory.ARCHIVE);
    });

    it('should return UNKNOWN for unknown type', () => {
      expect(FileTypeService.getFileCategory('xyz')).toBe(FileCategory.UNKNOWN);
    });
  });

  describe('isOcrSupported', () => {
    it('should return true for pdf', () => {
      expect(FileTypeService.isOcrSupported('pdf')).toBe(true);
    });

    it('should return true for image types', () => {
      expect(FileTypeService.isOcrSupported('png')).toBe(true);
      expect(FileTypeService.isOcrSupported('jpg')).toBe(true);
    });

    it('should return false for docx', () => {
      expect(FileTypeService.isOcrSupported('docx')).toBe(false);
    });
  });

  describe('isTextFormat', () => {
    it('should return true for text formats', () => {
      expect(FileTypeService.isTextFormat('txt')).toBe(true);
      expect(FileTypeService.isTextFormat('json')).toBe(true);
      expect(FileTypeService.isTextFormat('csv')).toBe(true);
    });

    it('should return false for non-text formats', () => {
      expect(FileTypeService.isTextFormat('pdf')).toBe(false);
      expect(FileTypeService.isTextFormat('png')).toBe(false);
    });
  });

  describe('isCadFile', () => {
    it('should return true for CAD types', () => {
      expect(FileTypeService.isCadFile('dwg')).toBe(true);
      expect(FileTypeService.isCadFile('dxf')).toBe(true);
    });

    it('should return false for non-CAD types', () => {
      expect(FileTypeService.isCadFile('pdf')).toBe(false);
    });
  });

  describe('isDocument / isImage', () => {
    it('should identify documents', () => {
      expect(FileTypeService.isDocument('pdf')).toBe(true);
      expect(FileTypeService.isDocument('docx')).toBe(true);
      expect(FileTypeService.isDocument('png')).toBe(false);
    });

    it('should identify images', () => {
      expect(FileTypeService.isImage('png')).toBe(true);
      expect(FileTypeService.isImage('pdf')).toBe(false);
    });
  });

  describe('extractFromFileName', () => {
    it('should extract type from filename', () => {
      expect(FileTypeService.extractFromFileName('report.pdf')).toBe('pdf');
      expect(FileTypeService.extractFromFileName('data.xlsx')).toBe('xlsx');
    });

    it('should handle files without extension', () => {
      expect(FileTypeService.extractFromFileName('Makefile')).toBe('makefile');
    });
  });

  describe('isSupported', () => {
    it('should return true for known types', () => {
      expect(FileTypeService.isSupported('pdf')).toBe(true);
      expect(FileTypeService.isSupported('png')).toBe(true);
    });

    it('should return false for unknown types', () => {
      expect(FileTypeService.isSupported('xyz')).toBe(false);
    });
  });
});
