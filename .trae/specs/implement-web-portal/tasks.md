# Tasks
- [ ] Task 1: 初始化 Web 框架与基础布局：搭建 Vue 3 + TypeScript + Vite 项目，配置企业级 UI 组件库（推荐 Element Plus 或 Ant Design Vue），完成经典的左侧导航栏（工作台、新建任务、任务历史、标准库）和顶部通栏布局。
  - [ ] SubTask 1.1: 创建项目基础脚手架，配置路由（vue-router）和状态管理（Pinia/Pinia-Plugin-Persistedstate）。
  - [ ] SubTask 1.2: 设计并实现 `Layout` 组件，包含侧边栏（`Sidebar`）、顶部栏（`Header`）和主内容区（`Main`）。
- [ ] Task 2: 实现“新建审查任务”页面：开发一个独立的页面用于大文件/批量 DWG 图纸的上传，以及审查参数的配置。
  - [ ] SubTask 2.1: 集成支持拖拽的上传组件（Upload），支持多文件选择，并在前端展示已选文件列表及其大小。
  - [ ] SubTask 2.2: 在上传区域下方/右侧添加表单（Form），允许用户选择适用的“审查标准”（如下拉选择框）。
  - [ ] SubTask 2.3: 添加“开始审查”按钮，模拟提交逻辑（Mock API），并在成功后跳转至“任务列表”页。
- [ ] Task 3: 实现“审查任务列表”页面：开发一个用于查看所有历史审查任务的记录表，支持基础的按状态和日期过滤。
  - [ ] SubTask 3.1: 顶部添加过滤条件栏（日期选择器 DatePicker，状态下拉框 Select）。
  - [ ] SubTask 3.2: 渲染数据表格（Table），展示任务名称/ID、总文件数、上传时间、当前状态（排队中/审查中/已完成/失败）以及操作列（查看结果、导出 Excel）。
- [ ] Task 4: 实现“审查结果详情”页面（核心界面）：采用左右分栏布局展示批量文件及其具体的错误条目，并实现 CAD 定位交互。
  - [ ] SubTask 4.1: 左侧面板实现一个可滚动的文件列表（List/Tree），展示该批次任务中的所有 DWG 文件名，并附带错误数量标记。
  - [ ] SubTask 4.2: 右侧面板实现错误明细列表或卡片（Cards/Table），展示选中文件内的错误详情（错误类型、原文本、违反规范说明等）。
  - [ ] SubTask 4.3: 为每条错误实现“在 CAD 中定位”按钮，点击后通过浏览器 Clipboard API 将 `cad_handle_id` 复制到剪贴板，并弹出 Toast 提示。
- [ ] Task 5: 实现“企业标准规范库”管理页面：开发用于维护标准条目和字典数据的 CRUD 界面。
  - [ ] SubTask 5.1: 渲染带有分页的数据表格（Table），展示标准号、规范内容、版本等字段。
  - [ ] SubTask 5.2: 提供“新增”、“编辑”、“删除”按钮及其对应的表单弹窗（Dialog/Modal）。
  - [ ] SubTask 5.3: 顶部操作栏提供“Excel 批量导入”按钮（结合 Upload 组件模拟导入）和“导出模板”按钮。

# Task Dependencies
- [Task 2] depends on [Task 1]
- [Task 3] depends on [Task 1]
- [Task 4] depends on [Task 3]
- [Task 5] depends on [Task 1]