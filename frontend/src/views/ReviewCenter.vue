<template>
  <div class="review-center">
    <!-- 顶部 Tab 切换 -->
    <div class="rc-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="rc-tab-item"
        :class="{ active: activeTab === tab.key }"
        @click="switchTab(tab.key)"
      >
        <el-icon :size="16"><component :is="tab.icon" /></el-icon>
        <span>{{ tab.label }}</span>
      </button>
      <!-- 右侧新建按钮 -->
      <div class="rc-tabs-right">
        <el-button type="primary" @click="$router.push('/review')">
          <el-icon><Plus /></el-icon> 新建审查
        </el-button>
      </div>
    </div>

    <!-- 内容区 -->
    <div class="rc-content">
      <Workspace v-show="activeTab === 'overview'" />
      <TaskHistory v-show="activeTab === 'tasks'" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { DataBoard, List, Plus } from '@element-plus/icons-vue'
import Workspace from '@/views/Workspace.vue'
import TaskHistory from '@/views/TaskHistory.vue'

const route = useRoute()
const router = useRouter()

const tabs = [
  { key: 'overview', label: '概览', icon: DataBoard },
  { key: 'tasks', label: '全部任务', icon: List },
]

const activeTab = ref('overview')

// 支持 /review-center?tab=tasks
watch(() => route.query.tab, (tab) => {
  if (tab && tabs.some(t => t.key === tab)) {
    activeTab.value = tab as string
  }
}, { immediate: true })

function switchTab(key: string) {
  activeTab.value = key
  router.replace({ path: '/review-center', query: key === 'overview' ? {} : { tab: key } })
}
</script>

<style scoped>
.review-center {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.rc-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 10px 20px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
}

.rc-tab-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: #6b7280;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
}

.rc-tab-item:hover {
  color: #111827;
  background: #f3f4f6;
}

.rc-tab-item.active {
  color: #2563eb;
  background: #eff6ff;
}

.rc-tabs-right {
  margin-left: auto;
}

.rc-content {
  flex: 1;
  overflow: auto;
}
</style>
