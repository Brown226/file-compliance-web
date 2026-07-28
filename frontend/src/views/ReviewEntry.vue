<template>
  <div class="review-entry-page">
    <!-- 模块选择 -->
    <div v-if="!selectedModule" class="module-card">
      <div class="module-header">
        <h2>选择审查模块</h2>
        <p>根据文档类型和审查需求，选择对应的审查策略</p>
      </div>

      <!-- 常用审查 -->
      <div class="module-section">
        <h3 class="section-title">常用审查</h3>
        <div class="module-grid">
          <button
            v-for="item in commonModules"
            :key="item.id"
            type="button"
            class="module-item"
            :class="{ 'is-selected': selectedModule === item.id }"
            :style="{ '--accent': item.color }"
            @click="selectModule(item)"
          >
            <span class="item-icon"><el-icon :size="20"><component :is="item.icon" /></el-icon></span>
            <span class="item-body">
              <span class="item-title">{{ item.title }}</span>
              <span class="item-desc">{{ item.desc }}</span>
              <span class="item-scenario">{{ item.scenario }}</span>
              <span
                v-if="item.preset"
                class="item-preset"
                @click.stop="selectPreset(item.preset.target)"
              >{{ item.preset.label }} →</span>
            </span>
          </button>
        </div>
      </div>

      <!-- 专项审查 -->
      <div class="module-section">
        <h3 class="section-title">专项审查</h3>
        <div class="module-grid">
          <button
            v-for="item in specialModules"
            :key="item.id"
            type="button"
            class="module-item"
            :class="{ 'is-selected': selectedModule === item.id }"
            :style="{ '--accent': item.color }"
            @click="selectModule(item)"
          >
            <span class="item-icon"><el-icon :size="20"><component :is="item.icon" /></el-icon></span>
            <span class="item-body">
              <span class="item-title">{{ item.title }}</span>
              <span class="item-desc">{{ item.desc }}</span>
              <span class="item-scenario">{{ item.scenario }}</span>
            </span>
          </button>
        </div>
      </div>
    </div>

    <!-- 已选模块栏 -->
    <div v-else class="selected-bar">
      <span class="selected-label">当前模块</span>
      <span class="selected-name">{{ selectedModuleLabel }}</span>
      <el-button text size="small" type="primary" @click="selectedModule = ''">重新选择</el-button>
    </div>

    <!-- 审查表单 -->
    <SmartReviewLegacy v-if="selectedModule && selectedModule !== 'SELF_CHECK'" />
    <SelfCheck v-if="selectedModule === 'SELF_CHECK'" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  Document, Fold, Link, EditPen, List, CircleCheck, View,
} from '@element-plus/icons-vue'
import SmartReviewLegacy from './SmartReview.vue'
import SelfCheck from './SelfCheck/index.vue'

type ModuleId = 'LIBRARY' | 'CONSISTENCY' | 'PROOFREAD' | 'RULE_ONLY' | 'DOC_REVIEW' | 'SELF_CHECK' | 'CONTRACT' | 'DWG_VISION'

const router = useRouter()
const selectedModule = ref<ModuleId | ''>('')

interface ModuleItem {
  id: ModuleId
  title: string
  desc: string
  scenario: string
  icon: any
  color: string
  /** 跳转路由（不为空时点击卡片直接跳转，不走表单） */
  linkTo?: string
  /** 预设标签（次级入口，点击切换到另一个 module） */
  preset?: { label: string; target: ModuleId }
}

const commonModules: ModuleItem[] = [
  {
    id: 'LIBRARY',
    title: '标准合规审查',
    desc: '基于标准库 + AI 综合合规审查（自动启用 DEC 双分支增强）',
    scenario: '初次送审、标准符合性检查',
    icon: Document,
    color: '#2563eb',
  },
  {
    id: 'DOC_REVIEW',
    title: '文件比对审查',
    desc: '上传参照文件，AI 逐项比对差异',
    scenario: '合同 vs 模板、新旧版变更比对',
    icon: Fold,
    color: '#7c3aed',
    preset: { label: '合同风险审查预设', target: 'CONTRACT' },
  },
  {
    id: 'CONSISTENCY',
    title: '一致性审查',
    desc: '多文件间数据与参数自洽性核对',
    scenario: '总图分图参数核对、跨表校验',
    icon: Link,
    color: '#0891b2',
  },
  {
    id: 'PROOFREAD',
    title: '基础校对',
    desc: '纯 LLM 驱动的文字、语法检查',
    scenario: '终稿发布前的文字把关',
    icon: EditPen,
    color: '#059669',
  },
]

const specialModules: ModuleItem[] = [
  {
    id: 'RULE_ONLY',
    title: '规则库审查',
    desc: '仅执行预定义规则，不调用 AI',
    scenario: '批量格式检查、快速初筛',
    icon: List,
    color: '#d97706',
  },
  {
    id: 'SELF_CHECK',
    title: '标准引用自检',
    desc: '引用与标准库逐条比对校验',
    scenario: '核查设计文件中的标准是否现行有效',
    icon: CircleCheck,
    color: '#4f46e5',
  },
  {
    id: 'DWG_VISION',
    title: '图纸视觉分析',
    desc: '视觉大模型识别标题栏、符号、标注、合规性',
    scenario: 'DWG 工程图纸的结构化审查',
    icon: View,
    color: '#dc2626',
    linkTo: '/dwg-vision',
  },
]

const selectedModuleLabel = computed(() => {
  const all = [...commonModules, ...specialModules]
  return all.find(m => m.id === selectedModule.value)?.title ?? ''
})

const selectModule = (item: ModuleItem) => {
  if (item.linkTo) {
    router.push(item.linkTo)
    return
  }
  selectedModule.value = item.id
  sessionStorage.setItem('smartReview.entryModule', item.id)
}

const selectPreset = (target: ModuleId) => {
  selectedModule.value = target
  sessionStorage.setItem('smartReview.entryModule', target)
}
</script>

<style scoped>
.review-entry-page {
  max-width: 960px;
  margin: 0 auto;
}

/* ===== 卡片容器 ===== */
.module-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  padding: 36px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.module-header {
  margin-bottom: 32px;
}

.module-header h2 {
  margin: 0 0 6px;
  font-size: 20px;
  font-weight: 600;
  color: #111827;
}

.module-header p {
  margin: 0;
  font-size: 14px;
  color: #6b7280;
}

/* ===== 分区 ===== */
.module-section + .module-section {
  margin-top: 28px;
  padding-top: 28px;
  border-top: 1px solid #f3f4f6;
}

.section-title {
  margin: 0 0 14px;
  font-size: 12px;
  font-weight: 600;
  color: #9ca3af;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

/* ===== 网格布局 ===== */
.module-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
}

/* ===== 模块条目 ===== */
.module-item {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 18px;
  background: #fff;
  border: 1.5px solid #e5e7eb;
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 0.2s, box-shadow 0.2s, background 0.2s;
  text-align: left;
  width: 100%;
  overflow: hidden;
}

.module-item::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}

.module-item:hover {
  border-color: #d1d5db;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
}

.module-item.is-selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 4px 12px rgba(0, 0, 0, 0.04);
}

.module-item.is-selected::before {
  opacity: 0.04;
}

/* 图标 */
.item-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  transition: transform 0.2s;
}

.module-item.is-selected .item-icon {
  transform: scale(1.05);
}

/* 文字 */
.item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.item-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  line-height: 1.3;
}

.item-desc {
  font-size: 13px;
  color: #6b7280;
  line-height: 1.5;
}

.item-scenario {
  font-size: 12px;
  color: #9ca3af;
  line-height: 1.4;
}

.item-scenario::before {
  content: '适用：';
}

.item-preset {
  margin-top: 6px;
  font-size: 12px;
  color: var(--accent);
  cursor: pointer;
  user-select: none;
}

.item-preset:hover {
  text-decoration: underline;
}

/* ===== 已选模块栏 ===== */
.selected-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 20px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  margin-bottom: 20px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}

.selected-label {
  font-size: 13px;
  color: #9ca3af;
}

.selected-name {
  font-size: 14px;
  font-weight: 600;
  color: #2563eb;
  flex: 1;
}

/* ===== 响应式 ===== */
@media (max-width: 640px) {
  .module-card { padding: 20px; }
  .module-grid { grid-template-columns: 1fr; }
  .module-item { padding: 14px; }
}
</style>
