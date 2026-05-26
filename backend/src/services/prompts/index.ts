/**
 * prompts/ — 集中式提示词管控模块
 *
 * 架构：
 *   registry.ts  → 唯一数据源（所有提示词定义）
 *   loader.ts    → 运行时加载器（DB → Registry → 兜底）
 *
 * 使用：import { PromptLoader } from '../prompts';
 */

export { PromptLoader } from './loader';
export type { PromptData, LoadSystemOptions } from './loader';
export { BUILTIN_TEMPLATES, resolveModule, SCENE_MODULE_MAP, getPromptFallback } from './registry';
