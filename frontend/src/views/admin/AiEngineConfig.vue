<template>
  <div class="ai-engine-config">
    <!-- 左侧竖列导航 -->
    <nav class="engine-sider" role="tablist" aria-orientation="vertical">
      <button
        v-for="item in tabs"
        :key="item.key"
        class="engine-sider-item"
        :class="{ active: activeTab === item.key }"
        role="tab"
        :aria-selected="activeTab === item.key"
        @click="activeTab = item.key"
      >
        <el-icon :size="16"><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <!-- 内容区：单层配置舞台（不再嵌套白卡/灰底） -->
    <section class="engine-main">
      <ModelConfigPage v-if="activeTab === 'models'" />
      <KnowledgeConfigPage v-else-if="activeTab === 'knowledge'" />
      <!-- Provider 配置：统一使用公共组件（参考项目 pi 两级树风格，内嵌形态） -->
      <div v-else-if="activeTab === 'profiles'" class="provider-panel-wrap">
        <ProviderConfigPanel mode="inline" />
      </div>
      <!-- 审查模式配置（2026-08-26：smartJudge 判标开关等） -->
      <ModeConfigPanel v-else-if="activeTab === 'modes'" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Cpu, Collection, Setting, DataAnalysis } from '@element-plus/icons-vue'
import ModelConfigPage from '@/views/LLMConfig/ModelConfigPage.vue'
import KnowledgeConfigPage from '@/views/LLMConfig/KnowledgeConfigPage.vue'
import ProviderConfigPanel from '@/components/provider-config/ProviderConfigPanel.vue'
import ModeConfigPanel from './ModeConfigPanel.vue'

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
  {
    key: 'modes',
    label: '审查模式',
    icon: DataAnalysis,
  },
] as const

const activeTab = ref<'models' | 'knowledge' | 'profiles' | 'modes'>('models')
</script>

<style scoped>
.ai-engine-config {
  display: flex;
  align-items: flex-start;
  gap: var(--space-6);
  padding-bottom: var(--space-8);
  min-height: 560px;
}

/* === 左侧竖列导航：贴页面灰底，激活项白卡浮起 === */
.engine-sider {
  width: 150px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  position: sticky;
  top: var(--space-6);
}

.engine-sider-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 14px;
  border: none;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--corp-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: color var(--corp-transition-base), background var(--corp-transition-base);
}

.engine-sider-item:hover {
  color: var(--corp-text-primary);
  background: var(--bg-surface-hover);
}

.engine-sider-item.active {
  background: var(--bg-surface);
  color: var(--color-primary-600);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 0 0 1px rgba(15, 23, 42, 0.04);
}

.engine-sider-item.active .el-icon {
  color: var(--color-primary-600);
}

/* === 内容区：透明底，页面灰底直接承接内层卡片 === */
.engine-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

/* === Provider 配置：公共组件内嵌形态 === */
.provider-panel-wrap {
  min-height: 560px;
  padding: 4px 0 0;
  box-sizing: border-box;
}

@media (max-width: 768px) {
  .ai-engine-config {
    flex-direction: column;
    gap: var(--space-4);
  }

  .engine-sider {
    width: 100%;
    flex-direction: row;
    overflow-x: auto;
    position: static;
    padding-bottom: var(--space-1);
  }

  .engine-sider-item {
    flex-shrink: 0;
  }
}
</style>
