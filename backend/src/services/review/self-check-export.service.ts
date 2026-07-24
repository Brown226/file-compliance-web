/**
 * 自检报告 Excel 导出
 * 
 * 格式对齐 Normative 的 ExportResult + 需求文档附件2：
 * 列：序号 | 标准名称 | 标准编号 | 错误类型/内容 | 更正后标准名称 | 更正后标准编号
 * 字符级差异用红色（错误）/ 绿色（正确）标记
 */

import ExcelJS from 'exceljs';
import { SelfCheckReport, SelfCheckService } from './self-check.service';

export class SelfCheckExportService {
  /**
   * 清理非法 Unicode 字符（孤立代理项等），防止 ExcelJS 写入报错
   */
  private static sanitize(text: string | null | undefined): string {
    if (!text) return '-';
    // 移除孤立代理项（U+D800-U+DFFF）和其他非法 Unicode 字符
    return text.replace(/[\ud800-\udfff]/g, '').replace(/�/g, '') || '-';
  }

  /**
   * 生成自检报告 Excel Buffer
   */
  static async exportReport(report: SelfCheckReport): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('标准引用自检报告');

    // 列定义（附件2格式6列 + 扩展1列来源文件）
    const columns = [
      { header: '序号', key: 'index', width: 8 },
      { header: '标准名称', key: 'standardName', width: 35 },
      { header: '标准编号', key: 'standardNo', width: 28 },
      { header: '错误类型/内容', key: 'errorType', width: 30 },
      { header: '更正后的标准名称', key: 'correctName', width: 35 },
      { header: '更正后的标准编号', key: 'correctNo', width: 28 },
      { header: '来源文件', key: 'sourceFile', width: 25 },
    ];

    ws.columns = columns;

    // 表头样式
    const headerRow = ws.getRow(1);
    headerRow.font = { name: '宋体', size: 11, bold: true };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F0FE' } };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    headerRow.eachCell(cell => {
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });

    // 填充数据行
    report.items.forEach((item, idx) => {
      const errorDesc = item.errorTypes.length > 0
        ? item.errorTypes.map(t => SelfCheckService.errorTypeLabel(t)).join('；')
        : (item.matchResult.matched ? '一致' : '');

      ws.addRow({
        index: idx + 1,
        standardName: SelfCheckExportService.sanitize(item.docStandardName),
        standardNo: SelfCheckExportService.sanitize(item.docStandardNo),
        errorType: SelfCheckExportService.sanitize(errorDesc),
        correctName: SelfCheckExportService.sanitize(item.matchResult.libraryStandardName),
        correctNo: SelfCheckExportService.sanitize(item.matchResult.libraryStandardNo),
        sourceFile: SelfCheckExportService.sanitize(item.sourceFile),
      });
    });

    // 数据行样式
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      row.font = { name: '宋体', size: 11 };
      row.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      row.eachCell(cell => {
        cell.border = {
          top: { style: 'thin' },
          bottom: { style: 'thin' },
          left: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      const item = report.items[r - 2];
      if (!item) continue;

      // 给错误行标色（浅红背景）
      if (item.errorTypes.length > 0) {
        const errorCell = row.getCell(4); // 错误类型列
        errorCell.font = { name: '宋体', size: 11, color: { argb: 'FFD32F2F' } }; // 红色
      }

      // 对匹配成功行标色（浅绿背景）
      if (item.matchResult.matched && item.errorTypes.length === 0) {
        const statusCell = row.getCell(4);
        statusCell.font = { name: '宋体', size: 11, color: { argb: 'FF388E3C' } }; // 绿色
      }

      // 字符级差异标记（红色错误段 + 绿色正确段）
      if (item.noDiff) {
        SelfCheckExportService.applyCharDiffToCell(
          row.getCell(3), // 标准编号列（原文）
          item.docStandardNo,
          item.noDiff,
          true // 标红
        );
      }
      if (item.noDiff && item.matchResult.libraryStandardNo) {
        SelfCheckExportService.applyCharDiffToCell(
          row.getCell(6), // 更正后标准编号列
          item.matchResult.libraryStandardNo,
          item.noDiff,
          false // 标绿
        );
      }
      if (item.nameDiff) {
        SelfCheckExportService.applyCharDiffToCell(
          row.getCell(2), // 标准名称列
          item.docStandardName,
          item.nameDiff,
          true
        );
      }
      if (item.nameDiff && item.matchResult.libraryStandardName) {
        SelfCheckExportService.applyCharDiffToCell(
          row.getCell(5),
          item.matchResult.libraryStandardName,
          item.nameDiff,
          false
        );
      }
    }

    // 汇总信息行
    ws.addRow([]);
    ws.addRow([]);
    const summaryRow = ws.addRow([
      `自检完成时间：${new Date(report.checkedAt).toLocaleString('zh-CN')}`,
      `标准库：${report.standardLibraryInfo.name}（共${report.standardLibraryInfo.total}条）`,
      `检查总数：${report.totalChecked} 条`,
      `完全匹配：${report.matchedCount} 条`,
      `存在错误：${report.errorCount} 条`,
      '',
      '',
    ]);
    summaryRow.font = { name: '宋体', size: 10, italic: true };
    summaryRow.getCell(1).font = { name: '宋体', size: 10, bold: true };

    return (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  }

  /**
   * 对单元格应用字符级差异着色
   */
  private static applyCharDiffToCell(
    cell: ExcelJS.Cell,
    text: string,
    diff: { originalRanges: Array<{ start: number; length: number }>; correctRanges: Array<{ start: number; length: number }> },
    isErrorSide: boolean // true=标红(原文错误), false=标绿(正确)
  ) {
    const ranges = isErrorSide ? diff.originalRanges : diff.correctRanges;
    if (!ranges || ranges.length === 0) return;

    const cleanText = SelfCheckExportService.sanitize(text);
    const color = isErrorSide ? 'FFD32F2F' : 'FF388E3C'; // 红色 / 绿色

    // ExcelJS 富文本：将文本分段，差异段着色
    const richText: Array<{ text: string; font?: { color: { argb: string } } }> = [];
    let cursor = 0;

    for (const range of ranges.sort((a, b) => a.start - b.start)) {
      if (range.start > cursor) {
        richText.push({ text: cleanText.substring(cursor, range.start) });
      }
      const endIdx = Math.min(range.start + range.length, cleanText.length);
      richText.push({
        text: cleanText.substring(range.start, endIdx),
        font: { color: { argb: color } },
      });
      cursor = endIdx;
    }

    if (cursor < cleanText.length) {
      richText.push({ text: cleanText.substring(cursor) });
    }

    if (richText.length > 0) {
      cell.value = { richText };
    }
  }
}
