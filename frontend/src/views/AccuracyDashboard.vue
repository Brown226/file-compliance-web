<template>
  <div class="accuracy-dashboard-container">
    <div class="dashboard-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.name"
        class="tab-item"
        :class="{ active: activeTab === tab.name }"
        @click="activeTab = tab.name"
      >
        {{ tab.label }}
      </button>
    </div>

    <div class="dashboard-body">
      <Transition name="tab-switch" mode="out-in">
        <QualityTab v-if="activeTab === 'quality'" key="quality" />
        <PlatformTab v-else key="platform" />
      </Transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import QualityTab from './Dashboard/QualityTab.vue'
import PlatformTab from './Dashboard/PlatformTab.vue'

const activeTab = ref<'quality' | 'platform'>('quality')

const tabs = [
  { name: 'quality' as const, label: '审查质量' },
  { name: 'platform' as const, label: '平台运营' },
]
</script>

<style scoped>
.accuracy-dashboard-container {
  padding: 20px 24px 32px;
  background: #f8fafc;
  min-height: calc(100vh - 60px);
}

.dashboard-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  border-bottom: 1px solid #e2e8f0;
  padding-bottom: 12px;
}

.tab-item {
  padding: 8px 16px;
  font-size: 15px;
  font-weight: 500;
  color: #64748b;
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tab-item:hover {
  color: #0f172a;
  background: #f1f5f9;
}

.tab-item.active {
  color: #2563eb;
  background: #eff6ff;
  font-weight: 600;
}

.dashboard-body {
  position: relative;
}

.tab-switch-enter-active,
.tab-switch-leave-active {
  transition: all 0.2s ease;
}

.tab-switch-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.tab-switch-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
