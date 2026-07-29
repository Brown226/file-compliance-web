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
            v-for="item in visibleCommonModules"
            :key="item.id"
            type="button"
            class="module-item"
            :class="{ 'is-selected': selectedModule === item.id }"
            :style="{ '--accent': item.color }"
            @click="selectModule(item)"
          >
            <span class="item-icon"><el-icon :size="20"><component :is="item.icon" /></el-icon></span>
            <span class="item-body">
              <el-tooltip v-if="item.techHint" :content="item.techHint" placement="top" :show-after="300">
                <span class="item-title">{{ item.title }}</span>
              </el-tooltip>
              <span v-else class="item-title">{{ item.title }}</span>
              <span class="item-desc">{{ item.desc }}</span>
              <span class="item-scenario">{{ item.scenario }}</span>
            </span>
          </button>
        </div>
      </div>

      <!-- 专项审查 -->
      <div class="module-section">
        <h3 class="section-title">专项审查</h3>
        <div class="module-grid">
          <button
            v-for="item in visibleSpecialModules"
            :key="item.id"
            type="button"
            class="module-item"
            :class="{ 'is-selected': selectedModule === item.id }"
            :style="{ '--accent': item.color }"
            @click="selectModule(item)"
          >
            <span class="item-icon"><el-icon :size="20"><component :is="item.icon" /></el-icon></span>
            <span class="item-body">
              <el-tooltip v-if="item.techHint" :content="item.techHint" placement="top" :show-after="300">
                <span class="item-title">{{ item.title }}</span>
              </el-tooltip>
              <span v-else class="item-title">{{ item.title }}</span>
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
import { computed, ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import {
  Document, Fold, Link, EditPen, Stamp, CircleCheck, View,
} from '@element-plus/icons-vue'
import SmartReviewLegacy from './SmartReview.vue'
import SelfCheck from './SelfCheck/index.vue'
import { loadFeatureFlags, isFeatureEnabled } from '@/composables/useFeatureFlags'

type ModuleId = 'LIBRARY' | 'CONSISTENCY' | 'PROOFREAD' | 'RULE_ONLY' | 'DOC_REVIEW' | 'SELF_CHECK' | 'CONTRACT' | 'DWG_VISION'

interface ModuleItem {
  id: ModuleId
  title: string
  desc: string
  scenario: string
  icon: any
  color: string
  /** 跳转路由（不为空时点击卡片直接跳转，不走表单） */
  linkTo?: string
  /** 技术词 tooltip（RAG/规则引擎/DEC 等），通过 el-tooltip 悬停显示 */
  techHint?: string
  /** 功能开关 key（如 entry.RULE_ONLY），未启用时隐藏此卡 */
  featureKey?: string
}

const router = useRouter()
const selectedModule = ref<ModuleId | ''>('')

const commonModules: ModuleItem[] = [
  {
    id: 'PROOFREAD',
    title: '文字校对',
    desc: '检查错别字、语句通顺、标点',
    scenario: '终稿发布前的文字把关',
    icon: EditPen,
    color: '#059669',
    techHint: '纯 LLM 驱动，覆盖 TYPO/FLUENCY/CONSISTENCY 三类文字问题',
    featureKey: 'entry.PROOFREAD',
  },
  {
    id: 'LIBRARY',
    title: '以库审文',
    desc: '结合知识库或语义规则库进行合规审查',
    scenario: '技术文档 vs 知识库、规范要点核查',
    icon: Document,
    color: '#2563eb',
    techHint: '知识库走 RAG + DEC 双分支增强；语义规则库作为 AI 审查点逐条匹配',
    featureKey: 'entry.LIBRARY',
  },
  {
    id: 'DOC_REVIEW',
    title: '以文审文',
    desc: '待审文档与参照文档逐项比对',
    scenario: '借鉴多份文档写作后的一致性核查',
    icon: Fold,
    color: '#7c3aed',
    techHint: '上传参照文件，AI 语义级比对差异与遗漏',
    featureKey: 'entry.DOC_REVIEW',
  },
  {
    id: 'CONSISTENCY',
    title: '上下文一致性',
    desc: '检查文件内部及多文件间的术语、数值、指标自洽',
    scenario: '长文档或跨文件参数核对',
    icon: Link,
    color: '#0891b2',
    techHint: 'Map-Reduce 架构：先抽取结构化摘要，再跨分片做 C1-C4 一致性比对',
    featureKey: 'entry.CONSISTENCY',
  },
]

const specialModules: ModuleItem[] = [
  {
    id: 'CONTRACT',
    title: '合同风险审查',
    desc: '立场驱动识别不利条款、缺失保护条款',
    scenario: '核电工程合同业主/承包商风险审查',
    icon: Stamp,
    color: '#dc2626',
    techHint: '独立 prompt 与结果结构（riskLevel + clauseType + recommendation），不复用以文审文逻辑',
    featureKey: 'entry.CONTRACT',
  },
  {
    id: 'SELF_CHECK',
    title: '标准引用自检',
    desc: '引用与标准库逐条比对校验',
    scenario: '核查设计文件中的标准是否现行有效',
    icon: CircleCheck,
    color: '#4f46e5',
    techHint: '独立端点 /api/self-check，不走 7 模式 handler',
    featureKey: 'entry.SELF_CHECK',
  },
  {
    id: 'DWG_VISION',
    title: '图纸视觉分析',
    desc: '视觉大模型识别标题栏、符号、标注、合规性',
    scenario: 'DWG 工程图纸的结构化审查',
    icon: View,
    color: '#d97706',
    linkTo: '/dwg-vision',
    techHint: '视觉模型 + 图纸结构化提取',
    featureKey: 'entry.DWG_VISION',
  },
]

// 功能开关加载状态（加载完成前显示全部，避免闪烁）
const flagsLoaded = ref(false)
onMounted(async () => {
  await loadFeatureFlags()
  flagsLoaded.value = true
})

// 按功能开关过滤后的卡片
const visibleCommonModules = computed(() =>
  flagsLoaded.value
    ? commonModules.filter(m => !m.featureKey || isFeatureEnabled(m.featureKey))
    : commonModules
)
const visibleSpecialModules = computed(() =>
  flagsLoaded.value
    ? specialModules.filter(m => !m.featureKey || isFeatureEnabled(m.featureKey))
    : specialModules
)

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
