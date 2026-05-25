<template>
  <div class="review-entry-page">
    <div v-if="!selectedModule" class="module-step-card">
      <h3 class="module-title">选择审查模块</h3>
      <p class="module-desc">不同模块对应不同的审查策略和配置,选择后将自动加载对应的审查项。</p>

      <div class="module-grid">
        <button
          v-for="item in modules"
          :key="item.id"
          type="button"
          class="module-item"
          :class="{ 'is-selected': selectedModule === item.id }"
          :data-module="item.id"
          @click="selectModule(item.id)"
        >
          <span class="module-icon-emoji">{{ item.title.split(' ')[0] }}</span>
          <div class="module-item-title">{{ item.title.substring(item.title.indexOf(' ') + 1) }}</div>
          <div class="module-item-desc">{{ item.desc }}</div>
          <div class="module-item-scenario">{{ item.scenario.replace('适用：', '') }}</div>
        </button>
      </div>
    </div>

    <div v-else-if="selectedModule" class="module-selected-bar">
      <div class="selected-info">
        <span class="selected-label">已选模块</span>
        <span class="selected-module-name">{{ selectedModuleLabel }}</span>
      </div>
      <div class="selected-actions">
        <el-button text type="primary" @click="selectedModule = ''">
          <el-icon><RefreshLeft /></el-icon>
          重新选择
        </el-button>
      </div>
    </div>

    <SmartReviewLegacy v-if="selectedModule && selectedModule !== 'SELF_CHECK'" />
    <SelfCheck v-if="selectedModule === 'SELF_CHECK'" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { RefreshLeft } from '@element-plus/icons-vue'
import SmartReviewLegacy from './SmartReview.vue'
import SelfCheck from './SelfCheck/index.vue'

type ModuleId = 'LIBRARY' | 'CONSISTENCY' | 'PROOFREAD' | 'RULE_ONLY' | 'MULTIMODAL' | 'DOC_REVIEW' | 'SELF_CHECK'

const selectedModule = ref<ModuleId | ''>('')

const modules: Array<{ id: ModuleId; title: string; desc: string; scenario: string }> = [
  {
    id: 'LIBRARY',
    title: '📚 以库审文',
    desc: '基于知识库和标准库进行综合合规审查，AI + 规则引擎双重检查，覆盖面最全',
    scenario: '适用：首次审查、合规性检查、标准符合性验证（最常用）'
  },
  {
    id: 'DOC_REVIEW',
    title: '📄 以文审文',
    desc: '将待审文件与参照文件(模板/旧版/标准)逐项比对，AI 语义级分析差异与遗漏',
    scenario: '适用：合同vs模板核对、新版vs旧版变更审查、投标文件vs招标要求对照'
  },
  {
    id: 'CONSISTENCY',
    title: '🔗 一致性审查',
    desc: '检查多份文件之间或同一文件内部的数据/参数是否自洽（数值精确比对，非语义比对）',
    scenario: '适用：总图与分图参数核对、文档前后数据矛盾、BOM表跨表校验'
  },
  {
    id: 'PROOFREAD',
    title: '✏️ 基础校对',
    desc: '错别字、语病、标点、术语规范等文字层面检查，轻量快速',
    scenario: '适用：终稿校对、发布前文字把关、格式规范化检查'
  },
  {
    id: 'RULE_ONLY',
    title: '📋 规则库审查',
    desc: '仅执行预定义规则检查（命名/编码/格式/页码等），不调用 AI，速度最快',
    scenario: '适用：批量格式检查、快速初筛、无需AI的纯规则场景'
  },
  {
    id: 'SELF_CHECK',
    title: '✅ 标准引用自检',
    desc: '提取设计文件中引用的标准规范，与标准库逐条比对，检查编号/名称/版本/废止状态',
    scenario: '适用：设计文件标准引用核查、规范清单校对、废止标准排查'
  },
  {
    id: 'MULTIMODAL',
    title: '🖼️ 多模态识别',
    desc: '针对含图纸(DWG)、表格、公式的结构化内容进行专项识别与审查',
    scenario: '适用：工程设计图纸审核、带复杂表格的说明书、含公式计算书'
  },
]

const selectedModuleLabel = computed(() => modules.find(m => m.id === selectedModule.value)?.title ?? '')

const selectModule = (id: ModuleId) => {
  selectedModule.value = id
  sessionStorage.setItem('smartReview.entryModule', id)
}
</script>

<style scoped>
.review-entry-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ===== 容器卡片 ===== */
.module-step-card {
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  padding: 32px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.03);
}

/* ===== 标题区域 ===== */
.module-title {
  margin: 0 0 8px 0;
  font-size: 24px;
  font-weight: 700;
  color: #1e293b;
  letter-spacing: -0.02em;
}

.module-desc {
  margin: 0 0 28px 0;
  color: #64748b;
  font-size: 15px;
  line-height: 1.6;
}

/* ===== 网格布局 ===== */
.module-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

/* ===== 模块卡片(基础样式)===== */
.module-item {
  position: relative;
  text-align: left;
  border: 2px solid #e2e8f0;
  border-radius: 14px;
  padding: 20px;
  background: #ffffff;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 选中状态 */
.module-item.is-selected {
  border-color: var(--module-color);
  background: linear-gradient(135deg, var(--module-color-ultra-light) 0%, #ffffff 100%);
  box-shadow: 
    0 8px 16px -4px var(--module-color-alpha),
    0 0 0 1px var(--module-color);
}

.module-item.is-selected::before {
  opacity: 1;
  height: 5px;
}

.module-item.is-selected .module-item-title {
  color: var(--module-color);
}

.module-item.is-selected .module-icon-emoji {
  transform: scale(1.1);
}

.module-item.is-selected::after {
  content: '✓';
  position: absolute;
  top: 12px;
  right: 12px;
  width: 24px;
  height: 24px;
  background: var(--module-color);
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: bold;
  animation: checkPop 0.3s ease-out;
}

@keyframes checkPop {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.module-item::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--module-color) 0%, var(--module-color-light) 100%);
  opacity: 0.9;
  transition: opacity 0.3s ease;
}

/* Hover 状态 */
.module-item:hover {
  border-color: var(--module-color);
  box-shadow: 
    0 8px 16px -4px rgba(0, 0, 0, 0.08),
    0 4px 6px -2px rgba(0, 0, 0, 0.04);
}

.module-item:hover::before {
  opacity: 1;
}

/* Focus 状态（键盘导航） */
.module-item:focus-visible {
  outline: none;
  border-color: var(--module-color);
  box-shadow: 0 0 0 3px var(--module-color-alpha);
}

/* ===== 图标区域 ===== */
.module-icon-emoji {
  font-size: 28px;
  display: inline-block;
  margin-bottom: 12px;
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.08));
}

/* ===== 标题区域 ===== */
.module-item-title {
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 10px;
  color: #1e293b;
  line-height: 1.3;
  transition: color 0.3s ease;
  letter-spacing: -0.01em;
}

/* ===== 描述区域 ===== */
.module-item-desc {
  color: #475569;
  font-size: 13.5px;
  line-height: 1.65;
  margin-bottom: 14px;
}

/* ===== 场景标签（改为pill样式）===== */
.module-item-scenario {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding: 7px 13px;
  background: linear-gradient(135deg, #f1f5f9 0%, #f8fafc 100%);
  border: 1px solid #e2e8f0;
  border-radius: 20px;
  color: #64748b;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
  transition: all 0.3s ease;
}

.module-item-scenario::before {
  content: '💡';
  font-size: 11px;
  flex-shrink: 0;
}

.module-item:hover .module-item-scenario {
  background: linear-gradient(135deg, var(--module-color-ultra-light) 0%, #ffffff 100%);
  border-color: var(--module-color-light);
  color: var(--module-color-dark);
}

/* ===== 各模块主题色定义 ===== */
.module-item[data-module="LIBRARY"] {
  --module-color: #3b82f6;
  --module-color-light: #93bbfd;
  --module-color-ultra-light: #eff6ff;
  --module-color-dark: #1d4ed8;
  --module-color-alpha: rgba(59, 130, 246, 0.15);
}

.module-item[data-module="CONSISTENCY"] {
  --module-color: #8b5cf6;
  --module-color-light: #c4b5fd;
  --module-color-ultra-light: #f5f3ff;
  --module-color-dark: #6d28d9;
  --module-color-alpha: rgba(139, 92, 246, 0.15);
}

.module-item[data-module="PROOFREAD"] {
  --module-color: #10b981;
  --module-color-light: #6ee7b7;
  --module-color-ultra-light: #ecfdf5;
  --module-color-dark: #059669;
  --module-color-alpha: rgba(16, 185, 129, 0.15);
}

.module-item[data-module="MULTIMODAL"] {
  --module-color: #f59e0b;
  --module-color-light: #fcd34d;
  --module-color-ultra-light: #fffbeb;
  --module-color-dark: #d97706;
  --module-color-alpha: rgba(245, 158, 11, 0.15);
}

.module-item[data-module="DOC_REVIEW"] {
  --module-color: #ef4444;
  --module-color-light: #fca5a5;
  --module-color-ultra-light: #fef2f2;
  --module-color-dark: #dc2626;
  --module-color-alpha: rgba(239, 68, 68, 0.15);
}

.module-item[data-module="RULE_ONLY"] {
  --module-color: #06b6d4;
  --module-color-light: #67e8f9;
  --module-color-ultra-light: #ecfeff;
  --module-color-dark: #0891b2;
  --module-color-alpha: rgba(6, 182, 212, 0.15);
}

.module-item[data-module="SELF_CHECK"] {
  --module-color: #22c55e;
  --module-color-light: #86efac;
  --module-color-ultra-light: #f0fdf4;
  --module-color-dark: #16a34a;
  --module-color-alpha: rgba(34, 197, 94, 0.15);
}

/* ===== 已选择模块栏 ===== */
.module-selected-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #f8faff;
  border: 1px solid #dbeafe;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(14, 165, 233, 0.06);
  animation: slideIn 0.3s ease-out;
  gap: 12px;
  flex-wrap: wrap;
}

.selected-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 200px;
}

.selected-label {
  color: #94a3b8;
  font-size: 13px;
  font-weight: 400;
}

.selected-module-name {
  color: #3b82f6;
  font-size: 14px;
  font-weight: 600;
  padding: 2px 10px;
  background: white;
  border-radius: 4px;
  border: 1px solid #dbeafe;
}

.selected-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ===== 响应式适配 ===== */

/* 大屏幕:3列布局 */
@media (min-width: 1400px) {
  .module-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 18px;
  }
}

/* 中等屏幕:2列布局 */
@media (min-width: 1000px) and (max-width: 1399px) {
  .module-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }
}

/* 小屏幕/平板:单列布局 */
@media (max-width: 999px) {
  .module-step-card {
    padding: 24px;
  }
  
  .module-title {
    font-size: 22px;
  }
  
  .module-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  
  .module-item {
    padding: 18px;
  }
  
  .module-icon-emoji {
    font-size: 24px;
    margin-bottom: 10px;
  }
  
  .module-item-title {
    font-size: 16px;
  }
  
  .module-item-desc {
    font-size: 13px;
  }
  
  .module-item-scenario {
    font-size: 11.5px;
    padding: 6px 12px;
  }
}

/* 已选模块栏响应式 */
@media (max-width: 768px) {
  .module-selected-bar {
    flex-direction: column;
    align-items: stretch;
    padding: 16px;
  }
  
  .selected-info {
    justify-content: center;
  }
  
  .selected-actions {
    justify-content: stretch;
  }
  
  .selected-actions .el-button {
    flex: 1;
  }
}
</style>