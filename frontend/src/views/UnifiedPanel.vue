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
          <div class="status-card-header">
            <h3>服务状态</h3>
            <div class="status-actions">
              <span v-if="lastHealthCheck" class="last-check">{{ lastHealthCheck }}</span>
              <el-tooltip content="重新检测" placement="top">
                <el-button size="small" :icon="Refresh" circle :loading="healthLoading" @click="fetchHealth" />
              </el-tooltip>
            </div>
          </div>
          <div class="status-list">
            <div class="status-item" v-for="s in serviceStatus" :key="s.name">
              <span class="status-dot" :class="dotClass(s)"></span>
              <span class="status-name">{{ s.name }}</span>
              <el-tooltip v-if="s.error" :content="s.error" placement="top">
                <span class="status-val" :class="s.ok === false ? 'val-error' : ''">{{ statusText(s) }}</span>
              </el-tooltip>
              <span v-else class="status-val" :class="s.ok === false ? 'val-error' : ''">{{ statusText(s) }}</span>
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
          <div class="quick-link" @click="$router.push('/agent')">
            <el-icon :size="20"><MagicStick /></el-icon>
            <span>Agent 助手</span>
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
        <FeatureFlags v-if="isAdmin" v-show="activeSystem === 'featureFlags'" />
        <FeedbackManagement v-if="isAdmin" v-show="activeSystem === 'feedback'" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Monitor, Setting, Operation, Collection, ChatDotRound, DataBoard, Bell, Refresh } from '@element-plus/icons-vue'
import { getDashboardStatsApi, getSystemHealthApi } from '@/api/dashboard'
import { useUserStore } from '@/stores/user'
import DepartmentManagement from './admin/DepartmentManagement.vue'
import ReviewRules from './ReviewRules.vue'
import AiEngineConfig from './admin/AiEngineConfig.vue'
import StorageManagement from './admin/StorageManagement.vue'
import BasicSettings from './admin/BasicSettings.vue'
import FeatureFlags from './admin/FeatureFlags.vue'
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
]

const systemItems = computed(() => {
  const items = [
    { id: 'aiEngine', name: 'AI 引擎' },
    { id: 'storage', name: '存储管理' },
    { id: 'basicSettings', name: '基础设置' },
    { id: 'audit', name: '审计日志' },
  ]
  if (isAdmin.value) {
    items.push({ id: 'featureFlags', name: '功能管理' })
    items.push({ id: 'feedback', name: '反馈管理' })
  }
  return items
})

// 系统健康数据（实时探测，非写死）
interface ServiceStatusItem {
  name: string
  ok: boolean | null  // null = 检测中/未知
  error?: string
}

const serviceStatus = ref<ServiceStatusItem[]>([
  { name: '后端 API', ok: null },
  { name: 'PostgreSQL', ok: null },
  { name: 'Redis', ok: null },
  { name: 'OCR / 文档解析', ok: null },
  { name: 'MaxKB 知识库', ok: null },
])
const healthLoading = ref(false)
const lastHealthCheck = ref('')

// 拉取真实健康状态（后端 /api/all 实时探测各依赖服务）
async function fetchHealth() {
  healthLoading.value = true
  try {
    const res: any = await getSystemHealthApi()
    const svc = res?.data?.services || res?.services || {}
    // API 能正常响应即说明后端可用
    serviceStatus.value[0].ok = true
    serviceStatus.value[1].ok = svc.database?.status === 'ok'
    serviceStatus.value[1].error = svc.database?.error
    serviceStatus.value[2].ok = svc.queue?.status === 'healthy'
    serviceStatus.value[3].ok = svc.ocr?.status === 'ok'
    serviceStatus.value[3].error = svc.ocr?.error
    serviceStatus.value[4].ok = svc.maxkb?.status === 'ok'
    serviceStatus.value[4].error = svc.maxkb?.error
    lastHealthCheck.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
  } catch (e) {
    // 请求失败说明后端 API 不可用，其余服务状态未知
    serviceStatus.value[0].ok = false
    for (let i = 1; i < serviceStatus.value.length; i++) {
      serviceStatus.value[i].ok = null
      serviceStatus.value[i].error = undefined
    }
  } finally {
    healthLoading.value = false
  }
}

function dotClass(s: ServiceStatusItem) {
  if (s.ok === null) return 'checking'
  return s.ok ? 'ok' : 'error'
}

function statusText(s: ServiceStatusItem) {
  if (s.ok === null) return '检测中'
  return s.ok ? '正常' : '异常'
}

const metrics = ref([
  { label: '员工总数', value: '-' },
  { label: '审查规则', value: '-' },
  { label: '知识库文档', value: '-' },
  { label: '待处理反馈', value: '-' },
])

onMounted(async () => {
  fetchHealth()
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
  background: var(--bg-body);
}

/* === 顶部 Tab（2026-08-12：去毛玻璃，纯白表面 + 品牌蓝激活条） === */
.admin-tabs {
  display: flex;
  gap: var(--space-1);
  padding: var(--space-5) var(--space-8) 0;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--corp-border-light);
  flex-shrink: 0;
}

.admin-tab-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 11px 22px;
  border: none;
  background: transparent;
  color: var(--corp-text-secondary);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  transition: color var(--corp-transition-base), background var(--corp-transition-base), border-color var(--corp-transition-base);
  border-bottom: 2.5px solid transparent;
  position: relative;
}

.admin-tab-item:hover {
  color: var(--corp-text-primary);
  background: rgba(37, 99, 235, 0.04);
}

.admin-tab-item.active {
  color: var(--color-primary-700);
  border-bottom-color: var(--color-primary-600);
  background: var(--color-primary-50);
  font-weight: 600;
}

.tab-content {
  flex: 1;
  overflow: auto;
  padding: var(--space-8);
}

/* === 系统健康 === */
.health-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-6);
  margin-bottom: var(--space-8);
}

.health-card {
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  padding: var(--space-8);
  box-shadow: var(--shadow-card);
  transition: box-shadow var(--corp-transition-base);
}

.health-card:hover {
  box-shadow: var(--border-inset), 0 4px 12px rgba(15, 23, 42, 0.08);
}

.health-card h3 {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--corp-text-primary);
  margin: 0 0 18px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.health-card h3::before {
  content: '';
  width: 3px;
  height: 16px;
  background: var(--color-primary-600);
  border-radius: 2px;
}

.status-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-1);
}

.status-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.last-check {
  font-size: var(--text-sm);
  color: var(--corp-text-tertiary);
}

.status-list { display: flex; flex-direction: column; gap: var(--space-5); }

.status-item {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  font-size: 14px;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--bg-surface-hover);
  transition: background var(--corp-transition-fast);
}

.status-item:hover { background: var(--bg-surface-active); }

.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.ok {
  background: var(--color-success);
  box-shadow: 0 0 8px rgba(34,197,94,0.5);
  animation: pulse-green 2s infinite;
}

.status-dot.error {
  background: var(--color-danger);
  box-shadow: 0 0 8px rgba(239,68,68,0.5);
  animation: pulse-red 1.5s infinite;
}

.status-dot.checking {
  background: var(--corp-text-tertiary);
  animation: pulse-gray 1.2s infinite;
}

@keyframes pulse-gray {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

@keyframes pulse-green {
  0%, 100% { box-shadow: 0 0 4px rgba(34,197,94,0.4); }
  50% { box-shadow: 0 0 10px rgba(34,197,94,0.6); }
}

@keyframes pulse-red {
  0%, 100% { box-shadow: 0 0 4px rgba(239,68,68,0.4); }
  50% { box-shadow: 0 0 10px rgba(239,68,68,0.7); }
}

.status-name { flex: 1; color: var(--color-gray-700); font-weight: 500; }
.status-val { font-size: var(--text-sm); color: var(--corp-text-secondary); font-weight: 500; }
.status-val.val-error { color: var(--color-danger); cursor: help; }

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-5);
}

.metric {
  text-align: center;
  padding: 18px var(--space-4);
  background: var(--bg-surface-hover);
  border-radius: var(--radius-xl);
  border: 1px solid var(--corp-border-light);
  transition: transform var(--corp-transition-base), box-shadow var(--corp-transition-base);
}

.metric:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
}

.metric-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--color-primary-600);
}

.metric-label { font-size: var(--text-sm); color: var(--corp-text-secondary); margin-top: var(--space-1); font-weight: 500; }

/* === 快捷入口 === */
.quick-links {
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  padding: var(--space-8);
  box-shadow: var(--shadow-card);
}

.quick-links h3 {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--corp-text-primary);
  margin: 0 0 18px;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.quick-links h3::before {
  content: '';
  width: 3px;
  height: 16px;
  background: var(--color-primary-600);
  border-radius: 2px;
}

.links-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--space-5); }

.quick-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 20px var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--bg-surface-hover);
  border: 1px solid var(--corp-border-light);
  cursor: pointer;
  transition: background var(--corp-transition-base), color var(--corp-transition-base), transform var(--corp-transition-base), box-shadow var(--corp-transition-base), border-color var(--corp-transition-base);
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--color-gray-700);
}

.quick-link:hover {
  background: var(--color-primary-50);
  color: var(--color-primary-700);
  transform: translateY(-3px);
  box-shadow: 0 4px 12px rgba(37,99,235,0.12);
  border-color: var(--color-primary-200);
}

/* === 配置子导航：胶囊分段控件 === */
.config-nav {
  display: inline-flex;
  gap: var(--space-1);
  margin-bottom: var(--space-6);
  padding: var(--space-1);
  background: var(--bg-surface-active);
  border-radius: var(--radius-md);
  border: 1px solid var(--corp-border-light);
}

.config-nav-item {
  padding: 9px 20px;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--corp-text-secondary);
  font-size: var(--text-base);
  font-weight: 500;
  cursor: pointer;
  transition: color var(--corp-transition-base), background var(--corp-transition-base), box-shadow var(--corp-transition-base);
  position: relative;
}

.config-nav-item:hover {
  color: var(--corp-text-primary);
  background: var(--bg-surface);
}

.config-nav-item.active {
  background: var(--bg-surface);
  color: var(--color-primary-700);
  font-weight: 600;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.08);
}

.config-content {
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
  min-height: 400px;
  overflow: hidden;
}

@media (max-width: 768px) {
  .health-grid { grid-template-columns: 1fr; }
  .links-grid { grid-template-columns: repeat(2, 1fr); }
  .config-nav { flex-wrap: wrap; }
}
</style>
