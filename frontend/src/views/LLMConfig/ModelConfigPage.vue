<template>
  <div class="model-config-page">
    <!-- 右侧配置主区（一级导航在 AiEngineConfig 顶部） -->
    <div class="model-main">
      <!-- 内容区顶部细标签（二级导航） -->
      <div class="model-tabs" role="tablist">
        <button
          v-for="tab in modelTabs"
          :key="tab.key"
          class="model-tab-item"
          :class="{ active: activeModelTab === tab.key }"
          @click="activeModelTab = tab.key"
        >
          <el-icon :size="15"><component :is="tab.icon" /></el-icon>
          <span>{{ tab.label }}</span>
        </button>
      </div>

      <div class="model-config-panel">
        <AdminPanel :title="currentModelTab?.title">
          <template #actions>
            <div class="model-actions">
              <el-button :loading="testLoading" @click="handleTest">
                <el-icon><Connection /></el-icon>
                测试连接
              </el-button>
              <el-button type="primary" :loading="saveLoading" @click="handleSave">
                <el-icon><Check /></el-icon>
                保存配置
              </el-button>
            </div>
          </template>

          <p class="panel-desc">{{ currentModelTab?.description }}</p>
          <OcrStatusBar v-if="activeModelTab === 'vision'" class="ocr-bar-compact" />

          <div class="form-stage">
            <ChatModelTab ref="chatRef" v-show="activeModelTab === 'chat'" />
            <EmbeddingModelTab ref="embeddingRef" v-show="activeModelTab === 'embedding'" />
            <VisionModelTab ref="visionRef" v-show="activeModelTab === 'vision'" />
            <RerankModelTab ref="rerankRef" v-show="activeModelTab === 'rerank'" />
          </div>

          <!-- 统一结果提示 -->
          <div v-if="testResult" class="test-result" :class="testResult.success ? 'test-success' : 'test-fail'">
            <el-icon><component :is="testResult.success ? CircleCheckFilled : CircleCloseFilled" /></el-icon>
            <span>{{ testResult.success ? '连接成功' : '连接失败' }}</span>
            <span v-if="testResult.message" class="result-detail">{{ testResult.message }}</span>
            <span v-if="testResult.latency !== undefined" class="result-latency">延迟: {{ testResult.latency }}ms</span>
          </div>
        </AdminPanel>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ChatDotRound, Cpu, View, Sort, Connection, Check, CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue'
import AdminPanel from '@/components/admin/AdminPanel.vue'
import ChatModelTab from './ChatModelTab.vue'
import EmbeddingModelTab from './EmbeddingModelTab.vue'
import VisionModelTab from './VisionModelTab.vue'
import RerankModelTab from './RerankModelTab.vue'
import OcrStatusBar from './OcrStatusBar.vue'

const modelTabs = [
  {
    key: 'chat',
    label: '对话模型',
    title: '对话模型',
    description: '主推理模型，用于文件审查与问答',
    icon: ChatDotRound,
  },
  {
    key: 'embedding',
    label: 'Embedding',
    title: 'Embedding 模型',
    description: '用于知识库文档向量化',
    icon: Cpu,
  },
  {
    key: 'vision',
    label: '视觉模型',
    title: '视觉模型',
    description: '用于扫描件 OCR 与图纸识别',
    icon: View,
  },
  {
    key: 'rerank',
    label: '重排序',
    title: 'Rerank 重排序模型',
    description: '用于知识库检索结果的二次精排，提升召回准确率',
    icon: Sort,
  },
] as const

const activeModelTab = ref<'chat' | 'embedding' | 'vision' | 'rerank'>('chat')
const currentModelTab = computed(() => modelTabs.find((t) => t.key === activeModelTab.value))

const chatRef = ref<InstanceType<typeof ChatModelTab>>()
const embeddingRef = ref<InstanceType<typeof EmbeddingModelTab>>()
const visionRef = ref<InstanceType<typeof VisionModelTab>>()
const rerankRef = ref<InstanceType<typeof RerankModelTab>>()

const testLoading = ref(false)
const saveLoading = ref(false)
const testResult = ref<{ success: boolean; message?: string; latency?: number } | null>(null)

const currentRef = computed(() => {
  switch (activeModelTab.value) {
    case 'chat':
      return chatRef.value
    case 'embedding':
      return embeddingRef.value
    case 'vision':
      return visionRef.value
    case 'rerank':
      return rerankRef.value
    default:
      return undefined
  }
})

async function handleTest() {
  const inst = currentRef.value
  if (!inst || typeof inst.handleTest !== 'function') {
    return
  }
  testLoading.value = true
  testResult.value = null
  try {
    testResult.value = await inst.handleTest()
  } finally {
    testLoading.value = false
  }
}

async function handleSave() {
  const inst = currentRef.value
  if (!inst || typeof inst.handleSave !== 'function') {
    return
  }
  saveLoading.value = true
  try {
    await inst.handleSave()
  } finally {
    saveLoading.value = false
  }
}
</script>

<style scoped>
.model-config-page {
  height: 100%;
  min-height: 0;
  padding: 20px 24px;
  overflow-y: auto;
}

/* === 内容区顶部细标签（二级导航） === */
.model-tabs {
  display: inline-flex;
  gap: 2px;
  margin-bottom: 16px;
  padding: 3px;
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 10px;
}

.model-tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--corp-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color var(--corp-transition-base), background var(--corp-transition-base);
}

.model-tab-item:hover {
  color: var(--corp-text-primary);
  background: var(--bg-surface-hover);
}

.model-tab-item.active {
  color: var(--color-primary-600);
  background: var(--color-primary-50);
  font-weight: 600;
}

/* === 配置卡片（沿用 AdminPanel 全局默认，仅调整留白）=== */
.model-config-panel {
  border-radius: var(--radius-xl);
}

/* 卡片头留白 */
.model-config-panel :deep(.admin-panel__header) {
  padding: 18px 24px;
}

/* 卡片体：内边距加大、留白更舒适 */
.model-config-panel :deep(.admin-panel__body) {
  padding: 24px 28px 28px;
}

.panel-desc {
  margin: 0 0 18px;
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  line-height: 1.6;
  padding-bottom: 14px;
  border-bottom: 1px dashed var(--corp-border-light);
}

.ocr-bar-compact {
  border-radius: var(--radius-lg);
  padding: 10px 14px;
  margin-bottom: 14px;
}

/* 统一操作区（位于卡片头部 actions 插槽内） */
.model-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
}

.test-result {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  font-weight: 500;
  margin-top: var(--space-5);
}

.test-success {
  background: var(--color-success-bg);
  color: var(--color-success-text);
}

.test-fail {
  background: var(--color-danger-bg);
  color: var(--color-danger-text);
}

.result-detail {
  font-weight: 400;
  opacity: 0.9;
}

.result-latency {
  margin-left: auto;
  font-size: 12px;
  padding: 2px 10px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 999px;
}

@media (max-width: 768px) {
  .model-tabs {
    width: 100%;
    overflow-x: auto;
  }

  .model-tab-item {
    flex-shrink: 0;
  }

  .model-actions {
    flex-direction: column;
  }
}
</style>
