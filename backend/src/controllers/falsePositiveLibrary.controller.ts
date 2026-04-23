import { Request, Response, NextFunction } from 'express'
import FalsePositiveLibraryService from '../services/falsePositiveLibrary.service'
import ExcelJS from 'exceljs'

class FalsePositiveLibraryController {
  /**
   * 获取误报标记库列表
   */
  static async list(req: Request, res: Response, next: NextFunction) {
    try {
      const { issueType, ruleCode, keyword, page, pageSize } = req.query

      const result = await FalsePositiveLibraryService.list({
        issueType: issueType as string,
        ruleCode: ruleCode as string,
        keyword: keyword as string,
        page: page ? parseInt(page as string) : 1,
        pageSize: pageSize ? parseInt(pageSize as string) : 20,
      })

      res.json({
        code: 200,
        data: result,
        message: '获取成功',
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * 导出误报标记库
   */
  static async export(req: Request, res: Response, next: NextFunction) {
    try {
      const { issueType, ruleCode, keyword } = req.query

      const records = await FalsePositiveLibraryService.getExportData({
        issueType: issueType as string,
        ruleCode: ruleCode as string,
        keyword: keyword as string,
      })

      // 创建 Excel 工作簿
      const workbook = new ExcelJS.Workbook()
      const worksheet = workbook.addWorksheet('误报标记库')

      // 设置列标题
      worksheet.columns = [
        { header: '序号', key: 'index', width: 8 },
        { header: '原文', key: 'originalText', width: 40 },
        { header: '误报原因', key: 'fpReason', width: 30 },
        { header: '问题分类', key: 'issueType', width: 12 },
        { header: '规则代码', key: 'ruleCode', width: 15 },
        { header: '严重度', key: 'severity', width: 10 },
        { header: '标记人', key: 'markedByName', width: 12 },
        { header: '关联任务', key: 'taskTitle', width: 25 },
        { header: '标记次数', key: 'count', width: 10 },
        { header: '最后标记时间', key: 'lastMarkedAt', width: 20 },
      ]

      // 添加数据行
      records.forEach((record, idx) => {
        worksheet.addRow({
          index: idx + 1,
          originalText: record.originalText,
          fpReason: record.fpReason || '-',
          issueType: record.issueType || '-',
          ruleCode: record.ruleCode || '-',
          severity: record.severity || '-',
          markedByName: record.markedByName || '-',
          taskTitle: record.taskTitle || '-',
          count: record.count,
          lastMarkedAt: record.lastMarkedAt
            ? new Date(record.lastMarkedAt).toLocaleString('zh-CN')
            : '-',
        })
      })

      // 设置标题行样式
      worksheet.getRow(1).font = { bold: true }
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      }

      // 设置响应头
      const fileName = `误报标记库_${new Date().toISOString().slice(0, 10)}.xlsx`
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      )
      res.setHeader(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
      )

      // 写入文件
      await workbook.xlsx.write(res)
      res.end()
    } catch (error) {
      next(error)
    }
  }

  /**
   * 获取统计信息
   */
  static async stats(req: Request, res: Response, next: NextFunction) {
    try {
      const prisma = require('../config/db').default
      const [total, byType, recentCount] = await Promise.all([
        prisma.falsePositiveLibrary.count(),
        prisma.falsePositiveLibrary.groupBy({
          by: ['issueType'],
          _count: { originalText: true },
        }),
        prisma.falsePositiveLibrary.count({
          where: {
            lastMarkedAt: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        }),
      ])

      res.json({
        code: 200,
        data: {
          total,
          recentCount,
          byType: byType.map((item: any) => ({
            type: item.issueType,
            count: item._count.originalText,
          })),
        },
        message: '获取成功',
      })
    } catch (error) {
      next(error)
    }
  }

  /**
   * 删除记录
   */
  static async delete(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params
      const prisma = require('../config/db').default

      await prisma.falsePositiveLibrary.delete({
        where: { id },
      })

      res.json({
        code: 200,
        data: null,
        message: '删除成功',
      })
    } catch (error) {
      next(error)
    }
  }
}

export default FalsePositiveLibraryController
