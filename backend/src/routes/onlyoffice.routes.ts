import { Router, Request, Response } from 'express';
import { authenticate } from '../middlewares/auth.middleware';
import { OnlyOfficeService } from '../services/onlyoffice.service';
import { DocxReplaceService } from '../services/docx-replace.service';
import { VersionService } from '../services/version.service';
import prisma from '../config/db';
import path from 'path';
import fs from 'fs';

const router = Router();

/**
 * 获取文件的编辑器配置
 * GET /api/onlyoffice/editor-config/:fileId
 */
router.get('/editor-config/:fileId', authenticate, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.fileId as string;
    const user = (req as any).user;

    const file = await prisma.taskFile.findUnique({ where: { id: fileId } });
    if (!file) {
      return res.status(404).json({ code: 404, message: '文件不存在' });
    }

    // 如果没有 documentKey，生成一个
    if (!file.documentKey) {
      const { v4: uuidv4 } = require('uuid');
      const key = uuidv4();
      await prisma.taskFile.update({
        where: { id: fileId },
        data: { documentKey: key },
      });
      file.documentKey = key;
    }

    const config = OnlyOfficeService.buildEditorConfig(file, {
      id: user.id,
      name: user.name || user.username,
    });

    res.json({ code: 200, data: config });
  } catch (e: any) {
    console.error('[OnlyOffice] 获取编辑器配置失败:', e);
    res.status(500).json({ code: 500, message: '获取编辑器配置失败', error: e.message });
  }
});

/**
 * OnlyOffice 保存回调
 * POST /api/onlyoffice/save-callback
 * 无需认证 — 由 Document Server 调用
 */
router.post('/save-callback', async (req: Request, res: Response) => {
  const result = await OnlyOfficeService.handleSaveCallback(req.body);
  res.json(result);
});

/**
 * 替换文本（单条）
 * POST /api/onlyoffice/replace-text/:fileId
 */
router.post('/replace-text/:fileId', authenticate, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.fileId as string;
    const { originalText, suggestedText } = req.body;
    const userId = (req as any).user.id;

    if (!originalText || !suggestedText) {
      return res.status(400).json({ code: 400, message: '缺少 originalText 或 suggestedText' });
    }

    const file = await prisma.taskFile.findUnique({ where: { id: fileId } });
    if (!file) {
      return res.status(404).json({ code: 404, message: '文件不存在' });
    }

    if (!['doc', 'docx'].includes(file.fileType.toLowerCase())) {
      return res.status(400).json({ code: 400, message: '仅支持 DOCX 文件的文本替换' });
    }

    // 创建版本快照
    const version = await VersionService.createSnapshot(fileId, userId, 'replace-text');

    // 执行替换
    const absolutePath = path.resolve(file.filePath.startsWith('/')
      ? path.join(__dirname, '../..', file.filePath)
      : file.filePath
    );

    const replacements = DocxReplaceService.replaceText(absolutePath, originalText, suggestedText);

    // 更新 documentKey 使编辑器缓存失效
    const newKey = await OnlyOfficeService.refreshDocumentKey(fileId);

    // 获取新的编辑器配置
    const editorConfig = OnlyOfficeService.buildEditorConfig(
      { ...file, documentKey: newKey },
      { id: userId, name: (req as any).user.name || (req as any).user.username }
    );

    res.json({
      code: 200,
      data: {
        replacements,
        version: version.versionNo,
        editorConfig,
      },
    });
  } catch (e: any) {
    console.error('[OnlyOffice] 文本替换失败:', e);
    res.status(500).json({ code: 500, message: e.message || '文本替换失败' });
  }
});

/**
 * 批量替换文本
 * POST /api/onlyoffice/batch-replace/:fileId
 */
router.post('/batch-replace/:fileId', authenticate, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.fileId as string;
    const { suggestions } = req.body;
    const userId = (req as any).user.id;

    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      return res.status(400).json({ code: 400, message: '缺少 suggestions 数组' });
    }

    const file = await prisma.taskFile.findUnique({ where: { id: fileId } });
    if (!file) {
      return res.status(404).json({ code: 404, message: '文件不存在' });
    }

    if (!['doc', 'docx'].includes(file.fileType.toLowerCase())) {
      return res.status(400).json({ code: 400, message: '仅支持 DOCX 文件的文本替换' });
    }

    // 创建版本快照
    const version = await VersionService.createSnapshot(fileId, userId, 'batch-replace-text');

    // 执行批量替换
    const absolutePath = path.resolve(file.filePath.startsWith('/')
      ? path.join(__dirname, '../..', file.filePath)
      : file.filePath
    );

    const results = DocxReplaceService.batchReplaceText(absolutePath, suggestions);

    // 更新 documentKey
    const newKey = await OnlyOfficeService.refreshDocumentKey(fileId);

    const editorConfig = OnlyOfficeService.buildEditorConfig(
      { ...file, documentKey: newKey },
      { id: userId, name: (req as any).user.name || (req as any).user.username }
    );

    const totalReplacements = results.reduce((sum, r) => sum + r.replacements, 0);

    res.json({
      code: 200,
      data: {
        results,
        totalReplacements,
        version: version.versionNo,
        editorConfig,
      },
    });
  } catch (e: any) {
    console.error('[OnlyOffice] 批量替换失败:', e);
    res.status(500).json({ code: 500, message: e.message || '批量替换失败' });
  }
});

/**
 * 强制保存
 * POST /api/onlyoffice/force-save/:fileId
 */
router.post('/force-save/:fileId', authenticate, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.fileId as string;
    const file = await prisma.taskFile.findUnique({ where: { id: fileId } });
    if (!file?.documentKey) {
      return res.status(404).json({ code: 404, message: '文件不存在或未初始化编辑器' });
    }

    const success = await OnlyOfficeService.forceSave(file.documentKey);
    res.json({ code: 200, data: { success } });
  } catch (e: any) {
    res.status(500).json({ code: 500, message: '强制保存失败', error: e.message });
  }
});

/**
 * 获取版本历史
 * GET /api/onlyoffice/versions/:fileId
 */
router.get('/versions/:fileId', authenticate, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.fileId as string;
    const versions = await VersionService.getVersions(fileId);
    res.json({ code: 200, data: versions });
  } catch (e: any) {
    res.status(500).json({ code: 500, message: '获取版本历史失败', error: e.message });
  }
});

/**
 * 获取版本 diff
 * GET /api/onlyoffice/diff/:fileId/:versionNo
 */
router.get('/diff/:fileId/:versionNo', authenticate, async (req: Request, res: Response) => {
  try {
    const fileId = req.params.fileId as string;
    const versionNo = parseInt(req.params.versionNo as string, 10);
    const diff = await VersionService.diffWithVersion(fileId, versionNo);
    res.json({ code: 200, data: diff });
  } catch (e: any) {
    res.status(500).json({ code: 500, message: '获取 diff 失败', error: e.message });
  }
});

/**
 * 获取 OnlyOffice 服务 URL（供前端使用）
 * GET /api/onlyoffice/url
 */
router.get('/url', (req: Request, res: Response) => {
  res.json({ code: 200, data: { url: OnlyOfficeService.getOnlyOfficeUrl() } });
});

export default router;
