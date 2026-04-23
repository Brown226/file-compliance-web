/**
 * 专业术语白名单服务
 *
 * 术语数据存储在数据库 terminology_whitelist 表中，
 * 启动时加载到内存 Set 以保证 O(1) 查找性能。
 * 支持管理员增删改，修改后自动刷新内存缓存。
 */

import prisma from '../config/db';

/** 术语条目（API 返回格式） */
export interface TerminologyEntry {
  id: string;
  term: string;
  category: string;
  aliases: string[];
  isBuiltin: boolean;
  createdBy?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 新增/编辑术语入参 */
export interface TerminologyInput {
  term: string;
  category: string;
  aliases?: string[];
  isBuiltin?: boolean;
  createdBy?: string;
}

/** 默认分类 */
export const DEFAULT_CATEGORIES = [
  '核安全术语',
  '设备术语',
  '工艺术语',
  '建筑术语',
  '电气术语',
  '自定义',
] as const;

/** 内置术语定义（用于 seed） */
const BUILT_IN_TERMS: Array<{ term: string; category: string; aliases: string[] }> = [
  // ===== 核安全术语 =====
  { term: '安全壳', category: '核安全术语', aliases: ['containment', '安全壳厂房'] },
  { term: '反应堆', category: '核安全术语', aliases: ['reactor', '堆'] },
  { term: '一回路', category: '核安全术语', aliases: ['一次侧', 'primary circuit', '主回路'] },
  { term: '二回路', category: '核安全术语', aliases: ['二次侧', 'secondary circuit'] },
  { term: '纵深防御', category: '核安全术语', aliases: ['defence in depth', '深度防御'] },
  { term: '冗余', category: '核安全术语', aliases: ['redundancy', '冗余设计'] },
  { term: '多样性', category: '核安全术语', aliases: ['diversity', '多样性设计'] },
  { term: '故障安全', category: '核安全术语', aliases: ['fail-safe', '失效安全'] },
  { term: '单一故障', category: '核安全术语', aliases: ['single failure', '单点故障'] },
  { term: '专设安全设施', category: '核安全术语', aliases: ['专设安全系统', 'ESF', 'engineered safety feature'] },
  { term: '应急堆芯冷却', category: '核安全术语', aliases: ['ECCS', 'emergency core cooling'] },
  { term: '安全注射', category: '核安全术语', aliases: ['安注', 'safety injection', 'SI'] },
  { term: '余热排出', category: '核安全术语', aliases: ['RHR', 'residual heat removal', '余热导出'] },
  { term: '安全壳喷淋', category: '核安全术语', aliases: ['喷淋', 'containment spray', 'CSS'] },
  { term: '安全级', category: '核安全术语', aliases: ['安全重要', 'safety class', '安全等级'] },
  { term: '核级', category: '核安全术语', aliases: ['nuclear grade', '核安全级'] },
  { term: '抗震', category: '核安全术语', aliases: ['seismic', '抗震设计', '抗地震'] },
  { term: '质保', category: '核安全术语', aliases: ['质量保证', 'QA', 'quality assurance'] },
  { term: '核安全文化', category: '核安全术语', aliases: ['nuclear safety culture'] },
  { term: '定期试验', category: '核安全术语', aliases: ['periodic test', '定期检验'] },
  { term: '在役检查', category: '核安全术语', aliases: ['ISI', 'in-service inspection'] },
  { term: '预防性维修', category: '核安全术语', aliases: ['PM', 'preventive maintenance'] },
  { term: '纠正性维修', category: '核安全术语', aliases: ['CM', 'corrective maintenance'] },
  { term: '大修', category: '核安全术语', aliases: ['outage', '检修'] },
  { term: '换料大修', category: '核安全术语', aliases: ['refueling outage'] },
  { term: '装料', category: '核安全术语', aliases: ['loading', '燃料装载'] },
  { term: '卸料', category: '核安全术语', aliases: ['unloading', '燃料卸载'] },
  { term: '临界', category: '核安全术语', aliases: ['critical', '临界状态'] },
  { term: '停堆深度', category: '核安全术语', aliases: ['shutdown margin', 'SDM'] },
  { term: '反应性', category: '核安全术语', aliases: ['reactivity'] },
  { term: '停堆', category: '核安全术语', aliases: ['shutdown', 'scram', '紧急停堆'] },
  { term: '跳堆', category: '核安全术语', aliases: ['reactor trip', '停堆保护'] },
  { term: '放射性', category: '核安全术语', aliases: ['radioactivity'] },
  { term: '剂量率', category: '核安全术语', aliases: ['dose rate', '辐射剂量率'] },
  { term: '辐射防护', category: '核安全术语', aliases: ['radiation protection', '放射防护'] },
  { term: '硼酸', category: '核安全术语', aliases: ['boric acid'] },
  { term: '慢化剂', category: '核安全术语', aliases: ['moderator'] },
  { term: '冷却剂', category: '核安全术语', aliases: ['coolant'] },
  { term: '核燃料', category: '核安全术语', aliases: ['nuclear fuel'] },
  { term: '乏燃料', category: '核安全术语', aliases: ['spent fuel', '废燃料'] },
  { term: '燃料水池', category: '核安全术语', aliases: ['fuel pool', '乏燃料水池', 'SFP'] },
  { term: '堆芯', category: '核安全术语', aliases: ['core', '反应堆堆芯'] },
  { term: '燃料组件', category: '核安全术语', aliases: ['fuel assembly', '燃料元件'] },
  { term: '控制棒', category: '核安全术语', aliases: ['control rod', '控制棒组件'] },
  { term: '并网', category: '核安全术语', aliases: ['grid connection', '并网运行'] },
  { term: '解列', category: '核安全术语', aliases: ['grid disconnection', '脱网'] },
  { term: '停机', category: '核安全术语', aliases: ['shutdown', '机组停运'] },
  { term: '容积控制系统', category: '核安全术语', aliases: ['CVCS', 'volume control system'] },

  // ===== 设备术语 =====
  { term: '蒸汽发生器', category: '设备术语', aliases: ['SG', 'steam generator', '蒸发器'] },
  { term: '稳压器', category: '设备术语', aliases: ['pressurizer', 'PRZ'] },
  { term: '主管道', category: '设备术语', aliases: ['main pipe', '主回路管道', 'RCS管道'] },
  { term: '主泵', category: '设备术语', aliases: ['RCP', 'reactor coolant pump', '冷却剂泵'] },
  { term: '汽轮机', category: '设备术语', aliases: ['turbine', '透平'] },
  { term: '凝汽器', category: '设备术语', aliases: ['condenser', '冷凝器'] },
  { term: '核岛', category: '设备术语', aliases: ['NI', 'nuclear island'] },
  { term: '常规岛', category: '设备术语', aliases: ['CI', 'conventional island'] },
  { term: '反应堆压力容器', category: '设备术语', aliases: ['RPV', 'reactor pressure vessel', '压力容器'] },
  { term: '反应堆冷却剂系统', category: '设备术语', aliases: ['RCS', 'reactor coolant system', '一回路系统'] },
  { term: '安注箱', category: '设备术语', aliases: ['accumulator', '蓄压箱', '安全注射箱'] },
  { term: '应急柴油机', category: '设备术语', aliases: ['EDG', 'emergency diesel generator'] },
  { term: '主控制室', category: '设备术语', aliases: ['MCR', 'main control room'] },
  { term: '安全阀', category: '设备术语', aliases: ['safety valve', '安全泄放阀'] },
  { term: '隔离阀', category: '设备术语', aliases: ['isolation valve'] },
  { term: '止回阀', category: '设备术语', aliases: ['check valve', '单向阀'] },
  { term: '辅助给水系统', category: '设备术语', aliases: ['AFWS', 'auxiliary feedwater system'] },
  { term: '高压加热器', category: '设备术语', aliases: ['HP heater', '高加'] },
  { term: '低压加热器', category: '设备术语', aliases: ['LP heater', '低加'] },
  { term: '除氧器', category: '设备术语', aliases: ['deaerator'] },
  { term: '汽水分离再热器', category: '设备术语', aliases: ['MSR', 'moisture separator reheater'] },

  // ===== 工艺术语 =====
  { term: 'RUNOUT', category: '工艺术语', aliases: ['run-out', '跑流量'] },
  { term: 'NPSH', category: '工艺术语', aliases: ['net positive suction head', '净正吸入压头'] },
  { term: '汽蚀余量', category: '工艺术语', aliases: ['cavitation margin', '有效汽蚀余量'] },
  { term: '热功率', category: '工艺术语', aliases: ['thermal power', '堆芯热功率'] },
  { term: '电功率', category: '工艺术语', aliases: ['electrical power', '电输出功率'] },
  { term: '满功率', category: '工艺术语', aliases: ['full power', '额定功率'] },
  { term: '额定功率', category: '工艺术语', aliases: ['rated power', '名义功率'] },
  { term: '热态功能试验', category: '工艺术语', aliases: ['HFT', 'hot functional test'] },
  { term: '冷态功能试验', category: '工艺术语', aliases: ['CFT', 'cold functional test'] },
  { term: '水压试验', category: '工艺术语', aliases: ['hydrostatic test', '压力试验'] },
  { term: '泄漏率', category: '工艺术语', aliases: ['leakage rate'] },
  { term: '安全壳密封性试验', category: '工艺术语', aliases: ['containment leak rate test', 'CLRT'] },
  { term: '氙效应', category: '工艺术语', aliases: ['xenon effect', '氙毒'] },
  { term: '碘坑', category: '工艺术语', aliases: ['iodine pit', '碘坑效应'] },
  { term: '燃耗', category: '工艺术语', aliases: ['burnup', '燃料燃耗'] },
  { term: '富集度', category: '工艺术语', aliases: ['enrichment', '铀富集度'] },
  { term: '硼稀释', category: '工艺术语', aliases: ['boron dilution'] },
  { term: '过冷度', category: '工艺术语', aliases: ['subcooling', '欠热度'] },
  { term: '饱和温度', category: '工艺术语', aliases: ['saturation temperature'] },
  { term: '给水', category: '工艺术语', aliases: ['feedwater'] },

  // ===== 建筑术语 =====
  { term: '核岛筏基', category: '建筑术语', aliases: ['nuclear island raft', 'NI筏基'] },
  { term: '安全壳穹顶', category: '建筑术语', aliases: ['containment dome', '穹顶'] },
  { term: '钢衬里', category: '建筑术语', aliases: ['steel liner', '衬里'] },
  { term: '预应力', category: '建筑术语', aliases: ['prestressed', '预应力混凝土'] },
  { term: '屏蔽墙', category: '建筑术语', aliases: ['shielding wall', '生物屏蔽'] },
  { term: '大体积混凝土', category: '建筑术语', aliases: ['mass concrete'] },
  { term: '预埋件', category: '建筑术语', aliases: ['embedded part'] },
  { term: '伸缩缝', category: '建筑术语', aliases: ['expansion joint'] },
  { term: '施工缝', category: '建筑术语', aliases: ['construction joint'] },

  // ===== 电气术语 =====
  { term: '应急母线', category: '电气术语', aliases: ['emergency bus', '应急配电母线'] },
  { term: '厂外电源', category: '电气术语', aliases: ['offsite power', '外部电源'] },
  { term: '不间断电源', category: '电气术语', aliases: ['UPS', 'uninterruptible power supply'] },
  { term: '反应堆保护系统', category: '电气术语', aliases: ['RPS', 'reactor protection system'] },
  { term: '四取二', category: '电气术语', aliases: ['2-out-of-4', '四取二逻辑'] },
  { term: '三取二', category: '电气术语', aliases: ['2-out-of-3', '三取二逻辑'] },
  { term: '仪控系统', category: '电气术语', aliases: ['I&C system', 'instrumentation and control'] },
  { term: 'DCS', category: '电气术语', aliases: ['distributed control system', '分散控制系统'] },
  { term: '源量程', category: '电气术语', aliases: ['source range', 'SR'] },
  { term: '中间量程', category: '电气术语', aliases: ['intermediate range', 'IR'] },
  { term: '功率量程', category: '电气术语', aliases: ['power range', 'PR'] },
  { term: '联锁', category: '电气术语', aliases: ['interlock', '闭锁'] },
  { term: '旁通', category: '电气术语', aliases: ['bypass', '旁路'] },
  { term: '电气贯穿件', category: '电气术语', aliases: ['electrical penetration', 'EPA'] },
];

/** 全局内存查找 Set */
let termLookupSet: Set<string> = new Set();
/** 是否已初始化 */
let initialized = false;

/** 构建内存查找 Set */
function buildLookupSet(entries: Array<{ term: string; aliases: string | null }>): Set<string> {
  const set = new Set<string>();
  for (const entry of entries) {
    set.add(entry.term);
    set.add(entry.term.toLowerCase());
    if (entry.aliases) {
      const aliasList = entry.aliases.split(',').map(a => a.trim()).filter(Boolean);
      for (const alias of aliasList) {
        set.add(alias);
        set.add(alias.toLowerCase());
      }
    }
  }
  return set;
}

/** 从数据库加载并刷新内存缓存 */
async function refreshCache(): Promise<void> {
  const rows = await prisma.terminologyWhitelist.findMany({ select: { term: true, aliases: true } });
  termLookupSet = buildLookupSet(rows);
  initialized = true;
}

/**
 * 专业术语白名单服务
 * 所有方法为静态方法，与项目风格一致
 */
export class TerminologyService {
  /** 被过滤的术语记录（用于审计） */
  private static filteredLog: Array<{ term: string; issueType: string; timestamp: number }> = [];

  /**
   * 初始化：从数据库加载术语到内存缓存
   * 如果数据库为空，自动 seed 内置术语
   */
  static async initialize(): Promise<void> {
    const count = await prisma.terminologyWhitelist.count();
    if (count === 0) {
      await TerminologyService.seedBuiltinTerms();
    }
    await refreshCache();
    console.log(`[TerminologyService] 已加载 ${termLookupSet.size} 个术语条目到内存缓存`);
  }

  /** Seed 内置术语到数据库 */
  static async seedBuiltinTerms(): Promise<number> {
    const data = BUILT_IN_TERMS.map(t => ({
      term: t.term,
      category: t.category,
      aliases: t.aliases.join(','),
      isBuiltin: true,
    }));

    let created = 0;
    for (const item of data) {
      try {
        await prisma.terminologyWhitelist.upsert({
          where: { term_category: { term: item.term, category: item.category } },
          update: { aliases: item.aliases, isBuiltin: true },
          create: item,
        });
        created++;
      } catch {
        // 忽略重复
      }
    }
    console.log(`[TerminologyService] 已 seed ${created} 个内置术语`);
    return created;
  }

  /**
   * 检查一个词是否在术语白名单中
   * 不区分大小写（对英文术语），支持别名匹配
   */
  static isInTerminology(term: string): boolean {
    if (!term || !term.trim()) return false;
    if (!initialized) {
      console.warn('[TerminologyService] 未初始化，术语匹配不可用');
      return false;
    }
    if (termLookupSet.has(term)) return true;
    if (termLookupSet.has(term.toLowerCase())) return true;
    return false;
  }

  /**
   * 从错别字检查结果中过滤掉专业术语
   */
  static filterTerminologyIssues(text: string, issues: any[]): any[] {
    if (!issues || issues.length === 0) return issues;
    if (!initialized) return issues;

    return issues.filter((issue) => {
      const orig = issue.originalText || '';
      const suggested = issue.suggestedText || '';

      if (TerminologyService.isInTerminology(orig)) {
        TerminologyService.filteredLog.push({ term: orig, issueType: issue.issueType || 'UNKNOWN', timestamp: Date.now() });
        return false;
      }

      if (TerminologyService.isInTerminology(suggested) && TerminologyService.isInTerminology(orig)) {
        TerminologyService.filteredLog.push({ term: `${orig} → ${suggested}`, issueType: issue.issueType || 'UNKNOWN', timestamp: Date.now() });
        return false;
      }

      return true;
    });
  }

  // ===== CRUD 方法 =====

  /** 查询术语列表（分页 + 搜索） */
  static async listTerms(params: {
    query?: string;
    category?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ total: number; terms: TerminologyEntry[] }> {
    const { query, category, page = 1, pageSize = 50 } = params;
    const where: any = {};
    if (category) where.category = category;
    if (query) {
      where.OR = [
        { term: { contains: query, mode: 'insensitive' } },
        { aliases: { contains: query, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.terminologyWhitelist.findMany({
        where,
        orderBy: [{ category: 'asc' }, { term: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.terminologyWhitelist.count({ where }),
    ]);

    return {
      total,
      terms: rows.map(r => ({
        id: r.id,
        term: r.term,
        category: r.category,
        aliases: r.aliases ? r.aliases.split(',').map(a => a.trim()).filter(Boolean) : [],
        isBuiltin: r.isBuiltin,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  }

  /** 获取分类列表（含各分类数量） */
  static async getCategories(): Promise<Array<{ category: string; count: number }>> {
    const groups = await prisma.terminologyWhitelist.groupBy({
      by: ['category'],
      _count: { category: true },
      orderBy: { category: 'asc' },
    });
    return groups.map(g => ({ category: g.category, count: g._count.category }));
  }

  /** 新增术语 */
  static async addTerm(input: TerminologyInput): Promise<TerminologyEntry> {
    const row = await prisma.terminologyWhitelist.create({
      data: {
        term: input.term.trim(),
        category: input.category,
        aliases: input.aliases?.join(',') || null,
        isBuiltin: input.isBuiltin || false,
        createdBy: input.createdBy || null,
      },
    });
    await refreshCache();
    return {
      id: row.id,
      term: row.term,
      category: row.category,
      aliases: row.aliases ? row.aliases.split(',').map(a => a.trim()).filter(Boolean) : [],
      isBuiltin: row.isBuiltin,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** 更新术语 */
  static async updateTerm(id: string, input: Partial<TerminologyInput>): Promise<TerminologyEntry> {
    const data: any = {};
    if (input.term !== undefined) data.term = input.term.trim();
    if (input.category !== undefined) data.category = input.category;
    if (input.aliases !== undefined) data.aliases = input.aliases.join(',');

    const row = await prisma.terminologyWhitelist.update({
      where: { id },
      data,
    });
    await refreshCache();
    return {
      id: row.id,
      term: row.term,
      category: row.category,
      aliases: row.aliases ? row.aliases.split(',').map(a => a.trim()).filter(Boolean) : [],
      isBuiltin: row.isBuiltin,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** 删除术语 */
  static async deleteTerm(id: string): Promise<void> {
    await prisma.terminologyWhitelist.delete({ where: { id } });
    await refreshCache();
  }

  /** 批量新增术语 */
  static async batchAddTerms(items: TerminologyInput[]): Promise<{ created: number; skipped: number }> {
    let created = 0;
    let skipped = 0;
    for (const item of items) {
      try {
        await prisma.terminologyWhitelist.create({
          data: {
            term: item.term.trim(),
            category: item.category,
            aliases: item.aliases?.join(',') || null,
            isBuiltin: item.isBuiltin || false,
            createdBy: item.createdBy || null,
          },
        });
        created++;
      } catch {
        skipped++;
      }
    }
    await refreshCache();
    return { created, skipped };
  }

  /** 获取术语总数 */
  static async getTermCount(): Promise<number> {
    return prisma.terminologyWhitelist.count();
  }

  /** 获取被过滤的术语审计日志 */
  static getFilteredLog(): Array<{ term: string; issueType: string; timestamp: number }> {
    return [...TerminologyService.filteredLog];
  }

  /** 清空审计日志 */
  static clearFilteredLog(): void {
    TerminologyService.filteredLog = [];
  }
}
