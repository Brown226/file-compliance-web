/**
 * AI 润色服务
 *
 * 提供 10 种润色风格，用户选择风格后对文本进行 AI 润色。
 * 三段式输出：润色结果 + 修改对比 + 优化说明。
 *
 * 借鉴 TextGuard polish.py 的完整实现（10 种风格 + 三段式 prompt）。
 */

import { LlmService } from './llm.service';

// 10 种润色风格定义
export const POLISH_STYLES: Record<string, { name: string; description: string; prompt: string }> = {
  formal: {
    name: '正式规范',
    description: '标准公文语体，结构完整、用词严谨、格式规范',
    prompt: `你是一位拥有15年经验的企业高级行政文书专家。请将用户输入的内容润色为**正式规范的职场书面表达**。

【润色原则】
- 使用规范的书面语，避免口语化、网络用语和非正式缩写
- 语气客观中立、沉稳大气，不带个人情绪色彩
- 用词准确严谨，杜绝歧义

【结构要求】
- 采用清晰的逻辑框架组织内容（背景→事项→要求）
- 合理分段，每段聚焦一个主题
- 关键信息使用**加粗**标记

【输出格式】使用三段式 Markdown 输出。
## 润色结果
（润色后的完整文本）

## 修改对比
| 原文片段 | 修改后 |
|---------|--------|
| ... | ... |

## 优化说明
- 优化1：说明
- 优化2：说明`,
  },
  friendly: {
    name: '亲和自然',
    description: '像面对面聊天，去掉官腔，拉近距离',
    prompt: `你是一位在团队中人缘极好的资深管理者，擅长用温暖且高效的方式进行职场沟通。请将用户输入的内容润色为**亲和自然的职场日常沟通风格**。

【润色原则】
- 使用自然的口语化表达，但保持专业性
- 语气温暖、真诚，使用"我们""大家"等拉近距离的词汇
- 去掉官腔、套话、空洞的修饰词
- 适当使用语气词和过渡句，让表达更自然流畅
- 保持信息完整准确，不因追求亲和而丢失关键信息

【输出格式】使用三段式 Markdown 输出。`,
  },
  concise: {
    name: '简洁精炼',
    description: '删掉废话，保留干货，信息密度最大化',
    prompt: `你是一位在咨询行业从业10年的资深顾问，擅长用最精炼的语言传递最完整的信息。请将用户输入的内容润色为**简洁精炼的高信息密度表达**。

【润色原则】
- 删除所有冗余修饰词、重复表述、空洞的铺垫
- 每句话必须承载有效信息，能用一句话说明的不用两句
- 使用短句和主动语态，避免被动语态和冗长从句
- 保留所有关键信息（时间、数据、责任人、结论），不因追求简洁而丢失
- 可使用列表/表格替代长段落

【输出格式】使用三段式 Markdown 输出。`,
  },
  academic: {
    name: '严谨学术',
    description: '论文/报告语体，逻辑严密、术语规范',
    prompt: `你是一位学术期刊的资深审稿人，擅长学术写作。请将用户输入的内容润色为**严谨的学术风格**。

【润色原则】
- 使用规范的学术用语和行业术语
- 逻辑严密，因果关系清晰，论证充分
- 语气客观中立，避免主观判断和情绪化表达
- 引用规范，数据准确

【输出格式】使用三段式 Markdown 输出。`,
  },
  business: {
    name: '专业商务',
    description: '商业邮件/方案语体，结果导向、条理清晰',
    prompt: `你是一位世界500强企业的高级商务经理，擅长撰写专业商务文书。请将用户输入的内容润色为**专业商务风格**。

【润色原则】
- 结果导向，开头直接点明目的和结论
- 条理清晰，使用分点和编号组织内容
- 语气专业但不生硬，体现合作诚意
- 适当时使用商务术语，但不过度

【输出格式】使用三段式 Markdown 输出。`,
  },
  persuasive: {
    name: '耐心说服',
    description: '争取支持/资源，循序渐进、有理有据',
    prompt: `你是一位经验丰富的政府事务或企业公关专家，擅长通过沟通争取支持。请将用户输入的内容润色为**有说服力的沟通风格**。

【润色原则】
- 循序渐进：先建立共识，再提出诉求
- 有理有据：用数据和事实支撑观点
- 换位思考：站在对方角度说明利益
- 语气诚恳但不卑微，坚定但不强硬

【输出格式】使用三段式 Markdown 输出。`,
  },
  directive: {
    name: '清晰指令',
    description: '分配任务/布置工作，不含糊、可执行',
    prompt: `你是一位经验丰富的项目管理者，擅长下达清晰可执行的指令。请将用户输入的内容润色为**清晰明确的指令风格**。

【润色原则】
- 明确责任人和时间节点
- 使用祈使句，不含糊其辞
- 关键要求加粗突出
- 复杂任务分解为可执行的步骤

【输出格式】使用三段式 Markdown 输出。`,
  },
  news: {
    name: '新闻稿',
    description: '对外宣传/报道，吸引眼球、信息准确',
    prompt: `你是一位资深新闻媒体人，擅长撰写新闻稿。请将用户输入的内容润色为**新闻稿风格**。

【润色原则】
- 标题吸引眼球，概括核心信息
- 倒金字塔结构：最重要的信息放在最前面
- 语言生动但不浮夸，事实准确
- 适合对外发布和媒体传播

【输出格式】使用三段式 Markdown 输出。`,
  },
  encouraging: {
    name: '温柔鼓励',
    description: '团队激励/个人鼓励，温暖有力、真诚感人',
    prompt: `你是一位深受团队成员信任的领导者，擅长用温暖的话语激励团队。请将用户输入的内容润色为**温暖鼓励的风格**。

【润色原则】
- 真诚第一，避免空洞的套话
- 具体肯定，指出值得肯定的具体行为和成果
- 展望未来，给予信心和方向
- 语气温暖但不煽情，有力但不压迫

【输出格式】使用三段式 Markdown 输出。`,
  },
  humorous: {
    name: '幽默风趣',
    description: '活跃气氛，适当幽默，拉近距离',
    prompt: `你是一位情商极高、幽默感恰到好处的团队领导者。请将用户输入的内容润色为**幽默风趣但不失专业的风格**。

【润色原则】
- 适度幽默，不低俗、不冒犯
- 幽默服务于沟通目的，不为了搞笑而搞笑
- 保持专业底线，重要信息清晰传达
- 使用双关、类比等修辞手法，避免冷笑话

【输出格式】使用三段式 Markdown 输出。`,
  },
};

export interface PolishRequest {
  text: string;
  style: string; // POLISH_STYLES 的 key
}

export interface PolishResponse {
  original: string;
  polished: string;
  style: string;
  styleName: string;
  diffs: Array<{ original: string; polished: string }>;
  explanations: string[];
}

export class PolishService {
  /**
   * 获取所有可用风格
   */
  static getStyles(): Array<{ key: string; name: string; description: string }> {
    return Object.entries(POLISH_STYLES).map(([key, val]) => ({
      key,
      name: val.name,
      description: val.description,
    }));
  }

  /**
   * 执行 AI 润色
   */
  static async polish(request: PolishRequest): Promise<PolishResponse> {
    const style = POLISH_STYLES[request.style];
    if (!style) {
      throw new Error(`不支持的润色风格: ${request.style}，可用风格: ${Object.keys(POLISH_STYLES).join(', ')}`);
    }

    const systemPrompt = style.prompt;
    const userContent = `请润色以下文本（风格：${style.name}）：\n\n${request.text}`;

    // 直接调用 LlmService.chat 获取原始文本，不经过 reviewText 的 issue 解析层
    const fullContent = await LlmService.chat(userContent, {
      systemPrompt,
      temperature: 0.7,
      timeout: 120,
    });

    // 提取三段内容
    const polished = this.extractSection(fullContent, '润色结果') || request.text;
    const diffSection = this.extractSection(fullContent, '修改对比') || '';
    const explanationSection = this.extractSection(fullContent, '优化说明') || '';

    // 解析修改对比表格
    const diffs = this.parseDiffTable(diffSection);

    // 解析优化说明列表
    const explanations = explanationSection
      .split('\n')
      .filter(line => line.trim().startsWith('-') || line.trim().startsWith('*'))
      .map(line => line.replace(/^[-*\s]+/, '').trim())
      .filter(Boolean);

    return {
      original: request.text,
      polished,
      style: request.style,
      styleName: style.name,
      diffs: diffs.length > 0 ? diffs : [{ original: request.text, polished }],
      explanations: explanations.length > 0 ? explanations : ['润色完成'],
    };
  }

  /**
   * 从 Markdown 中提取指定标题下的内容
   */
  private static extractSection(content: string, sectionTitle: string): string {
    const regex = new RegExp(`## ${sectionTitle}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`);
    const match = content.match(regex);
    return match ? match[1].trim() : '';
  }

  /**
   * 解析 Markdown 表格为修改对比
   */
  private static parseDiffTable(markdown: string): Array<{ original: string; polished: string }> {
    const lines = markdown.split('\n');
    const diffs: Array<{ original: string; polished: string }> = [];
    let inTable = false;

    for (const line of lines) {
      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        if (!inTable) {
          inTable = true;
          continue; // 跳过表头
        }
        // 跳过分隔行
        if (line.includes('---')) continue;

        const cells = line.split('|').filter(c => c.trim()).map(c => c.trim());
        if (cells.length >= 2) {
          diffs.push({ original: cells[0], polished: cells[1] });
        }
      } else {
        inTable = false;
      }
    }

    return diffs;
  }
}