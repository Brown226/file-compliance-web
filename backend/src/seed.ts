import prisma from './config/db';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

async function seed() {
  console.log('🌱 开始数据库初始化...');

  // 1. 创建部门结构（河北分公司）
  const deptRoot = await prisma.department.upsert({
    where: { id: 'dept-hebei' },
    update: {},
    create: { id: 'dept-hebei', name: '河北分公司' },
  });

  const deptList = [
    '分公司领导', '分公司副总工程师', '专家委员会', '综合办公室',
    '设计管理部', '人力资源部', '财务部', '党群工作部',
    '纪检监督部', '技术质量部', '档案信息中心', '工程部',
    '核工程所', '核电工艺所', '电力工程研究设计所', '电力所',
    '电气自动化所', '建筑结构所', '工程经济所',
  ];

  for (const name of deptList) {
    await prisma.department.upsert({
      where: { id: `dept-hebei-${name}` },
      update: {},
      create: { id: `dept-hebei-${name}`, name, parentId: deptRoot.id },
    });
  }

  // 2. 创建默认管理员用户
  const adminSalt = await bcrypt.genSalt(10);
  const adminHash = await bcrypt.hash('Admin@12345', adminSalt);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { passwordHash: adminHash, mustChangePassword: false },
    create: {
      username: 'admin',
      passwordHash: adminHash,
      name: '系统管理员',
      role: 'ADMIN',
      departmentId: null, // ADMIN 不归属于任何部门，拥有全局权限
      mustChangePassword: false, // 管理员密码已是强密码
    },
  });

  // 2.5 创建默认经理和用户（弱密码示例，首次登录需强制改密）
  const managerSalt = await bcrypt.genSalt(10);
  const managerHash = await bcrypt.hash('Manager@123', managerSalt);
  await prisma.user.upsert({
    where: { username: 'manager' },
    update: {},
    create: {
      username: 'manager',
      passwordHash: managerHash,
      name: '部门经理',
      role: 'MANAGER',
      departmentId: 'dept-hebei-技术质量部',
      mustChangePassword: true,
    },
  });

  const userSalt = await bcrypt.genSalt(10);
  const userHash = await bcrypt.hash('User@12345', userSalt);
  await prisma.user.upsert({
    where: { username: 'user' },
    update: {},
    create: {
      username: 'user',
      passwordHash: userHash,
      name: '普通用户',
      role: 'USER',
      departmentId: 'dept-hebei-核工程所',
      mustChangePassword: true,
    },
  });

  console.log('✅ 测试用户创建完成（manager/user 需首次登录改密）');

  // 3. 创建测试标准数据（暂无，标准清单由用户导入）
  const standards: Array<{ id: string; title: string; standardNo: string; standardName: string; version: string; standardStatus: 'CURRENT' | 'UPCOMING' | 'ABOLISHED'; isActive: boolean }> = [];

  for (const std of standards) {
    await prisma.standard.upsert({
      where: { id: std.id },
      update: {},
      create: std,
    });
  }

  // 5. 初始化 LLM 模型配置（从环境变量读取，未配置则使用占位符）
  const chatApiKey = process.env.LLM_CHAT_API_KEY || 'sk-placeholder-replace-in-management-ui';
  const chatApiBase = process.env.LLM_CHAT_API_BASE || 'https://sub2api.toioto.org/v1';
  const chatModel = process.env.LLM_CHAT_MODEL || 'gpt-5.4-mini';

  const embedApiKey = process.env.LLM_EMBED_API_KEY || 'ms-placeholder-replace-in-management-ui';
  const embedApiBase = process.env.LLM_EMBED_API_BASE || 'https://api-inference.modelscope.cn/v1';
  const embedModel = process.env.LLM_EMBED_MODEL || 'Qwen/Qwen3-Embedding-8B';

  // 5.1 对话模型
  await prisma.systemConfig.upsert({
    where: { key: 'llm_chat_model' },
    update: {},
    create: {
      key: 'llm_chat_model',
      value: {
        serviceType: 'openai',
        apiKey: chatApiKey,
        apiBaseUrl: chatApiBase,
        modelName: chatModel,
        maxTokens: 4096,
        temperature: 0.3,
        timeout: 120,
        enabled: true,
        rateLimit: 60,
        retryCount: 3,
      },
    },
  });

  // 5.2 OCR/多模态模型（复用对话模型）
  await prisma.systemConfig.upsert({
    where: { key: 'llm_ocr_model' },
    update: {},
    create: {
      key: 'llm_ocr_model',
      value: {
        serviceType: 'openai',
        apiKey: chatApiKey,
        apiBaseUrl: chatApiBase,
        modelName: chatModel,
        timeout: 180,
        enabled: true,
        rateLimit: 30,
        retryCount: 3,
        language: 'zh',
      },
    },
  });

  // 5.3 Embedding 向量化模型
  await prisma.systemConfig.upsert({
    where: { key: 'embedding_model' },
    update: {},
    create: {
      key: 'embedding_model',
      value: {
        serviceType: 'openai',
        apiKey: embedApiKey,
        apiBaseUrl: embedApiBase,
        modelName: embedModel,
        dimensions: 4096,
        batchSize: 20,
        timeout: 60,
        enabled: true,
      },
    },
  });

  // 5.4 Rerank 重排序模型（复用对话模型）
  await prisma.systemConfig.upsert({
    where: { key: 'reranker_model' },
    update: {},
    create: {
      key: 'reranker_model',
      value: {
        serviceType: 'openai',
        apiKey: chatApiKey,
        apiBaseUrl: chatApiBase,
        modelName: chatModel,
        topK: 8,
        timeout: 30,
        enabled: true,
      },
    },
  });

  // 8. 初始化审查规则数据（可二次定制修改）
  const defaultRules = [
    // ===== 文件命名规范 (NAMING) =====
    { ruleCode: 'NAME_001', name: '文件名含中文', category: 'NAMING', description: '文件名包含中文字符，应使用规范编码命名（项目编码-系统编码-序号格式）', severity: 'error', enabled: true, config: { regex: '[\u4e00-\u9fff]' } },
    { ruleCode: 'NAME_002', name: '文件名含空格', category: 'NAMING', description: '文件名包含空格，应使用连字符(-)替代或移除空格', severity: 'error', enabled: true, config: { regex: '\\s' } },
    { ruleCode: 'NAME_003', name: '文件名非法字符', category: 'NAMING', description: '文件名包含非法特殊字符，仅保留字母、数字、连字符(-)和括号()', severity: 'error', enabled: true, config: { regex: '[!@#$%^&+=\\[\\]{}|\\\\:;"<>,?/~`]' } },
    { ruleCode: 'NAME_004', name: '项目编码格式错误', category: 'NAMING', description: '项目编码格式错误。标准: 2字母+2数字+1字母+2数字+2字母，如 FJ24A00AC', severity: 'warning', enabled: true, config: { pattern: '^[A-Z]{2}\\d{2}[A-Z]\\d{2}[A-Z]{2}' } },
    { ruleCode: 'NAME_005', name: '系统编码格式错误', category: 'NAMING', description: '系统编码格式错误。标准: 3字母+2数字，如 JPS02', severity: 'warning', enabled: true, config: { pattern: '^[A-Z]{3}\\d{2}' } },
    { ruleCode: 'NAME_006', name: '图纸类型/版本格式错误', category: 'NAMING', description: '图纸类型标识或版本号格式不符合规范。标准格式: [项目编码]-[系统编码]-[类型标识]([版本号])', severity: 'warning', enabled: true },
    { ruleCode: 'NAME_007', name: '文档命名格式错误', category: 'NAMING', description: '文档文件命名格式不符合规范。标准: [项目编码]-[系统编码][文件类型][序号]', severity: 'warning', enabled: true },
    { ruleCode: 'NAME_008', name: '序号格式错误', category: 'NAMING', description: '序号格式错误，应为3位数字(001-999)', severity: 'warning', enabled: true },
    { ruleCode: 'NAME_009', name: '版本号格式错误', category: 'NAMING', description: '版本号格式错误，应为括号内单个大写字母，如(A)/(B)', severity: 'warning', enabled: true, config: { pattern: '^\\([A-Z]\\)$' } },
    { ruleCode: 'NAME_010', name: '不支持的扩展名', category: 'NAMING', description: '文件扩展名不支持，允许: pdf/doc/docx/xls/xlsx/dwg/txt', severity: 'error', enabled: true },

    // ===== 编码一致性 (ENCODING) =====
    { ruleCode: 'CODE_001', name: '页眉编码与文件名不一致', category: 'ENCODING', description: '页眉中的编码与文件名外部编码不一致', severity: 'error', enabled: true },
    { ruleCode: 'CODE_002', name: '页眉使用内部编码', category: 'ENCODING', description: '页眉使用了内部编码(2字母+14数字)，应使用外部编码', severity: 'error', enabled: true, config: { internalCodePattern: '[A-Z]{2}\\d{14}' } },
    { ruleCode: 'CODE_003', name: '页眉为空无编码', category: 'ENCODING', description: '页眉为空或无法识别编码，应添加外部编码', severity: 'warning', enabled: true },
    { ruleCode: 'CODE_004', name: '文件名无法提取外部编码', category: 'ENCODING', description: '无法从文件名中提取有效的外部编码，请检查文件名是否符合命名规范', severity: 'warning', enabled: true },
    { ruleCode: 'CODE_005', name: 'PDF页眉不可读', category: 'ENCODING', description: '无法读取PDF页眉内容，跳过编码一致性检查', severity: 'warning', enabled: true },
    { ruleCode: 'UNIT_001', name: '机组号不一致', category: 'ENCODING', description: '封面机组号不一致: 图册编号第7字符 vs DOC.NO第3字符必须一致', severity: 'error', enabled: true },
    { ruleCode: 'UNIT_002', name: '图册编号机组号提取失败', category: 'ENCODING', description: '无法从图册编号中提取机组号，请检查编号格式', severity: 'warning', enabled: true },
    { ruleCode: 'UNIT_003', name: 'DOC.NO机组号提取失败', category: 'ENCODING', description: '无法从DOC.NO中提取机组号，请检查DOC.NO格式', severity: 'warning', enabled: true },
    { ruleCode: 'UNIT_004', name: '封面缺少图册编号', category: 'ENCODING', description: '封面未检测到图册(文件)编号，无法进行机组号一致性检查', severity: 'warning', enabled: true },
    { ruleCode: 'UNIT_005', name: '封面缺少DOC.NO', category: 'ENCODING', description: '封面未检测到DOC.NO，无法进行机组号一致性检查', severity: 'warning', enabled: true },

    // ===== 封面属性 (ATTRIBUTE) =====
    { ruleCode: 'ATTR_001', name: '图册编号缺失', category: 'ATTRIBUTE', description: '封面未检测到图册(文件)编号，请确认是否已填写', severity: 'error', enabled: true },
    { ruleCode: 'ATTR_002', name: '版次格式错误', category: 'ATTRIBUTE', description: '版次格式错误，应为单个大写字母(A/B/C...)', severity: 'error', enabled: true, config: { pattern: '^[A-Z]$' } },
    { ruleCode: 'ATTR_004', name: '工程号缺失或格式错误', category: 'ATTRIBUTE', description: '封面工程号为空或格式错误，请填写正确的工程号', severity: 'error', enabled: true },
    { ruleCode: 'ATTR_005', name: '子项号缺失', category: 'ATTRIBUTE', description: '封面子项号/系统号为空，请确认是否已填写', severity: 'warning', enabled: true },
    { ruleCode: 'ATTR_006', name: '子项名称缺失', category: 'ATTRIBUTE', description: '封面子项/系统名称为空，请确认是否已填写', severity: 'warning', enabled: true },
    { ruleCode: 'ATTR_003', name: '状态代码非标准值', category: 'ATTRIBUTE', description: '状态代码非标准值。标准值: CFC/PRE/IFA/IFU/DES', severity: 'error', enabled: true, config: { statusCodes: ['CFC','PRE','IFA','IFU','DES'] } },
    { ruleCode: 'ATTR_007', name: '设计阶段非标准值', category: 'ATTRIBUTE', description: '设计阶段非标准值。标准值: 初步设计/施工图设计/竣工图设计/不分设计阶段', severity: 'warning', enabled: true, config: { designStages: ['初步设计','施工图设计','竣工图设计','不分设计阶段'] } },
    { ruleCode: 'ATTR_008', name: '专业非标准值', category: 'ATTRIBUTE', description: '专业非标准值。标准值: 综合/建筑/结构/给排水/电气/暖通/消防/工艺/热机', severity: 'warning', enabled: true, config: { disciplines: ['综合','建筑','结构','给排水','电气','暖通','消防','工艺','热机'] } },
    { ruleCode: 'ATTR_009', name: '图册名称缺失', category: 'ATTRIBUTE', description: '封面未检测到图册(文件)名称，请确认是否已填写', severity: 'warning', enabled: true },
    { ruleCode: 'ATTR_010', name: '册数不合理', category: 'ATTRIBUTE', description: '当前册数大于总册数，逻辑不合理', severity: 'error', enabled: true },

    // ===== 页眉检查 (HEADER) =====
    { ruleCode: 'HEADER_001', name: '页眉名称与封面不一致', category: 'HEADER', description: '页眉中的图册名称与封面填写的图册名称不一致', severity: 'error', enabled: true },
    { ruleCode: 'HEADER_002', name: '页眉内容为空', category: 'HEADER', description: '页面页眉内容为空，应包含图册名称和版次信息', severity: 'warning', enabled: true },

    // ===== 连续页码 (PAGE) =====
    { ruleCode: 'PAGE_001', name: '页码不连续', category: 'PAGE', description: 'PDF文件页码不连续递增，存在缺页或跳页', severity: 'error', enabled: true },
    { ruleCode: 'PAGE_003', name: '总页数与实际不符', category: 'PAGE', description: '页眉标记的总页数与实际文件页数不一致', severity: 'warning', enabled: true },

    // ===== 格式规范 (FORMAT) — 基于真实测试文件错误分析报告新增 =====
    { ruleCode: 'FORMAT_001', name: '封面必填字段缺失', category: 'FORMAT', description: '封面缺少必要字段(专业/工种/版次/状态/设计阶段/工程号等)，核电工程图册封面应包含完整属性信息', severity: 'error', enabled: true },
    { ruleCode: 'FORMAT_002', name: '目录表头不规范', category: 'FORMAT', description: '目录表头缺少必需列(序号/名称/版本/页数)。标准目录应包含[序号,文件编号,名称,版本,状态,页数]', severity: 'error', enabled: true },
    { ruleCode: 'FORMAT_003', name: '中英文混排缺空格', category: 'FORMAT', description: '英文/数字与中文之间缺少半角空格分隔(如 CEH物项编码 → CEH 物项编码)', severity: 'warning', enabled: true },
    { ruleCode: 'FORMAT_004', name: '引用列表格式不统一', category: 'FORMAT', description: '引用文件列表使用了非标准编号方式，应使用标准项目符号(●/■/◆/-)统一格式编排', severity: 'warning', enabled: true },
    { ruleCode: 'FORMAT_005', name: '表格非多级复合表头', category: 'FORMAT', description: '数据表格未使用公司规定的标准多级复合表头模板。电缆/设备清单应有系列、色标、起终点等独立列', severity: 'warning', enabled: true },

    // ===== 数据完整性 (COMPLETENESS) — 基于真实测试文件错误分析报告新增 =====
    { ruleCode: 'COMPL_001', name: '表格数据大面积空白', category: 'COMPLETENESS', description: '数据表格存在大量空白单元格(超过30%行不完整)。必填字段不允许留空', severity: 'error', enabled: true },
    { ruleCode: 'COMPL_002', name: '电缆路径数据不全', category: 'COMPLETENESS', description: '电缆/路径清单数据不完整，缺少起终点部件信息或路径节点序列(LVYE编码链路)', severity: 'warning', enabled: true },
    { ruleCode: 'COMPL_003', name: '变更标记缺失', category: 'COMPLETENESS', description: '修改范围非"初版"/"ALL"时，数据记录中未标注变更标记(NA/ADD/DEL/WBC/MOD)', severity: 'error', enabled: true },

    // ===== 一致性检查 (CONSISTENCY) — 基于真实测试文件错误分析报告新增 =====
    { ruleCode: 'CONSIST_001', name: '项目名称不一致', category: 'CONSISTENCY', description: '封面的项目名称可能包含不应有的机组号或多余修饰词，与正式核准名称不一致', severity: 'warning', enabled: true },
    { ruleCode: 'CONSIST_002', name: '目录编码与正文不符', category: 'CONSISTENCY', description: '目录中的文件编码在正文中无法找到匹配。需核对目录编码是否与实际文件一致', severity: 'error', enabled: true },

    // ===== 排版布局 (LAYOUT) — 基于真实测试文件错误分析报告新增 =====
    { ruleCode: 'LAYOUT_001', name: '长文本截断不当', category: 'LAYOUT', description: '标题/段落在不恰当的位置断词换行（如中文字中间被截断）', severity: 'info', enabled: true },

    // ===== 正文编码校验 (TYPO确定性) — 基于真实测试文件错误分析报告新增 =====
    { ruleCode: 'TYPO_001', name: '正文内可疑编码', category: 'TYPO', description: '文档内发现与文件名项目编码部分匹配但不完全一致的ID-code编码，可能是编码错误', severity: 'warning', enabled: true },
  ];

  for (const rule of defaultRules) {
    await prisma.reviewRule.upsert({
      where: { ruleCode: rule.ruleCode },
      update: {},
      create: rule as any,
    });
  }

  // 9. 初始化专业术语白名单（内置术语，审查时自动忽略）
  const terminologyWhitelist = [
    // 核安全术语
    { id: randomUUID(), term: '核岛', category: '核安全术语', aliases: 'NI,Nuclear Island', isBuiltin: true },
    { id: randomUUID(), term: '常规岛', category: '核安全术语', aliases: 'CI,Conventional Island', isBuiltin: true },
    { id: randomUUID(), term: '核电厂', category: '核安全术语', aliases: 'NPP,Nuclear Power Plant', isBuiltin: true },
    { id: randomUUID(), term: '反应堆', category: '核安全术语', aliases: 'Reactor', isBuiltin: true },
    { id: randomUUID(), term: '压力容器', category: '核安全术语', aliases: 'RPV,Reactor Pressure Vessel', isBuiltin: true },
    { id: randomUUID(), term: '蒸汽发生器', category: '核安全术语', aliases: 'SG,Steam Generator', isBuiltin: true },
    { id: randomUUID(), term: '汽轮机', category: '核安全术语', aliases: 'Turbine', isBuiltin: true },
    { id: randomUUID(), term: '主泵', category: '核安全术语', aliases: 'MCP,Main Coolant Pump', isBuiltin: true },
    { id: randomUUID(), term: '稳压器', category: '核安全术语', aliases: 'PRZ,Pressurizer', isBuiltin: true },
    { id: randomUUID(), term: '安全壳', category: '核安全术语', aliases: 'Containment', isBuiltin: true },

    // 设备术语
    { id: randomUUID(), term: '汽轮发电机', category: '设备术语', aliases: 'TG,Turbine Generator', isBuiltin: true },
    { id: randomUUID(), term: '变压器', category: '设备术语', aliases: 'Transformer', isBuiltin: true },
    { id: randomUUID(), term: '断路器', category: '设备术语', aliases: 'CB,Circuit Breaker', isBuiltin: true },
    { id: randomUUID(), term: '电动机', category: '设备术语', aliases: 'Motor,MOT', isBuiltin: true },
    { id: randomUUID(), term: '配电柜', category: '设备术语', aliases: 'Switchgear,MSB', isBuiltin: true },
    { id: randomUUID(), term: '控制棒驱动机构', category: '设备术语', aliases: 'CRDM,Control Rod Drive Mechanism', isBuiltin: true },
    { id: randomUUID(), term: '余热排出系统', category: '设备术语', aliases: 'RHRS,Residual Heat Removal System', isBuiltin: true },

    // 工艺术语
    { id: randomUUID(), term: '额定功率', category: '工艺术语', aliases: 'rated power', isBuiltin: true },
    { id: randomUUID(), term: '热工水力', category: '工艺术语', aliases: 'Thermal Hydraulics', isBuiltin: true },
    { id: randomUUID(), term: '电气贯穿件', category: '工艺术语', aliases: 'EP,Electrical Penetration', isBuiltin: true },
    { id: randomUUID(), term: '棒控系统', category: '工艺术语', aliases: 'RCS,Rod Control System', isBuiltin: true },
    { id: randomUUID(), term: '燃料组件', category: '工艺术语', aliases: 'Fuel Assembly,FA', isBuiltin: true },
    { id: randomUUID(), term: '控制棒组件', category: '工艺术语', aliases: 'Control Rod', isBuiltin: true },

    // 建筑术语
    { id: randomUUID(), term: '施工图', category: '建筑术语', aliases: 'Construction Drawing', isBuiltin: true },
    { id: randomUUID(), term: '建筑模数', category: '建筑术语', aliases: 'Building Module', isBuiltin: true },
    { id: randomUUID(), term: '抗震设防', category: '建筑术语', aliases: 'Seismic Fortification', isBuiltin: true },
    { id: randomUUID(), term: '防火分区', category: '建筑术语', aliases: 'Fire Compartment', isBuiltin: true },
    { id: randomUUID(), term: '疏散距离', category: '建筑术语', aliases: 'Evacuation Distance', isBuiltin: true },

    // 电气术语
    { id: randomUUID(), term: '物项编码', category: '电气术语', aliases: 'TAG,Tag Number', isBuiltin: true },
    { id: randomUUID(), term: '电缆清单', category: '电气术语', aliases: 'Cable List,CBL', isBuiltin: true },
    { id: randomUUID(), term: '电气设备清单', category: '电气术语', aliases: 'Equipment List,EDL', isBuiltin: true },
    { id: randomUUID(), term: '单线图', category: '电气术语', aliases: 'SLD,Single Line Diagram', isBuiltin: true },
    { id: randomUUID(), term: '接线图', category: '电气术语', aliases: 'Wiring Diagram', isBuiltin: true },
    { id: randomUUID(), term: '接地系统', category: '电气术语', aliases: 'Grounding System', isBuiltin: true },

    // 给排水术语
    { id: randomUUID(), term: '循环水系统', category: '给排水术语', aliases: 'CWS,Circulating Water System', isBuiltin: true },
    { id: randomUUID(), term: '消防系统', category: '给排水术语', aliases: 'Fire Protection System', isBuiltin: true },
    { id: randomUUID(), term: '生活用水', category: '给排水术语', aliases: 'Domestic Water', isBuiltin: true },

    // 暖通术语
    { id: randomUUID(), term: '暖通空调', category: '暖通术语', aliases: 'HVAC,Heating Ventilation Air Conditioning', isBuiltin: true },
    { id: randomUUID(), term: '通风系统', category: '暖通术语', aliases: 'Ventilation System', isBuiltin: true },
    { id: randomUUID(), term: '空调机组', category: '暖通术语', aliases: 'AHU,Air Handling Unit', isBuiltin: true },
  ];

  for (const term of terminologyWhitelist) {
    await prisma.terminologyWhitelist.upsert({
      where: { term_category: { term: term.term, category: term.category } },
      update: {},
      create: term,
    });
  }

  // 9. 初始化知识库根目录
  await prisma.knowledgeCategory.upsert({
    where: { id: 'knowledge-root' },
    update: {},
    create: {
      id: 'knowledge-root',
      name: '根目录',
      description: '知识库根目录',
      status: 'ACTIVE',
      isLeaf: false,
    },
  });
  console.log('✅ 知识库根目录初始化完成');

  // 10. 创建 V2.0 版本更新公告
  const adminUser = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (adminUser) {
    await prisma.systemAnnouncement.upsert({
      where: { id: 'ann-v2.0' },
      update: {},
      create: {
        id: 'ann-v2.0',
        title: '文件智能审查系统 V2.0 正式发布',
        content: `## 核审通 V2.0 版本更新

各位用户好！

文件智能审查系统 V2.0 已正式发布，本次更新包含多项重大功能升级。

### 架构升级
- **移除 MaxKB 依赖**：知识库 RAG 改用本地 pgvector 向量数据库，部署更轻量、运行更稳定
- **文档解析引擎重构**：移除 markitdown 引擎，PDF/DOCX/XLSX/PPTX 四种格式全部使用原生 Python 库直接解析，解析速度提升 30%
- **新增 PPTX 解析**：支持 PowerPoint 幻灯片文件的完整解析（文本、表格、图表、备注）

### 新增功能
- **OCR 识别服务**：支持扫描件 PDF 和图片的文字识别，通过视觉大模型完成
- **智能审查推荐**：上传文件后 AI 自动分析文档类型，智能推荐审查模式、审查点和核心目的
- **审查点按模式定制**：不同审查模式（一致性检查、错别字检查、以文审文等）使用专属的审查点和核心目的模板
- **知识库问答**：支持与指定知识库进行对话式问答，对话记录持久化保存
- **误报标记库**：支持标记审查问题为误报，系统自动学习避免重复误报

### 体验优化
- **任务进度实时推送**：WebSocket 实时推送审查进度，支持分片级别的进度展示
- **审查报告增强**：支持导出 Excel 和 Word 格式的审查报告
- **部门结构优化**：适配河北分公司组织架构，支持两级部门管理
- **界面全面升级**：Element Plus 2.9 + ECharts 5.6，数据可视化更丰富

### 部署说明
- 离线部署包体积优化至 4.6GB（含 OCR 服务）
- 支持 Docker Compose 一键部署
- Linux/Windows 双平台部署脚本

如有问题或建议，请联系系统管理员。

> 系统管理员团队
`,
        urgency: 'IMPORTANT',
        status: 'PUBLISHED',
        publishAt: new Date(),
        createdBy: adminUser.id,
      },
    });

    console.log('✅ V2.0 版本公告创建完成');
  }

  // 6. 合同规则阈值（核电工程合同默认值，可被管理面板覆盖）
  await prisma.systemConfig.upsert({
    where: { key: 'contract_rule_thresholds' },
    update: {},
    create: {
      key: 'contract_rule_thresholds',
      value: {
        payment_advance_ratio_max: 0.30,
        penalty_ratio_max: 0.20,
        warranty_months_min: 24,
        required_clauses: ['insurance', 'dispute'],
      },
    },
  });

  console.log('✅ 数据库初始化完成！');
  console.log('');
  console.log('📋 默认账号信息:');
  console.log('  管理员: admin / Admin@12345');
  console.log('  经理:   manager / Manager@123（首次登录需改密）');
  console.log('  用户:   user / User@12345（首次登录需改密）');
  console.log('');
  console.log('🤖 LLM 默认配置:');
  console.log('  对话模型: gpt-5.4-mini');
  console.log('  OCR/多模态: gpt-5.4-mini');
  console.log('  Embedding: Qwen/Qwen3-Embedding-8B (4096维)');
  console.log('  Rerank:   gpt-5.4-mini');
}

seed()
  .catch((e) => {
    console.error('❌ 数据库初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
