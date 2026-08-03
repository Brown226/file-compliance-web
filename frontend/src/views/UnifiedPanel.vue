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
import PromptConfig from './PromptConfig.vue'
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
  { id: 'prompts', name: '提示词模板' },
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
  background: #f8fafc;
}

/* === 顶部 Tab：毛玻璃 + 滑动指示器 === */
.admin-tabs {
  display: flex;
  gap: 2px;
  padding: 14px 24px 0;
  background: rgba(255,255,255,0.85);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(0,0,0,0.06);
  flex-shrink: 0;
}

.admin-tab-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 11px 22px;
  border: none;
  background: transparent;
  color: #64748b;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 10px 10px 0 0;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  border-bottom: 2.5px solid transparent;
  position: relative;
}

.admin-tab-item:hover {
  color: #1e293b;
  background: rgba(37, 99, 235, 0.04);
}

.admin-tab-item.active {
  color: #1d4ed8;
  border-bottom-color: #2563eb;
  background: linear-gradient(180deg, rgba(37,99,235,0.06) 0%, rgba(37,99,235,0.02) 100%);
  font-weight: 600;
}

.tab-content {
  flex: 1;
  overflow: auto;
  padding: 24px;
}

/* === 系统健康 === */
.health-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  margin-bottom: 24px;
}

.health-card {
  background: #fff;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);
  border: 1px solid rgba(0,0,0,0.04);
  transition: box-shadow 0.3s;
}

.health-card:hover {
  box-shadow: 0 4px 16px rgba(0,0,0,0.1);
}

.health-card h3 {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 18px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.health-card h3::before {
  content: '';
  width: 3px;
  height: 16px;
  background: linear-gradient(180deg, #2563eb, #7c3aed);
  border-radius: 2px;
}

.status-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.status-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.last-check {
  font-size: 12px;
  color: #94a3b8;
}

.status-list { display: flex; flex-direction: column; gap: 14px; }

.status-item {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 14px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #f8fafc;
  transition: background 0.2s;
}

.status-item:hover { background: #f1f5f9; }

.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.ok {
  background: #22c55e;
  box-shadow: 0 0 8px rgba(34,197,94,0.5);
  animation: pulse-green 2s infinite;
}

.status-dot.error {
  background: #ef4444;
  box-shadow: 0 0 8px rgba(239,68,68,0.5);
  animation: pulse-red 1.5s infinite;
}

.status-dot.checking {
  background: #94a3b8;
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

.status-name { flex: 1; color: #334155; font-weight: 500; }
.status-val { font-size: 12px; color: #64748b; font-weight: 500; }
.status-val.val-error { color: #ef4444; cursor: help; }

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 14px;
}

.metric {
  text-align: center;
  padding: 18px 12px;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.04);
  transition: transform 0.2s, box-shadow 0.2s;
}

.metric:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
}

.metric-value {
  font-size: 28px;
  font-weight: 800;
  background: linear-gradient(135deg, #1e40af, #7c3aed);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.metric-label { font-size: 12px; color: #64748b; margin-top: 6px; font-weight: 500; }

/* === 快捷入口 === */
.quick-links {
  background: #fff;
  border-radius: 16px;
  padding: 24px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);
  border: 1px solid rgba(0,0,0,0.04);
}

.quick-links h3 {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 18px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.quick-links h3::before {
  content: '';
  width: 3px;
  height: 16px;
  background: linear-gradient(180deg, #f59e0b, #ef4444);
  border-radius: 2px;
}

.links-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }

.quick-link {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 20px 12px;
  border-radius: 14px;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px solid rgba(0,0,0,0.04);
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  font-size: 13px;
  font-weight: 500;
  color: #475569;
}

.quick-link:hover {
  background: linear-gradient(135deg, #eff6ff 0%, #e0e7ff 100%);
  color: #1d4ed8;
  transform: translateY(-3px);
  box-shadow: 0 8px 20px rgba(37,99,235,0.15);
  border-color: rgba(37,99,235,0.2);
}

/* === 配置子导航：胶囊分段控件 === */
.config-nav {
  display: inline-flex;
  gap: 3px;
  margin-bottom: 20px;
  padding: 4px;
  background: #f1f5f9;
  border-radius: 12px;
  border: 1px solid rgba(0,0,0,0.04);
}

.config-nav-item {
  padding: 9px 20px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: #64748b;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.config-nav-item:hover {
  color: #1e293b;
  background: rgba(255,255,255,0.7);
}

.config-nav-item.active {
  background: #fff;
  color: #1d4ed8;
  font-weight: 600;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
}

.config-content {
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 4px 12px rgba(0,0,0,0.04);
  border: 1px solid rgba(0,0,0,0.04);
  min-height: 400px;
  overflow: hidden;
}

@media (max-width: 768px) {
  .health-grid { grid-template-columns: 1fr; }
  .links-grid { grid-template-columns: repeat(2, 1fr); }
  .config-nav { flex-wrap: wrap; }
}
</style>
