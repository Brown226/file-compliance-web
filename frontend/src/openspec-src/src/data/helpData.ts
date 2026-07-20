/** 帮助中心静态数据 */

export interface TutorialItem {
  title: string
  description: string
  /** 呈现方式标签 */
  type: 'gif' | 'screenshot' | 'article'
  /** 缩略图路径（后续替换为实际资源） */
  thumbnail?: string
}

export interface TabCategory {
  key: string
  label: string
  tutorials: TutorialItem[]
}

export interface FaqItem {
  question: string
  answer: string
}

/** Tab 分类与教程内容 */
export const helpTabs: TabCategory[] = [
  {
    key: 'quickstart',
    label: '快速入门',
    tutorials: [
      {
        title: '注册与登录',
        description: '账号注册、邮箱登录流程',
        type: 'screenshot',
      },
      {
        title: '创建第一份文档',
        description: '新建文档向导（选择专业 + 业态标签）',
        type: 'gif',
      },
      {
        title: '认识编辑器界面',
        description: '编辑器各区域功能介绍（目录树、编辑区、AI 助手）',
        type: 'screenshot',
      },
      {
        title: '3 分钟生成设计说明',
        description: '端到端演示：从新建到 AI 生成完整文档',
        type: 'gif',
      },
    ],
  },
  {
    key: 'editing',
    label: '文档编辑',
    tutorials: [
      {
        title: '编辑章节内容',
        description: '章节的增删改、拖拽排序',
        type: 'gif',
      },
      {
        title: '使用目录导航',
        description: '文档目录树的使用方式',
        type: 'screenshot',
      },
      {
        title: '文档重命名与管理',
        description: '重命名、删除、搜索文档',
        type: 'screenshot',
      },
      {
        title: 'Markdown 语法支持',
        description: '支持的 Markdown 格式说明',
        type: 'article',
      },
    ],
  },
  {
    key: 'ai',
    label: 'AI 功能',
    tutorials: [
      {
        title: 'AI 智能生成章节',
        description: '如何让 AI 根据项目信息自动生成内容',
        type: 'gif',
      },
      {
        title: 'AI 助手对话',
        description: '使用右侧 AI 助手进行规范问答',
        type: 'gif',
      },
      {
        title: '知识库检索',
        description: '基于建筑规范知识库的 RAG 检索',
        type: 'screenshot',
      },
      {
        title: 'AI 改写与优化',
        description: '对已有内容进行 AI 润色和优化',
        type: 'gif',
      },
    ],
  },
  {
    key: 'template',
    label: '模板与导出',
    tutorials: [
      {
        title: '使用文档模板',
        description: '从模板创建文档、模板匹配逻辑',
        type: 'gif',
      },
      {
        title: '管理个人模板',
        description: '模板的增删改（企业版功能）',
        type: 'screenshot',
      },
      {
        title: '导出 Markdown',
        description: '将文档导出为 .md 文件',
        type: 'screenshot',
      },
      {
        title: '导入 AutoCAD',
        description: 'Mark2CAD：一键导入 CAD 施工图',
        type: 'gif',
      },
    ],
  },
  {
    key: 'account',
    label: '账户与设置',
    tutorials: [
      {
        title: '个人信息管理',
        description: '修改昵称、密码等',
        type: 'screenshot',
      },
      {
        title: '授权与许可证',
        description: '查看授权信息、企业版升级',
        type: 'screenshot',
      },
      {
        title: '标签管理',
        description: '专业标签和业态标签的配置',
        type: 'screenshot',
      },
    ],
  },
]

/** 常见问题 FAQ */
export const faqList: FaqItem[] = [
  {
    question: 'AI 生成的内容不准确怎么办？',
    answer: '可通过编辑器手动修改，或使用 AI 助手对话进行针对性调整。',
  },
  {
    question: '如何切换文档的专业和业态标签？',
    answer: '在编辑器的项目设置中修改。',
  },
  {
    question: 'CAD 插件连接失败怎么办？',
    answer: '确认 AutoCAD 已启动且插件已加载，检查本地端口。',
  },
  {
    question: '支持哪些 AutoCAD 版本？',
    answer: '目前支持 AutoCAD 2026。',
  },
  {
    question: '如何升级到企业版？',
    answer: '联系我们获取企业版授权许可证。',
  },
  {
    question: '文档数据存储在哪里？',
    answer: '存储在云端服务器，支持多设备访问。',
  },
  {
    question: '忘记密码怎么办？',
    answer: '目前请联系管理员重置（密码找回功能开发中）。',
  },
]
