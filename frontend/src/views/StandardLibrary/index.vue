<template>
  <div class="standard-library-container">
    <!-- Tab 切换 -->
    <div class="tab-header">
      <div
        class="tab-item"
        :class="{ active: activeTab === 'local' }"
        @click="activeTab = 'local'"
      >
        <el-icon><Files /></el-icon>
        标准库清单管理
      </div>
      <div
        class="tab-item"
        :class="{ active: activeTab === 'terminology' }"
        @click="switchToTerminology"
      >
        <el-icon><Key /></el-icon>
        白名单库
        <el-tag v-if="terminologyTotal > 0" size="small" type="info" style="margin-left:6px;">{{ terminologyTotal }}词</el-tag>
      </div>
      <div
        class="tab-item"
        :class="{ active: activeTab === 'falsePositive' }"
        @click="switchToFalsePositive"
      >
        <el-icon><Warning /></el-icon>
        误报标记库
        <el-tag v-if="fpLibraryTotal > 0" size="small" type="warning" style="margin-left:6px;">{{ fpLibraryTotal }}条</el-tag>
      </div>
    </div>

    <!-- 本地标准库清单管理 -->
    <LocalStandardTab v-show="activeTab === 'local'" />

    <!-- 白名单库 -->
    <TerminologyTab
      v-show="activeTab === 'terminology'"
      @update:total="terminologyTotal = $event"
    />

    <!-- 误报标记库 -->
    <FalsePositiveLibraryTab
      v-show="activeTab === 'falsePositive'"
      @update:total="fpLibraryTotal = $event"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Files, Key, Warning } from '@element-plus/icons-vue'
import LocalStandardTab from './LocalStandardTab.vue'
import TerminologyTab from './TerminologyTab.vue'
import FalsePositiveLibraryTab from './FalsePositiveLibraryTab.vue'

// ===== Tab 切换 =====
const activeTab = ref<'local' | 'terminology' | 'falsePositive'>('local')

// ===== 白名单术语总数 =====
const terminologyTotal = ref(0)

const switchToTerminology = () => {
  activeTab.value = 'terminology'
}

// ===== 误报标记库计数 =====
const fpLibraryTotal = ref(0)

const switchToFalsePositive = () => {
  activeTab.value = 'falsePositive'
}
</script>

<style scoped>
.standard-library-container { padding: 0; height: 100%; }

.tab-header {
  display: flex;
  gap: 0;
  margin-bottom: 8px;
  border-bottom: 2px solid var(--el-border-color-light);
  padding: 0;
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 500;
  color: var(--el-text-color-regular);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: all 0.2s;
}

.tab-item:hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.tab-item.active {
  color: var(--el-color-primary);
  border-bottom-color: var(--el-color-primary);
}
</style>
