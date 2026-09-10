import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { isFeatureEnabled } from '../services/system/feature-flag.service';

/**
 * 功能开关门禁中间件
 *
 * 与 task.controller.ts 对「审查模式」的口径一致，但下沉为可复用中间件，
 * 供不经由 POST /api/tasks 的独立入口复用（如标准引用自检、图纸视觉分析）——
 * 这些入口此前完全没有开关校验，管理员在「功能管理」里关掉开关后仍可调用。
 *
 * 使用方式（建议挂在校验/落盘之前，避免无谓的文件写入）：
 *   router.post('/run', authenticate, requireFeatureFlag('entry.SELF_CHECK'), upload.single('file'), handler)
 *
 * 失败放行（fail-open）：开关服务异常（DB/缓存抖动）时放行并告警，而不是拒绝。
 * 理由与前端 useFeatureFlags.ts「拉取失败时默认全部启用」的既有设计一致：
 * 开关用于控制入口可见性（内测灰度），不应因基础设施抖动导致整个功能不可用。
 */
export const requireFeatureFlag = (flagKey: string) => {
  return async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const enabled = await isFeatureEnabled(flagKey);
      if (!enabled) {
        res.status(403).json({
          success: false,
          code: 403,
          message: `该功能已被管理员禁用（${flagKey}=false），请在「功能管理」中启用`,
          data: null,
        });
        return;
      }
      next();
    } catch (e: any) {
      console.warn(`[FeatureFlag] 开关校验失败，放行: ${flagKey}`, e?.message || e);
      next();
    }
  };
};
