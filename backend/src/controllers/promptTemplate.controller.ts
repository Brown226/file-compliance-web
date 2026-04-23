/**
 * 提示词模板管理控制器
 */

import { Request, Response } from 'express';
import { PromptTemplateService } from '../services/prompt-template.service';

export class PromptTemplateController {

  /** GET /api/prompt-templates — 获取所有模板 */
  static async list(req: Request, res: Response) {
    try {
      const { module } = req.query;
      let templates;
      if (module && typeof module === 'string') {
        templates = await PromptTemplateService.listByModule(module);
      } else {
        templates = await PromptTemplateService.listAll();
      }
      res.json({ code: 200, data: templates });
    } catch (e: any) {
      res.status(500).json({ code: 500, message: e.message });
    }
  }

  /** GET /api/prompt-templates/modules — 获取模块列表 */
  static async getModules(req: Request, res: Response) {
    try {
      const modules = await PromptTemplateService.getModules();
      res.json({ code: 200, data: modules });
    } catch (e: any) {
      res.status(500).json({ code: 500, message: e.message });
    }
  }

  /** GET /api/prompt-templates/:key — 获取单个模板 */
  static async getByKey(req: Request, res: Response) {
    try {
      const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
      const template = await PromptTemplateService.getByKey(key);
      if (!template) {
        return res.status(404).json({ code: 404, message: `模板不存在: ${key}` });
      }
      res.json({ code: 200, data: template });
    } catch (e: any) {
      res.status(500).json({ code: 500, message: e.message });
    }
  }

  /** PUT /api/prompt-templates/:key — 更新模板内容 */
  static async update(req: Request, res: Response) {
    try {
      const { content } = req.body;
      if (content === undefined || content === null) {
        return res.status(400).json({ code: 400, message: 'content 字段必填' });
      }
      const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
      const template = await PromptTemplateService.updateContent(key, content);
      res.json({ code: 200, data: template });
    } catch (e: any) {
      res.status(500).json({ code: 500, message: e.message });
    }
  }

  /** POST /api/prompt-templates/:key/reset — 重置为默认值 */
  static async reset(req: Request, res: Response) {
    try {
      const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
      const template = await PromptTemplateService.resetToDefault(key);
      res.json({ code: 200, data: template });
    } catch (e: any) {
      res.status(500).json({ code: 500, message: e.message });
    }
  }

  /** POST /api/prompt-templates/reset-all — 批量重置 */
  static async resetAll(req: Request, res: Response) {
    try {
      const result = await PromptTemplateService.resetAllToDefault();
      res.json({ code: 200, data: result });
    } catch (e: any) {
      res.status(500).json({ code: 500, message: e.message });
    }
  }

  /** PATCH /api/prompt-templates/:key/toggle — 启用/禁用 */
  static async toggle(req: Request, res: Response) {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ code: 400, message: 'enabled 字段必须为布尔值' });
      }
      const key = Array.isArray(req.params.key) ? req.params.key[0] : req.params.key;
      const template = await PromptTemplateService.toggleEnabled(key, enabled);
      res.json({ code: 200, data: template });
    } catch (e: any) {
      res.status(500).json({ code: 500, message: e.message });
    }
  }

  /** POST /api/prompt-templates/seed — 初始化内置模板 */
  static async seed(req: Request, res: Response) {
    try {
      const result = await PromptTemplateService.seedBuiltinTemplates();
      res.json({ code: 200, data: result });
    } catch (e: any) {
      res.status(500).json({ code: 500, message: e.message });
    }
  }
}
