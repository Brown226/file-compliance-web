import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/db';
import path from 'path';
import fs from 'fs';

const ONLYOFFICE_JWT_SECRET = process.env.ONLYOFFICE_JWT_SECRET || 'change-me-onlyoffice-jwt-secret';
if (!process.env.ONLYOFFICE_JWT_SECRET) console.warn('[OnlyOffice] JWT_SECRET not set, using default');
const ONLYOFFICE_URL = process.env.ONLYOFFICE_URL || 'http://localhost:8082';
const BACKEND_URL_FOR_DOCKER = process.env.BACKEND_URL_FOR_DOCKER || process.env.APP_HOST || 'host.docker.internal:3000';

interface EditorConfig {
  document: {
    fileType: string;
    key: string;
    title: string;
    url: string;
    permissions: {
      edit: boolean;
      comment: boolean;
      review: boolean;
    };
  };
  documentType: string;
  editorConfig: {
    mode: 'edit' | 'view';
    callbackUrl: string;
    user: { id: string; name: string };
    customization: {
      forcesave: boolean;
      compactHeader: boolean;
      compactToolbar: boolean;
      toolbarNoTabs: boolean;
      toolbarHideNoTabs: boolean;
      chat: boolean;
      feedback: boolean;
      plugins: boolean;
      rightMenu: boolean;
      rulers: boolean;
    };
  };
  token: string;
}

export class OnlyOfficeService {
  /**
   * 构建 OnlyOffice 编辑器配置
   */
  static buildEditorConfig(fileRecord: {
    id: string;
    fileName: string;
    filePath: string;
    fileType: string;
    documentKey?: string | null;
  }, user: { id: string; name: string }): EditorConfig {
    const ext = fileRecord.fileType.toLowerCase();
    const isPdf = ext === 'pdf';
    const isDocx = ['doc', 'docx'].includes(ext);
    const isEditable = isDocx;

    // 文件 URL — Document Server 通过此 URL 获取文件
    const filename = path.basename(fileRecord.filePath);
    const fileUrl = `http://${BACKEND_URL_FOR_DOCKER}/uploads/${filename}`;

    // 文档密钥 — 用于缓存失效和协同编辑
    const documentKey = fileRecord.documentKey || uuidv4();

    const payload: any = {
      document: {
        fileType: ext,
        key: documentKey,
        title: fileRecord.fileName,
        url: fileUrl,
        permissions: {
          edit: isEditable,
          comment: isEditable,
          review: false,
        },
      },
      documentType: isPdf ? 'pdf' : 'word',
      editorConfig: {
        mode: isEditable ? 'edit' : 'view',
        callbackUrl: `http://${BACKEND_URL_FOR_DOCKER}/api/onlyoffice/save-callback`,
        user: {
          id: `user-${user.id}`,
          name: user.name,
        },
        customization: {
          forcesave: isEditable,
          compactHeader: true,
          compactToolbar: true,
          toolbarNoTabs: false,
          toolbarHideNoTabs: true,
          chat: false,
          feedback: false,
          plugins: false,
          rightMenu: false,
          rulers: false,
        },
      },
    };

    // JWT 签名
    const token = jwt.sign(payload, ONLYOFFICE_JWT_SECRET);
    payload.token = token;

    return payload as EditorConfig;
  }

  /**
   * 处理 OnlyOffice 保存回调
   */
  static async handleSaveCallback(body: any): Promise<{ error: number }> {
    try {
      const status = body.status;

      // status: 0-编辑中, 1-已保存, 2-准备保存, 3-保存错误, 4-已关闭无修改, 6-强制保存
      if (status === 2 || status === 6) {
        const downloadUrl = body.url;
        if (!downloadUrl) return { error: 0 };

        // 从 callback URL 的 key 中提取文件信息
        const key = body.key;
        if (!key) return { error: 0 };

        // 查找关联的文件记录
        const fileRecord = await prisma.taskFile.findFirst({
          where: { documentKey: key },
        });

        if (!fileRecord) {
          console.warn(`[OnlyOffice] 保存回调：未找到文件记录 (key=${key})`);
          return { error: 0 };
        }

        // 下载更新后的文件并覆盖
        const absolutePath = path.resolve(fileRecord.filePath.startsWith('/')
          ? path.join(__dirname, '../..', fileRecord.filePath)
          : fileRecord.filePath
        );

        const response = await fetch(downloadUrl);
        if (!response.ok) {
          throw new Error(`下载文件失败: ${response.statusText}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(absolutePath, buffer);

        // 更新文件大小
        await prisma.taskFile.update({
          where: { id: fileRecord.id },
          data: { fileSize: buffer.length },
        });

        console.log(`[OnlyOffice] 文件已保存: ${fileRecord.fileName} (${buffer.length} bytes)`);
      }

      return { error: 0 };
    } catch (e: any) {
      console.error('[OnlyOffice] 保存回调处理失败:', e.message);
      return { error: 0 }; // 始终返回 0，避免 OnlyOffice 重试
    }
  }

  /**
   * 发送命令到 OnlyOffice Command Service
   */
  static async sendCommand(command: string, key: string): Promise<any> {
    const payload = {
      c: command,
      key,
    };

    const token = jwt.sign(payload, ONLYOFFICE_JWT_SECRET);

    const response = await fetch(`${ONLYOFFICE_URL}/coauthoring/CommandService.ashx`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ ...payload, token }),
    });

    return response.json();
  }

  /**
   * 强制保存文档
   */
  static async forceSave(documentKey: string): Promise<boolean> {
    try {
      const result = await this.sendCommand('forcesave', documentKey);
      return result?.error === 0;
    } catch (e: any) {
      console.error('[OnlyOffice] 强制保存失败:', e.message);
      return false;
    }
  }

  /**
   * 更新文件的 documentKey（文件内容变更后必须更新以使编辑器缓存失效）
   */
  static async refreshDocumentKey(fileId: string): Promise<string> {
    const newKey = uuidv4();
    await prisma.taskFile.update({
      where: { id: fileId },
      data: { documentKey: newKey },
    });
    return newKey;
  }

  /**
   * 获取文件的编辑器配置（含 fresh documentKey）
   */
  static async getEditorConfig(fileId: string, user: { id: string; name: string }): Promise<EditorConfig | null> {
    const file = await prisma.taskFile.findUnique({ where: { id: fileId } });
    if (!file) return null;

    return this.buildEditorConfig(file, user);
  }

  /**
   * 获取 OnlyOffice 服务 URL（供前端使用）
   */
  static getOnlyOfficeUrl(): string {
    return process.env.VITE_APP_ONLYOFFICE_URL || 'http://localhost:8082';
  }
}
