import { Request, Response } from 'express';
import { DwgVisionService } from '../services/dwg-vision.service';

const VALID_ANALYSES = ['titleBlock', 'symbols', 'annotations', 'compliance'];

/**
 * POST /api/dwg/vision-analyze
 * 图纸视觉智能分析
 */
export const visionAnalyze = async (req: Request, res: Response): Promise<void> => {
  try {
    const { imageBase64, fileName, analyses, refText } = req.body;

    // 参数校验
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      res.status(400).json({ code: 400, message: '缺少 imageBase64 参数（PNG 图片 base64 编码）' });
      return;
    }

    // 检查图片大小（base64 长度 * 0.75 ≈ 实际字节数，限制 10MB）
    const estimatedSize = imageBase64.length * 0.75;
    if (estimatedSize > 10 * 1024 * 1024) {
      res.status(400).json({ code: 400, message: '图片过大（超过 10MB），请降低渲染分辨率后重试' });
      return;
    }

    // 校验分析项
    const selectedAnalyses: string[] = Array.isArray(analyses) && analyses.length > 0
      ? analyses.filter((a: string) => VALID_ANALYSES.includes(a))
      : VALID_ANALYSES; // 默认全部

    if (selectedAnalyses.length === 0) {
      res.status(400).json({ code: 400, message: `analyses 参数无效，可选值: ${VALID_ANALYSES.join(', ')}` });
      return;
    }

    console.log(`[DWG Vision] 开始分析: ${fileName || 'unknown'}, 分析项: ${selectedAnalyses.join(', ')}`);

    const result = await DwgVisionService.analyze(imageBase64, selectedAnalyses, refText);

    console.log(`[DWG Vision] 分析完成: ${fileName || 'unknown'}, 耗时 ${result.duration_ms}ms, 错误 ${result.errors.length} 个`);

    res.json({
      code: 200,
      message: 'success',
      data: result,
    });
  } catch (err: any) {
    console.error('[DWG Vision] 分析失败:', err);
    const message = err.message || '图纸视觉分析失败';
    const statusCode = message.includes('未配置') ? 400 : 500;
    res.status(statusCode).json({ code: statusCode, message });
  }
};

/**
 * GET /api/dwg/vision-status
 * 检查视觉模型是否已配置
 */
export const visionStatus = async (_req: Request, res: Response): Promise<void> => {
  try {
    // 尝试获取配置（不实际调用 API）
    const prisma = (await import('../config/db')).default;
    const keys = ['llm_vision_model', 'llm_ocr_model'];
    let configured = false;
    let modelName = '';

    for (const key of keys) {
      const config = await prisma.systemConfig.findUnique({ where: { key } });
      if (config?.value && typeof config.value === 'object') {
        const v = config.value as any;
        if (v.apiKey && v.modelName) {
          configured = true;
          modelName = v.modelName;
          break;
        }
      }
    }

    res.json({
      code: 200,
      data: { configured, modelName, analyses: VALID_ANALYSES },
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
};
