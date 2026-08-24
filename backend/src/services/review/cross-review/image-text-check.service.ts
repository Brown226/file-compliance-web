// backend/src/services/review/cross-review/image-text-check.service.ts
/**
 * 图文复核服务 — 交叉复核第二层（②）
 *
 * 原 TODO：dec-review.service.ts"如有图纸则触发视觉模型复核"。
 *
 * 当前实现（结构化先行）：
 * 当 ctx.dwgStructure 有图纸结构化数据时，做文本级图文交叉验证：
 *   1. 标准引用一致性：图纸 standardRefs 中的标准号在设计文本中必须被提及
 *   2. 关键参数一致性：图纸 dimensions 中的关键标注值在设计文本中必须被体现
 * 产出 issue 打 reviewSource='IMAGE_TEXT'，供前端区分来源。
 *
 * 视觉模型扩展点（预留）：
 *   后端无 DWG→图片渲染能力（parser.service.ts 已注明 DWG 由前端 WASM 解析），
 *   图片链路打通后（审查发起时前端上传图纸图片），可在此处调用
 *   DwgVisionService.analyze(imageBase64, ['compliance'], refText) 做真正的视觉复核，
 *   本类接口签名已预留 imageBase64 参数位，不破坏编排层。
 */

import { PipelineContext } from '../../review-pipeline/types';
import { ReviewIssue } from '../../llm/llm.service';
import { DwgVisionService } from '../../file/dwg-vision.service';

/** 标准号识别：国标/行标/地标编号，如 GB 50016-2014、JGJ/T 231-2021 */
const STD_REF_PATTERN = /\b(?:GB|JGJ|JG|CJ|CJJ|DL|HG|SH|SY|JT|TB|GY|YS|CB|SL|NB|DB)\s*[T\/／]?\s*\d+(?:\.\d+)?(?:[-—－]\d{4})?\b/gi;

/** 关键参数识别：数字+单位（图纸尺寸标注的典型形态），如 DN50、Φ100、0.8MPa、300mm */
const KEY_PARAM_PATTERN = /(?:DN|Φ|φ|Ø)\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:mm|MPa|kPa|kV|V|A|Hz|MPa?|t\/h|L\/s|m³\/h|m3\/h|℃|°C)/gi;

export interface ImageTextCheckOptions {
  /** 视觉模型图片（预留扩展位，本轮未启用） */
  imageBase64?: string;
}

export class ImageTextCheckService {
  static async check(
    issues: ReviewIssue[],
    ctx: PipelineContext,
    text: string,
    _options?: ImageTextCheckOptions,
  ): Promise<ReviewIssue[]> {
    const dwg = ctx.dwgStructure;
    // 无图纸结构化数据：跳过图文复核（被审文件非 dwg，或解析未产出结构）
    if (!dwg) {
      console.log('[ImageTextCheck] 无 dwgStructure，跳过图文复核');
      return issues;
    }

    // 视觉复核（图片链路打通后启用）：options.imageBase64 存在时调用 DwgVisionService.analyze
    if (_options?.imageBase64) {
      try {
        console.log('[ImageTextCheck] 启动视觉复核...');
        const visionResult = await DwgVisionService.analyze(
          _options.imageBase64,
          ['compliance'],
          text, // refText — 设计文本作为参照文本传入
          { jobKey: ctx.traceId },
        );
        if (visionResult?.compliance?.issues) {
          for (const issue of visionResult.compliance.issues) {
            newIssues.push({
              issueType: 'CONSISTENCY',
              severity: 'warning',
              originalText: issue.violation || '',
              description: `视觉复核: ${issue.note || ''}`,
              ruleCode: 'IMG_TXT_VISION',
              reviewSource: 'IMAGE_TEXT',
            } as ReviewIssue);
          }
        }
        console.log(`[ImageTextCheck] 视觉复核完成: ${visionResult?.compliance?.issues?.length || 0} 条问题`);
      } catch (e: any) {
        console.warn(`[ImageTextCheck] 视觉复核失败（降级跳过）: ${e.message}`);
      }
    }

    const newIssues: ReviewIssue[] = [];

    // ===== 1. 标准引用一致性 =====
    if (dwg.standardRefs && dwg.standardRefs.length > 0) {
      const textStdRefs = new Set(
        (text.match(STD_REF_PATTERN) || []).map(s => s.toUpperCase()),
      );
      for (const ref of dwg.standardRefs) {
        const stdNo = (ref.standardNo || '').trim();
        if (!stdNo) continue;
        // 图纸标准号与文本标准号做宽松匹配（图纸侧可能为"GB 50016"而文本为"GB50016-2014"）
        const stdKey = stdNo.toUpperCase().replace(/[\s\-—－/／]/g, '');
        const mentioned = [...textStdRefs].some(t => {
          const tKey = t.replace(/[\s\-—－/／]/g, '');
          return tKey.includes(stdKey.slice(0, 8)) || stdKey.includes(tKey.slice(0, 8));
        });
        if (!mentioned) {
          newIssues.push({
            issueType: 'CONSISTENCY',
            severity: 'warning',
            originalText: stdNo,
            description: `图纸引用了标准 ${stdNo}，但设计文本中未检索到该标准，请人工确认图面与文本是否一致`,
            ruleCode: 'IMG_TXT_STDREF',
            reviewSource: 'IMAGE_TEXT',
            cadHandleId: ref.cadHandleId || undefined,
          } as ReviewIssue);
        }
      }
    }

    // ===== 2. 关键参数一致性 =====
    if (dwg.dimensions && dwg.dimensions.length > 0) {
      const textParams = (text.match(KEY_PARAM_PATTERN) || []).map(s => s.toUpperCase());
      for (const dim of dwg.dimensions) {
        const dimText = (dim.text || '').trim();
        if (!dimText) continue;
        const dimParams = dimText.match(KEY_PARAM_PATTERN) || [];
        for (const p of dimParams) {
          const pKey = p.toUpperCase().replace(/\s+/g, '');
          const mentioned = textParams.some(t => t.includes(pKey));
          if (!mentioned) {
            newIssues.push({
              issueType: 'CONSISTENCY',
              severity: 'warning',
              originalText: dimText,
              description: `图纸标注「${dimText}」中的关键参数 ${p} 未在设计文本中体现，请人工确认图文一致性`,
              ruleCode: 'IMG_TXT_DIMENSION',
              reviewSource: 'IMAGE_TEXT',
              cadHandleId: dim.handle || undefined,
            } as ReviewIssue);
            break; // 一条标注只报一次
          }
        }
      }
    }

    if (newIssues.length > 0) {
      console.log(`[ImageTextCheck] 图文复核: 标准引用 ${dwg.standardRefs?.length || 0} 条、标注 ${dwg.dimensions?.length || 0} 条，发现 ${newIssues.length} 处图文不一致`);
    }
    return [...issues, ...newIssues];
  }
}
