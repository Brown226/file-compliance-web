<template>
  <div class="admin-panel">
    <!-- 顶部 Tab -->
    <div class="admin-tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="admin-tab-item"
        :class="{ active: activeTab === tab.key }"
        @click="activeTab = tab.key"
      >
        <el-icon :size="16"><component :is="tab.icon" /></el-icon>
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <!-- Tab 1: 系统健康 -->
    <div v-show="activeTab === 'health'" class="tab-content">
      <div class="health-grid">
        <!-- 服务状态 -->
        <div class="health-card status-card">
          <h3>服务状态</h3>
          <div class="status-list">
            <div class="status-item" v-for="s in serviceStatus" :key="s.name">
              <span class="status-dot" :class="s.ok ? 'ok' : 'error'"></span>
              <span class="status-name">{{ s.name }}</span>
              <span class="status-val">{{ s.ok ? '正常' : '异常' }}</span>
            </div>
          </div>
        </div>
        <!-- 关键指标 -->
        <div class="health-card metrics-card">
          <h3>关键指标</h3>
          <div class="metrics-grid">
            <div class="metric" v-for="m in metrics" :key="m.label">
              <div class="metric-value">{{ m.value }}</div>
              <div class="metric-label">{{ m.label }}</div>
            </div>
          </div>
        </div>
      </div>
      <!-- 快捷入口 -->
      <div class="quick-links">
        <h3>快捷入口</h3>
        <div class="links-grid">
          <div class="quick-link" @click="$router.push('/knowledge')">
            <el-icon :size="20"><Collection /></el-icon>
            <span>知识中心</span>
          </div>
          <div class="quick-link" @click="$router.push('/ai')">
            <el-icon :size="20"><ChatDotRound /></el-icon>
            <span>AI 工作台</span>
          </div>
          <div class="quick-link" @click="$router.push('/review-center')">
            <el-icon :size="20"><DataBoard /></el-icon>
            <span>审查中心</span>
          </div>
          <div class="quick-link" @click="$router.push('/announcements')">
            <el-icon :size="20"><Bell /></el-icon>
            <span>系统公告</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab 2: 审查配置 -->
    <div v-show="activeTab === 'review-config'" class="tab-content">
      <div class="config-nav">
        <button
          v-for="item in reviewConfigItems"
          :key="item.id"
          class="config-nav-item"
          :class="{ active: activeConfig === item.id }"
          @click="activeConfig = item.id"
        >
          {{ item.name }}
        </button>
      </div>
      <div class="config-content">
        <DepartmentManagement v-show="activeConfig === 'departments'" />
        <ReviewRules v-show="activeConfig === 'reviewRules'" />
        <PromptConfig v-show="activeConfig === 'prompts'" />
      </div>
    </div>

    <!-- Tab 3: 系统设置 -->
    <div v-show="activeTab === 'system'" class="tab-content">
      <div class="config-nav">
        <button
          v-for="item in systemItems"
          :key="item.id"
          class="config-nav-item"
          :class="{ active: activeSystem === item.id }"
          @click="activeSystem = item.id"
        >
          {{ item.name }}
        </button>
      </div>
      <div class="config-content">
        <AiEngineConfig v-show="activeSystem === 'aiEngine'" />
        <StorageManagement v-show="activeSystem === 'storage'" />
        <BasicSettings v-show="activeSystem === 'basicSettings'" />
        <AuditLogs v-show="activeSystem === 'audit'" />
        <FeedbackManagement v-if="isAdmin" v-show="activeSystem === 'feedback'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Monitor, Setting, Operation, Collection, ChatDotRound, DataBoard, Bell } from '@element-plus/icons-vue'
import { getDashboardStatsApi } from '@/api/dashboard'
import { useUserStore } from '@/stores/user'
import DepartmentManagement from './admin/DepartmentManagement.vue'
import ReviewRules from './ReviewRules.vue'
import PromptConfig from './PromptConfig.vue'
import AiEngineConfig from './admin/AiEngineConfig.vue'
import StorageManagement from './admin/StorageManagement.vue'
import BasicSettings from './admin/BasicSettings.vue'
import AuditLogs from './AuditLogs.vue'
import FeedbackManagement from './FeedbackManagement.vue'

const userStore = useUserStore()
const isAdmin = computed(() => userStore.isAdmin())

const tabs = [
  { key: 'health', label: '系统健康', icon: Monitor },
  { key: 'review-config', label: '审查配置', icon: Operation },
  { key: 'system', label: '系统设置', icon: Setting },
]

const activeTab = ref('health')
const activeConfig = ref('departments')
const activeSystem = ref('aiEngine')

const reviewConfigItems = [
  { id: 'departments', name: '部门与员工' },
  { id: 'reviewRules', name: '审查规则' },
  { id: 'prompts', name: '提示词模板' },
]

const systemItems = computed(() => {
  const items = [
    { id: 'aiEngine', name: 'AI 引擎' },
    { id: 'storage', name: '存储管理' },
    { id: 'basicSettings', name: '基础设置' },
    { id: 'audit', name: '审计日志' },
  ]
  if (isAdmin.value) items.push({ id: 'feedback', name: '反馈管理' })
  return items
})

// 系统健康数据
const serviceStatus = ref([
  { name: '后端 API', ok: true },
  { name: 'PostgreSQL', ok: true },
  { name: 'Redis', ok: true },
  { name: '文档解析服务', ok: true },
])

const metrics = ref([
  { label: '员工总数', value: '-' },
  { label: '审查规则', value: '-' },
  { label: '知识库文档', value: '-' },
  { label: '待处理反馈', value: '-' },
])

onMounted(async () => {
  try {
    const { data } = await getDashboardStatsApi()
    if (data?.overview) {
      const ov = data.overview
      metrics.value[0].value = String(ov.userCount ?? '-')
      metrics.value[1].value = String(ov.ruleCount ?? '-')
      metrics.value[2].value = String(ov.knowledgeDocCount ?? '-')
      metrics.value[3].value = String(ov.feedbackCount ?? '-')
    }
  } catch (e) {
    console.error('Failed to fetch stats', e)
  }
})
</script>

<style scoped>
.admin-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.admin-tabs {
  display: flex;
  gap: 4px;
  padding: 12px 20px 0;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  flex-shrink: 0;
}

.admin-tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 18px;
  border: none;
  background: transparent;
  color: #6b7280;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 8px 8px 0 0;
  transition: all 0.2s;
  border-bottom: 2px solid transparent;
}

.admin-tab-item:hover { color: #111827; background: #f9fafb; }
.admin-tab-item.active { color: #2563eb; border-bottom-color: #2563eb; background: #eff6ff; }

.tab-content {
  flex: 1;
  overflow: auto;
  padding: 20px;
}

/* 系统健康 */
.health-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 20px;
}

.health-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.health-card h3 {
  font-size: 15px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 16px;
}

.status-list { display: flex; flex-direction: column; gap: 12px; }

.status-item {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-dot.ok { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.4); }
.status-dot.error { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.4); }

.status-name { flex: 1; color: #374151; }
.status-val { font-size: 12px; color: #6b7280; }

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.metric { text-align: center; padding: 12px; background: #f9fafb; border-radius: 8px; }
.metric-value { font-size: 24px; font-weight: 700; color: #1f2937; }
.metric-label { font-size: 12px; color: #6b7280; margin-top: 4px; }

/* 快捷入口 */
.quick-links {
  background: #fff;
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

.quick-links h3 { font-size: 15px; font-weight: 600; color: #1f2937; margin: 0 0 16px; }

.links-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }

.quick-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-radius: 10px;
  background: #f9fafb;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
  color: #374151;
}

.quick-link:hover { background: #eff6ff; color: #2563eb; transform: translateY(-2px); }

/* 配置子导航 */
.config-nav {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.config-nav-item {
  padding: 8px 16px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  background: #fff;
  color: #374151;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.config-nav-item:hover { border-color: #93c5fd; color: #2563eb; }
.config-nav-item.active { background: #2563eb; color: #fff; border-color: #2563eb; }

.config-content {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
  min-height: 400px;
}

@media (max-width: 768px) {
  .health-grid { grid-template-columns: 1fr; }
  .links-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
