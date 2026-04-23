import prisma from './config/db';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

async function seed() {
  console.log('🌱 开始数据库初始化...');

  // 1. 创建默认部门
  const rootDept = await prisma.department.upsert({
    where: { id: 'dept-root' },
    update: {},
    create: { id: 'dept-root', name: '总公司' },
  });

  const rdDept = await prisma.department.upsert({
    where: { id: 'dept-rd' },
    update: {},
    create: { id: 'dept-rd', name: '研发部', parentId: rootDept.id },
  });

  const archDept = await prisma.department.upsert({
    where: { id: 'dept-arch' },
    update: {},
    create: { id: 'dept-arch', name: '建筑设计部', parentId: rootDept.id },
  });

  const structDept = await prisma.department.upsert({
    where: { id: 'dept-struct' },
    update: {},
    create: { id: 'dept-struct', name: '结构设计部', parentId: rootDept.id },
  });

  const mechDept = await prisma.department.upsert({
    where: { id: 'dept-mech' },
    update: {},
    create: { id: 'dept-mech', name: '机电设计部', parentId: rootDept.id },
  });

  // 2. 创建默认管理员用户
  const adminSalt = await bcrypt.genSalt(10);
  const adminHash = await bcrypt.hash('admin123', adminSalt);
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminHash,
      name: '系统管理员',
      role: 'ADMIN',
      departmentId: rootDept.id,
    },
  });

  // 3. 创建测试用户
  const managerSalt = await bcrypt.genSalt(10);
  const managerHash = await bcrypt.hash('123456', managerSalt);
  await prisma.user.upsert({
    where: { username: 'zhangsan' },
    update: {},
    create: {
      username: 'zhangsan',
      passwordHash: managerHash,
      name: '张三',
      role: 'MANAGER',
      departmentId: archDept.id,
    },
  });

  const userSalt = await bcrypt.genSalt(10);
  const userHash = await bcrypt.hash('123456', userSalt);
  await prisma.user.upsert({
    where: { username: 'lisi' },
    update: {},
    create: {
      username: 'lisi',
      passwordHash: userHash,
      name: '李四',
      role: 'USER',
      departmentId: archDept.id,
    },
  });

  // 4. 创建测试标准数据
  const standards = [
    { id: 'std-GB500162014', title: '建筑设计防火规范', standardNo: 'GB 50016-2014', standardName: '建筑设计防火规范', version: '2018年版', standardStatus: 'CURRENT' as const, isActive: true },
    { id: 'std-GB500092012', title: '建筑结构荷载规范', standardNo: 'GB 50009-2012', standardName: '建筑结构荷载规范', version: '2012年版', standardStatus: 'CURRENT' as const, isActive: true },
    { id: 'std-GB500112010', title: '建筑抗震设计规范', standardNo: 'GB 50011-2010', standardName: '建筑抗震设计规范', version: '2016年版', standardStatus: 'CURRENT' as const, isActive: true },
    { id: 'std-GBT500012017', title: '房屋建筑制图统一标准', standardNo: 'GB/T 50001-2017', standardName: '房屋建筑制图统一标准', version: '2017年版', standardStatus: 'CURRENT' as const, isActive: true },
    { id: 'std-GB503002013', title: '建筑工程施工质量验收统一标准', standardNo: 'GB 50300-2013', standardName: '建筑工程施工质量验收统一标准', version: '2013年版', standardStatus: 'CURRENT' as const, isActive: true },
    { id: 'std-GB500152019', title: '建筑给水排水设计标准', standardNo: 'GB 50015-2019', standardName: '建筑给水排水设计标准', version: '2019年版', standardStatus: 'CURRENT' as const, isActive: true },
    { id: 'std-JGJ162008', title: '民用建筑电气设计规范', standardNo: 'JGJ 16-2008', standardName: '民用建筑电气设计规范', version: '2008年版', standardStatus: 'CURRENT' as const, isActive: false },
    { id: 'std-naming-001', title: '工程文件命名规范', standardNo: '内部规范', standardName: '工程文件命名规范', version: 'V1.0', standardStatus: 'CURRENT' as const, isActive: true },
  ];

  for (const std of standards) {
    await prisma.standard.upsert({
      where: { id: std.id },
      update: {},
      create: std,
    });
  }

  // 5. 创建测试任务（带 standardId 和 TaskFile）
  const task1 = await prisma.task.upsert({
    where: { id: 'task-demo-1' },
    update: {},
    create: {
      id: 'task-demo-1',
      title: 'A项目一期建筑图纸审查',
      description: '对A项目一期全部建筑施工图进行合规性审查',
      status: 'COMPLETED',
      creatorId: admin.id,
      standardId: 'std-GB500162014',
    },
  });

  const task2 = await prisma.task.upsert({
    where: { id: 'task-demo-2' },
    update: {},
    create: {
      id: 'task-demo-2',
      title: 'B项目结构图纸审查',
      description: 'B项目结构专业施工图审查',
      status: 'PROCESSING',
      creatorId: admin.id,
      standardId: 'std-GB500092012',
    },
  });

  const task3 = await prisma.task.upsert({
    where: { id: 'task-demo-3' },
    update: {},
    create: {
      id: 'task-demo-3',
      title: 'C小区给排水设计审查',
      description: 'C小区给排水专业施工图审查',
      status: 'PENDING',
      creatorId: admin.id,
      standardId: 'std-GB500152019',
    },
  });

  const task4 = await prisma.task.upsert({
    where: { id: 'task-demo-4' },
    update: {},
    create: {
      id: 'task-demo-4',
      title: 'D商场暖通图纸审查',
      description: 'D商场暖通空调专业施工图审查',
      status: 'FAILED',
      creatorId: admin.id,
    },
  });

  // 6. 为已完成任务创建 TaskFile 和 TaskDetail
  // Task1 的文件
  await prisma.taskFile.upsert({
    where: { id: 'file-demo-1-1' },
    update: {},
    create: {
      id: 'file-demo-1-1',
      taskId: task1.id,
      fileName: 'A项目-建筑平面图.dwg',
      filePath: '/uploads/demo-arch-plan.dwg',
      fileSize: 2457600,
      fileType: 'dwg',
      errorCount: 2,
    },
  });

  await prisma.taskFile.upsert({
    where: { id: 'file-demo-1-2' },
    update: {},
    create: {
      id: 'file-demo-1-2',
      taskId: task1.id,
      fileName: 'A项目-防火设计说明.docx',
      filePath: '/uploads/demo-fire-design.docx',
      fileSize: 128000,
      fileType: 'docx',
      errorCount: 2,
    },
  });

  // Task1 的审查结果
  const existingDetails1 = await prisma.taskDetail.count({
    where: { taskId: task1.id },
  });

  if (existingDetails1 === 0) {
    await prisma.taskDetail.createMany({
      data: [
        {
          taskId: task1.id,
          fileId: 'file-demo-1-1',
          issueType: 'TYPO',
          ruleCode: null,
          severity: 'warning',
          originalText: '消仿通道',
          suggestedText: '消防通道',
          description: '存在错别字"消仿"，应改为"消防"。',
        },
        {
          taskId: task1.id,
          fileId: 'file-demo-1-1',
          issueType: 'VIOLATION',
          ruleCode: null,
          severity: 'error',
          originalText: 'M-1',
          suggestedText: 'FM甲-1',
          description: '防火门应标注耐火等级，违反 GB 50016-2014 第6.5.1条。',
        },
        {
          taskId: task1.id,
          fileId: 'file-demo-1-2',
          issueType: 'NAMING',
          ruleCode: 'NAME_001',
          severity: 'error',
          originalText: 'A项目-建筑平面图.dwg',
          suggestedText: 'FJ24A00AC-JPS02-001(A).dwg',
          description: '文件名包含中文字符"A项目-建筑平面图"，不符合命名规范。应使用项目编码-系统编码-序号(版本号)格式。',
        },
        {
          taskId: task1.id,
          fileId: 'file-demo-1-2',
          issueType: 'TYPO',
          ruleCode: null,
          severity: 'warning',
          originalText: '停泊车位',
          suggestedText: '机动车停车位',
          description: '用词不规范，建议修改为"机动车停车位"。',
        },
      ],
    });
  }

  // 7. 初始化 LLM 默认配置（硅基流动免费模型）
  await prisma.systemConfig.upsert({
    where: { key: 'llm_chat_model' },
    update: {},
    create: {
      key: 'llm_chat_model',
      value: {
        serviceType: 'siliconflow',
        apiKey: 'sk-oilujlprpzdbnphjaqcbvktfwvskabjascfwolsezpuxysmy',
        apiBaseUrl: 'https://api.siliconflow.cn/v1',
        modelName: 'Qwen/Qwen2.5-72B-Instruct',
        maxTokens: 4096,
        temperature: 0.3,
        timeout: 120,
        enabled: true,
        rateLimit: 60,
        retryCount: 3,
      },
    },
  });

  await prisma.systemConfig.upsert({
    where: { key: 'llm_ocr_model' },
    update: {},
    create: {
      key: 'llm_ocr_model',
      value: {
        serviceType: 'siliconflow',
        apiKey: 'sk-oilujlprpzdbnphjaqcbvktfwvskabjascfwolsezpuxysmy',
        apiBaseUrl: 'https://api.siliconflow.cn/v1',
        modelName: 'deepseek-ai/DeepSeek-OCR',
        timeout: 180,
        enabled: true,
        rateLimit: 30,
        retryCount: 3,
        language: 'zh',
      },
    },
  });

  // 7.1 初始化 Embedding 向量化模型配置（RAG 知识库核心）- 硅基流动 BAAI/bge-m3
  await prisma.systemConfig.upsert({
    where: { key: 'llm_embedding_model' },
    update: {},
    create: {
      key: 'llm_embedding_model',
      value: {
        serviceType: 'siliconflow',
        apiKey: 'sk-oilujlprpzdbnphjaqcbvktfwvskabjascfwolsezpuxysmy',
        apiBaseUrl: 'https://api.siliconflow.cn/v1',
        modelName: 'BAAI/bge-m3',
        dimensions: 1024,
        batchSize: 20,
        timeout: 60,
        enabled: true,
      },
    },
  });

  // 7.2 初始化 Rerank 重排序模型配置（RAG 检索增强，已启用）- 硅基流动 BAAI/bge-reranker-v2-m3
  await prisma.systemConfig.upsert({
    where: { key: 'llm_rerank_model' },
    update: {},
    create: {
      key: 'llm_rerank_model',
      value: {
        serviceType: 'siliconflow',
        apiKey: 'sk-oilujlprpzdbnphjaqcbvktfwvskabjascfwolsezpuxysmy',
        apiBaseUrl: 'https://api.siliconflow.cn/v1',
        modelName: 'BAAI/bge-reranker-v2-m3',
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
    { ruleCode: 'NAME_009', name: '版本号格式错误', category: 'NAMING', description: '版本号格式错误，应为括号内单个大写字母，如(A)/(B)', severity: 'warning', enabled: true, config: { pattern: '^\\([A-Z]\\)$' } },
    { ruleCode: 'NAME_010', name: '不支持的扩展名', category: 'NAMING', description: '文件扩展名不支持，允许: pdf/doc/docx/xls/xlsx/dwg/txt', severity: 'error', enabled: true },

    // ===== 编码一致性 (ENCODING) =====
    { ruleCode: 'CODE_001', name: '页眉编码与文件名不一致', category: 'ENCODING', description: '页眉中的编码与文件名外部编码不一致', severity: 'error', enabled: true },
    { ruleCode: 'CODE_002', name: '页眉使用内部编码', category: 'ENCODING', description: '页眉使用了内部编码(2字母+14数字)，应使用外部编码', severity: 'error', enabled: true, config: { internalPattern: '[A-Z]{2}\\d{14}' } },
    { ruleCode: 'CODE_003', name: '页眉为空无编码', category: 'ENCODING', description: '页眉为空或无法识别编码，应添加外部编码', severity: 'warning', enabled: true },
    { ruleCode: 'UNIT_001', name: '机组号不一致', category: 'ENCODING', description: '封面机组号不一致: 图册编号第7字符 vs DOC.NO第3字符必须一致', severity: 'error', enabled: true, config: { albumPosition: 7, docNoPosition: 3 } },

    // ===== 封面属性 (ATTRIBUTE) =====
    { ruleCode: 'ATTR_002', name: '版次格式错误', category: 'ATTRIBUTE', description: '版次格式错误，应为单个大写字母(A/B/C...)', severity: 'error', enabled: true, config: { pattern: '^[A-Z]$' } },
    { ruleCode: 'ATTR_003', name: '状态代码非标准值', category: 'ATTRIBUTE', description: '状态代码非标准值。标准值: CFC/PRE/IFA/IFU/DES', severity: 'error', enabled: true, config: { validValues: ['CFC','PRE','IFA','IFU','DES'] } },
    { ruleCode: 'ATTR_007', name: '设计阶段非标准值', category: 'ATTRIBUTE', description: '设计阶段非标准值。标准值: 初步设计/施工图设计/竣工图设计/不分设计阶段', severity: 'warning', enabled: true, config: { validValues: ['初步设计','施工图设计','竣工图设计','不分设计阶段'] } },
    { ruleCode: 'ATTR_008', name: '专业非标准值', category: 'ATTRIBUTE', description: '专业非标准值。标准值: 综合/建筑/结构/给排水/电气/暖通/消防/工艺/热机', severity: 'warning', enabled: true, config: { validValues: ['综合','建筑','结构','给排水','电气','暖通','消防','工艺','热机'] } },
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

  console.log('✅ 数据库初始化完成！');
  console.log('');
  console.log('📋 默认账号信息:');
  console.log('  管理员: admin / admin123');
  console.log('  主管:   zhangsan / 123456');
  console.log('  员工:   lisi / 123456');
  console.log('');
  console.log('🤖 LLM 默认配置（硅基流动免费模型）:');
  console.log('  对话模型: Qwen/Qwen2.5-72B-Instruct');
  console.log('  OCR模型:  deepseek-ai/DeepSeek-OCR');
  console.log('  Embedding: BAAI/bge-m3 (1024维)');
  console.log('  Rerank:   BAAI/bge-reranker-v2-m3');
}

seed()
  .catch((e) => {
    console.error('❌ 数据库初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
