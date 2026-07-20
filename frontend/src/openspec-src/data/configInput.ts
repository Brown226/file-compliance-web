
// 参考资料排序
export const referenceSort = [
  {name:'总院说明模板',sort:1, weight:0},
  {name:'分院说明模板',sort:2, weight:0},
  {name:'院历史项目',sort:3, weight:0},
]

// 配置参数
export const configParams = [
  // {name:"文档生成要求",desc:"根据已配置的关键信息、目录大纲，生成对应的段落。"},
  {name:"任务描述",type:'query',desc:"生成项目配置内容，包含项目基本信息、地理位置、建设规模、功能分区等。"},
  // {name:"适用要求",desc:"内容准确、专业、符合建筑设计规范，语言简洁明了、文字正式。"},
  {name:"特殊要求",type:'require',desc:"项目为商业综合体，包含购物中心、写字楼和酒店，中方与海外建筑师合作设计。"},
]