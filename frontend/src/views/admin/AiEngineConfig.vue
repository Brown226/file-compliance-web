<template>
  <div class="ai-engine-config">
    <!-- 顶部一级导航（分段控件，与统一面板子导航同款视觉语言） -->
    <div class="engine-tabs" role="tablist">
      <button
        v-for="item in tabs"
        :key="item.key"
        class="engine-tab-item"
        :class="{ active: activeTab === item.key }"
        role="tab"
        :aria-selected="activeTab === item.key"
        @click="activeTab = item.key"
      >
        <el-icon :size="15"><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </button>
    </div>

    <!-- 内容区：配置舞台 -->
    <section class="engine-main">
      <ModelConfigPage v-if="activeTab === 'models'" />
      <KnowledgeConfigPage v-else-if="activeTab === 'knowledge'" />
      <!-- Provider 配置：统一使用公共组件（参考项目 pi 两级树风格，内嵌形态） -->
      <div v-else-if="activeTab === 'profiles'" class="provider-panel-wrap">
        <ProviderConfigPanel mode="inline" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Cpu, Collection, Setting } from '@element-plus/icons-vue'
import ModelConfigPage from '@/views/LLMConfig/ModelConfigPage.vue'
import KnowledgeConfigPage from '@/views/LLMConfig/KnowledgeConfigPage.vue'
import ProviderConfigPanel from '@/components/provider-config/ProviderConfigPanel.vue'

const tabs = [
  {
    key: 'models',
    label: '模型配置',
    icon: Cpu,
  },
  {
    key: 'knowledge',
    label: '知识库配置',
    icon: Collection,
  },
  {
    key: 'profiles',
    label: 'Provider 配置',
    icon: Setting,
  },
] as const

const activeTab = ref<'models' | 'knowledge' | 'profiles'>('models')
</script>

<style scoped>
.ai-engine-config {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

/* === 顶部一级导航：灰底分段控件（与统一面板 config-nav 同款视觉） === */
.engine-tabs {
  align-self: flex-start;
  display: inline-flex;
  gap: var(--space-1);
  padding: var(--space-1);
  margin: 14px 20px 0;
  background: var(--color-gray-100);
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-xl);
  flex-shrink: 0;
}

.engine-tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 16px;
  border: none;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--corp-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color var(--corp-transition-base), background var(--corp-transition-base);
}

.engine-tab-item:hover {
  color: var(--corp-text-primary);
  background: var(--bg-surface-hover);
}

.engine-tab-item.active {
  background: var(--bg-surface);
  color: var(--color-primary-600);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.06);
}

/* === 内容区 === */
.engine-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  background: var(--corp-bg-sunken);
}

/* === Provider 配置：公共组件内嵌形态 === */
.provider-panel-wrap {
  height: 100%;
  min-height: 560px;
  padding: 16px 20px 20px;
  box-sizing: border-box;
}

@media (max-width: 768px) {
  .engine-tabs {
    align-self: stretch;
    overflow-x: auto;
    margin: 12px 12px 0;
  }

  .engine-tab-item {
    flex-shrink: 0;
  }
}
</style>
