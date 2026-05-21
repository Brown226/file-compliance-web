/**
 * jieba 中文分词服务
 * 参照 FastGPT 的 packages/service/common/string/jieba/index.ts
 * 使用 @node-rs/jieba（Rust 实现，比纯 JS 快 10 倍+）
 */

import { Jieba } from '@node-rs/jieba';

let jiebaInstance: Jieba | null = null;
let initPromise: Promise<void> | null = null;

const STOP_WORDS = new Set([
  '的', '了', '和', '与', '是', '在', '有', '这', '那', '就', '也', '都',
  '而', '及', '或', '等', '个', '之', '其', '中', '为', '对', '被', '将',
  '从', '到', '把', '让', '给', '向', '以', '于', '不', '没', '无', '要',
  '会', '能', '可', '所', '上', '下', '里', '外', '前', '后', '时', '年',
  '月', '日', '号', '第', '多', '少', '大', '小', '好', '很', '更', '最',
  '还', '已', '又', '再', '着', '过', '地', '得', '吗', '呢', '吧', '啊',
  '呀', '哦', '嗯', '么', '什么', '怎么', '如何', '哪', '哪里', '哪个',
  '几', '多少', '为什么', '因为', '所以', '但是', '但', '如果', '虽然',
  '并且', '而且', '以及', '还是', '或者', '不是', '没有', '可以', '应该',
  '需要', '必须', '可能', '大概', '也许', '一定', '已经', '正在', '将要',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
  'under', 'again', 'further', 'then', 'once', 'and', 'but', 'or', 'nor',
  'not', 'so', 'yet', 'both', 'either', 'neither', 'each', 'every',
  'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because',
]);

async function ensureJieba(): Promise<Jieba> {
  if (jiebaInstance) return jiebaInstance;
  if (!initPromise) {
    initPromise = (async () => {
      jiebaInstance = new Jieba();
    })();
  }
  await initPromise;
  return jiebaInstance!;
}

export async function jiebaSplit(text: string): Promise<string[]> {
  const jieba = await ensureJieba();
  const cleaned = text
    .replace(/[#*`_~>[\](){}|]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .trim();

  if (!cleaned) return [];

  const tokens = jieba.cut(cleaned, true) as string[];

  return tokens
    .map(t => t.replace(/[\u3000-\u303f\uff00-\uffef]/g, '').trim())
    .filter(t => t.length > 0 && !STOP_WORDS.has(t) && t.length <= 24);
}

export async function jiebaSearchQuery(text: string): Promise<string> {
  const tokens = await jiebaSplit(text);
  return tokens.join(' ');
}
