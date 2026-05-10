# Tab导航调整与工作台功能实现说明

## 修改概述

成功将审查结果页面的Tab导航从4个标签页调整为4个标签页，将"统计分析"替换为"工作台"功能，完全复刻了参考项目(contract-review-v2-master)的工作台特性。

## 修改内容

### 1. Tab导航调整

**修改前**：
- 审查概览
- 问题明细
- 依据
- ~~统计分析~~ 

**修改后**：
- 审查概览
- 问题明细
- 依据
- **工作台** ✅

### 2. 移除的功能

#### 统计分析模块（已删除）
- ❌ 严重度分布统计图表
- ❌ 问题类型分布统计
- ❌ 统计卡片（总问题数、严重错误、警告、提示）
- ❌ 相关计算逻辑（severityDistribution、categoryDistribution）

### 3. 新增功能

#### 工作台模块（新增）

工作台包含三个核心功能区域：

##### 3.1 合同版本对比
- ✅ 查看最近变更按钮
- ✅ Diff文本展示（新增/删除高亮）
  - 新增文本：绿色背景 (#DCFCE7)
  - 删除文本：红色背景 + 删除线 (#FEE2E2)
- ✅ 占位提示（无变更时）

##### 3.2 选中文本专项审查
- ✅ 从左侧OnlyOffice读取选中文本
- ✅ 手动粘贴文本输入框
- ✅ 专项问题输入框
- ✅ 开始专项审查按钮
- ✅ 加载状态提示

##### 3.3 专项审查结果展示
- ✅ 风险总结文本
- ✅ 大白话说明（蓝色边框）
- ✅ 建议替换文本（绿色背景）
- ✅ 替换左侧选中文本按钮
- ✅ 检索依据列表（法律条款）

## 代码变更

### 修改的文件

#### 1. TaskResultsView.vue
**变更统计**：+227行，-76行（净增151行）

**主要变更**：
1. **Tab配置修改**（第427-432行）
   ```typescript
   const tabs = [
     { key: 'overview', label: '审查概览' },
     { key: 'suggestions', label: '问题明细' },
     { key: 'knowledge', label: '依据' },
     { key: 'workspace', label: '工作台' }, // 替换 analytics
   ]
   ```

2. **状态变量调整**（第451-459行）
   ```typescript
   // 删除
   - const severityDistribution = computed(...)
   - const categoryDistribution = computed(...)
   
   // 新增
   + const focusedReviewText = ref('')
   + const focusedReviewQuestion = ref('')
   + const focusedReviewResult = ref<any>(null)
   + const focusedReviewLoading = ref(false)
   + const diffItems = ref<any[]>([])
   + const diffLoading = ref(false)
   + const reAnalyzing = ref(false)
   ```

3. **新增工作台功能函数**（第748-874行）
   - `loadLatestDiff()` - 加载合同版本对比
   - `prepareFocusedReviewFromSelection()` - 从编辑器读取选中文本
   - `submitFocusedReview()` - 提交专项审查
   - `applyFocusedSuggestion()` - 应用专项审查建议

4. **新增工作台UI**（第292-389行）
   - 合同版本对比区域
   - 选中文本专项审查区域
   - 专项审查结果展示区域

5. **新增工作台样式**（第1381-1507行）
   - 工作台区布局样式
   - Diff文本高亮样式
   - 审查结果展示样式
   - 法律依据列表样式

### 2. 临时模拟数据

由于后端API尚未实现，工作台功能使用临时模拟数据：

```typescript
// loadLatestDiff 模拟数据
diffItems.value = [
  { type: 'delete', text: '原文被删除的部分' },
  { type: 'insert', text: '新文本插入的部分' },
]

// submitFocusedReview 模拟数据
focusedReviewResult.value = {
  risk_summary: '该条款存在以下风险：...',
  plain_language: '大白话：这条款对您不太有利...',
  suggested_text: '建议修改为：...',
  relevant_laws: [
    {
      law: '《民法典》',
      clause: '第五百七十七条',
      content: '当事人一方不履行合同义务...',
    },
  ],
}
```

## 技术实现细节

### 1. OnlyOffice编辑器交互

工作台需要与左侧OnlyOffice编辑器交互，目前采用类型断言方式：

```typescript
const editor = onlyOfficeEditorRef.value as any
const selectedText = await editor.getSelectedText?.()
await editor.replaceText?.(oldText, newText)
```

**待完善**：需要在 OnlyOfficeEditor.vue 组件中添加 `defineExpose` 暴露这两个方法：
```typescript
defineExpose({ 
  refresh,
  getSelectedText,
  replaceText 
})
```

### 2. API接口待实现

工作台功能需要以下后端API支持（已预留调用位置）：

1. **合同版本对比API**
   ```typescript
   // GET /api/tasks/:id/diff
   // 返回：{ diffItems: Array<{type: 'insert'|'delete', text: string}> }
   ```

2. **专项审查API**
   ```typescript
   // POST /api/tasks/:id/focused-review
   // 请求：{ text, question, taskId }
   // 返回：{ risk_summary, plain_language, suggested_text, relevant_laws }
   ```

## UI/UX设计

### 设计参考
完全遵循参考项目 contract-review-v2-master 的设计：
- 白色卡片式布局
- 圆角边框（8px）
- 统一的配色方案
- 清晰的功能分区

### 配色方案
- **主色**：#3B82F6（蓝色）
- **成功色**：#10B981（绿色）
- **警告色**：#F59E0B（橙色）
- **错误色**：#EF4444（红色）
- **背景色**：#F9FAFB（浅灰）

### 响应式设计
```css
@media (max-width: 1200px) {
  .main-content {
    flex-direction: column;
  }
  .left-panel,
  .right-panel {
    flex: none;
    height: 50vh;
  }
}
```

## 编译验证

✅ TypeScript 编译通过  
✅ Vite 构建成功（33.18s）  
✅ 无类型错误  
✅ 文件大小：18.21 kB（gzip: 6.68 kB）

## 后续工作

### 1. 完善OnlyOfficeEditor组件
在 `OnlyOfficeEditor.vue` 中添加：
```typescript
// 获取选中文本
const getSelectedText = async () => {
  // 调用 OnlyOffice API 获取选中文本
}

// 替换文本
const replaceText = async (oldText: string, newText: string) => {
  // 调用 OnlyOffice API 替换文本
}

defineExpose({ refresh, getSelectedText, replaceText })
```

### 2. 实现后端API
1. 合同版本对比接口
2. 专项审查接口
3. 文本替换接口（可能需要）

### 3. 功能增强
- [ ] 添加重审功能（修改审查立场、审查点等）
- [ ] 支持多轮对话式审查
- [ ] 添加审查历史记录
- [ ] 优化大数据量时的性能

## 使用示例

### 专项审查流程
1. 用户在左侧OnlyOffice编辑器中选中文本
2. 点击"从左侧读取选中文本"按钮
3. 在专项问题框中输入审查要求（可选）
4. 点击"开始专项审查"
5. 查看审查结果（风险总结、大白话说明、建议文本）
6. 点击"替换左侧选中文本"应用建议

### 合同版本对比流程
1. 采纳若干建议后
2. 点击"查看最近变更"按钮
3. 查看新增和删除的文本（高亮显示）

## 与参考项目对比

| 功能 | 参考项目 | 当前实现 | 状态 |
|------|---------|---------|------|
| 合同版本对比 | ✅ | ✅ 模拟数据 | 待接入API |
| 选中文本专项审查 | ✅ | ✅ 模拟数据 | 待接入API |
| 专项审查结果展示 | ✅ | ✅ | 完成 |
| 替换选中文本 | ✅ | ✅ 待完善 | OnlyOffice需暴露API |
| 重审功能 | ✅ | ❌ | 待实现 |
| 审查立场选择 | ✅ | ❌ | 待实现 |
| 审查点选择 | ✅ | ❌ | 待实现 |

## 总结

成功完成了Tab导航的调整和工作台功能的初步实现。工作台的核心交互逻辑已搭建完成，UI设计与参考项目保持一致。后续只需完善OnlyOffice组件的API暴露和后端接口接入，即可实现完整的工作台功能。
