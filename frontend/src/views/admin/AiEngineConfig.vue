<template>
  <div class="ai-engine-config">
    <!-- 左侧竖导航 + 右侧内容（设置类应用经典范式） -->
    <aside class="engine-sider">
      <button
        v-for="item in tabs"
        :key="item.key"
        class="engine-sider-item"
        :class="{ active: activeTab === item.key }"
        @click="activeTab = item.key"
      >
        <el-icon :size="17"><component :is="item.icon" /></el-icon>
        <span>{{ item.label }}</span>
      </button>
    </aside>

    <!-- 内容区：右侧配置舞台 -->
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
  height: 100%;
  min-height: 0;
}

/* === 左侧竖导航栏 === */
.engine-sider {
  width: 168px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--corp-border-light);
  padding: 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}

.engine-sider-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--corp-text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  position: relative;
  transition: color var(--corp-transition-base), background var(--corp-transition-base);
}

.engine-sider-item:hover {
  color: var(--corp-text-primary);
  background: var(--bg-surface-hover);
}

.engine-sider-item.active {
  color: var(--color-primary-600);
  background: var(--color-primary-50);
  font-weight: 600;
}

/* 激活态：左侧品牌蓝渐变竖条（克制的记忆点） */
.engine-sider-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 20%;
  bottom: 20%;
  width: 3px;
  border-radius: 2px;
  background: linear-gradient(180deg, var(--color-primary-400), var(--color-primary-600));
}

.engine-sider-item.active :deep(.el-icon) {
  color: var(--color-primary-600);
}

/* === 右侧内容区 === */
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
  .ai-engine-config {
    flex-direction: column;
  }

  .engine-sider {
    width: 100%;
    flex-direction: row;
    overflow-x: auto;
    border-right: none;
    border-bottom: 1px solid var(--corp-border-light);
    padding: 8px 10px;
  }

  .engine-sider-item {
    flex-shrink: 0;
  }
}
</style>
