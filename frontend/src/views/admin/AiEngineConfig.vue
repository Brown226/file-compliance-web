<template>
  <div class="ai-engine-config">
    <!-- 导航：左胶囊 + 右提示 -->
    <nav class="engine-nav">
      <div class="nav-pills">
        <button
          v-for="item in tabs"
          :key="item.key"
          class="engine-pill"
          :class="{ active: activeTab === item.key }"
          @click="activeTab = item.key"
        >
          {{ item.label }}
        </button>
      </div>
      <span class="nav-hint">{{ currentTab?.hint }}</span>
    </nav>

    <!-- 内容区：直接渲染子页面（子页面自带标题与卡片） -->
    <section class="engine-panel">
      <ModelConfigPage v-if="activeTab === 'models'" />
      <KnowledgeConfigPage v-else-if="activeTab === 'knowledge'" />
      <LlmProfilesTab v-else-if="activeTab === 'profiles'" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ModelConfigPage from '@/views/LLMConfig/ModelConfigPage.vue'
import KnowledgeConfigPage from '@/views/LLMConfig/KnowledgeConfigPage.vue'
import LlmProfilesTab from '@/views/admin/LlmProfiles.vue'

const tabs = [
  {
    key: 'models',
    label: '模型配置',
    hint: '对话 / Embedding / 视觉 / OCR',
  },
  {
    key: 'knowledge',
    label: '知识库配置',
    hint: 'MaxKB + RAGFlow 双源检索',
  },
  {
    key: 'profiles',
    label: 'Provider 配置',
    hint: '凭证数据源 · 支持批量扫描',
  },
] as const

const activeTab = ref<'models' | 'knowledge' | 'profiles'>('models')
const currentTab = computed(() => tabs.find(item => item.key === activeTab.value))
</script>

<style scoped>
.ai-engine-config {
  display: flex;
  flex-direction: column;
  gap: 0;
  height: 100%;
}

/* === 顶部导航条 === */
.engine-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  background: #fff;
  border-bottom: 1px solid #eef2f7;
  position: sticky;
  top: 0;
  z-index: 2;
}

.nav-pills {
  display: flex;
  gap: 4px;
  background: #f1f5f9;
  padding: 4px;
  border-radius: 10px;
}

.engine-pill {
  padding: 6px 16px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #64748b;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.18s cubic-bezier(0.4, 0, 0.2, 1);
}

.engine-pill:hover {
  color: #1e293b;
}

.engine-pill.active {
  background: #fff;
  color: #0f172a;
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.04);
}

.nav-hint {
  font-size: 12px;
  color: #94a3b8;
  font-weight: 500;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
}

/* === 内容区：纯净容器，由子页面自管布局 === */
.engine-panel {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: #f8fafc;
}

@media (max-width: 768px) {
  .engine-nav {
    padding: 12px 14px;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .nav-hint {
    max-width: 100%;
  }
}
</style>
