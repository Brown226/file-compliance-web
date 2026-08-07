/**
 * 提示词运行时读取服务（registry 门面）
 *
 * 提示词内容唯一数据源：services/prompts/registry.ts
 * 本文件仅保留兼容旧调用方的门面方法，内部全部从 registry 读取，无 DB 依赖。
 * 提示词管理面板已移除（2025-08-05），运行时不再支持 DB 覆盖。
 */

import { getPromptFallback } from '../prompts';

// ==================== 类型定义 ====================

export interface PromptTemplateData {
  key: string;
  module: string;
  role: string;
  variant: string;
  name: string;
  description?: string;
  content: string;
  placeholders?: string;
  defaultValue?: string;
  isBuiltin?: boolean;
  enabled?: boolean;
}

// ==================== 服务类 ====================

export class PromptTemplateService {

  /**
   * 按场景获取提示词（纯 registry 读取）
   *
   * @param module 审查场景（如 'library_review'）
   * @param role 提示词角色（system / user）
   * @param variant 变体（default / with_context / no_context 等，未命中时降级 default）
   * @param fallback 未找到时的兜底
   */
  static async getPromptByScene(
    module: string,
    role: 'system' | 'user',
    variant: string = 'default',
    fallback?: string,
  ): Promise<string> {
    return getPromptFallback(module, role, variant) || fallback || '';
  }
}
