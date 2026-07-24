<template>
  <div class="accuracy-dashboard-container">
    <!-- 顶层 Tab 切换 -->
    <el-tabs v-model="activeTab" class="dashboard-tabs">
      <el-tab-pane label="审查质量" name="quality">
        <QualityTab v-if="activeTab === 'quality'" />
      </el-tab-pane>
      <el-tab-pane label="平台运营" name="platform">
        <PlatformTab v-if="activeTab === 'platform'" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import QualityTab from './Dashboard/QualityTab.vue'
import PlatformTab from './Dashboard/PlatformTab.vue'

const activeTab = ref<'quality' | 'platform'>('quality')
</script>

<style scoped>
.accuracy-dashboard-container {
  padding: 16px 20px;
  background: #F5F7FA;
  min-height: calc(100vh - 60px);
}

.dashboard-tabs :deep(.el-tabs__header) {
  margin-bottom: 16px;
}
.dashboard-tabs :deep(.el-tabs__item) {
  font-size: 15px;
  font-weight: 600;
}
</style>
