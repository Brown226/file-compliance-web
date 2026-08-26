<template>
  <div class="admin-page">
    <!-- 顶部主导航 Tab -->
    <div class="admin-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="admin-tab-item"
        :class="{ active: activeTab === tab.key }"
        role="tab"
        :aria-selected="activeTab === tab.key"
        @click="activeTab = tab.key"
      >
        <el-icon :size="16"><component :is="tab.icon" /></el-icon>
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <!-- Tab 1: 系统健康 -->
    <div v-show="activeTab === 'health'" class="tab-content">
      <PageIntro :title="pageIntro.title" :description="pageIntro.description" />

      <div class="health-grid">
        <AdminPanel title="服务状态">
          <template #actions>
            <span v-if="lastHealthCheck" class="last-check">最近检测 {{ lastHealthCheck }}</span>
            <el-tooltip content="重新检测" placement="top">
              <el-button size="small" :icon="Refresh" circle :loading="healthLoading" @click="fetchHealth" />
            </el-tooltip>
          </template>
          <div class="status-list">
            <div class="status-item" v-for="s in serviceStatus" :key="s.name" :class="{ 'is-error': s.ok === false }">
              <span class="status-dot" :class="dotClass(s)"></span>
              <span class="status-name">{{ s.name }}</span>
              <el-tooltip v-if="s.error" :content="s.error" placement="top">
                <span class="status-val" :class="{ 'val-error': s.ok === false }">{{ statusText(s) }}</span>
              </el-tooltip>
              <span v-else class="status-val" :class="{ 'val-error': s.ok === false }">{{ statusText(s) }}</span>
            </div>
          </div>
        </AdminPanel>

        <AdminPanel title="关键指标">
          <div class="metrics-grid">
            <div class="metric" v-for="m in metrics" :key="m.label">
              <div class="metric-value">{{ m.value }}</div>
              <div class="metric-label">{{ m.label }}</div>
            </div>
          </div>
        </AdminPanel>
      </div>
    </div>

    <!-- Tab 2: 审查配置 -->
    <div v-show="activeTab === 'review-config'" class="tab-content">
      <PageIntro :title="pageIntro.title" :description="pageIntro.description" />

      <div class="config-nav" role="tablist">
        <button
          v-for="item in reviewConfigItems"
          :key="item.id"
          class="config-nav-item"
          :class="{ active: activeConfig === item.id }"
          role="tab"
          :aria-selected="activeConfig === item.id"
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
      <PageIntro :title="pageIntro.title" :description="pageIntro.description" />

      <div class="config-nav" role="tablist">
        <button
          v-for="item in systemItems"
          :key="item.id"
          class="config-nav-item"
          :class="{ active: activeSystem === item.id }"
          role="tab"
          :aria-selected="activeSystem === item.id"
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
import { Monitor, Setting, Operation, Refresh } from '@element-plus/icons-vue'
import { getDashboardStatsApi, getSystemHealthApi } from '@/api/dashboard'
import { useUserStore } from '@/stores/user'
import PageIntro from '@/components/admin/PageIntro.vue'
import AdminPanel from '@/components/admin/AdminPanel.vue'
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

/** 当前页签的页头文案（PageIntro） */
const pageIntro = computed(() => {
  const map: Record<string, { title: string; description: string }> = {
    health: {
      title: '运行状态一览',
      description: '后端 API 与各依赖服务的实时健康度，以及平台关键数据概览',
    },
    'review-config': {
      title: '审查配置',
      description: '管理组织架构、员工账号与审查规则，在此统一维护审查基准',
    },
    system: {
      title: '系统设置',
      description: '配置 AI 引擎、存储、基础参数，并查看审计日志与反馈',
    },
  }
  return map[activeTab.value]
})

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
  ok: boolean | null  // null = 未知（探测不可达或未完成）
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
  if (s.ok === null) return healthLoading.value ? 'checking' : 'unknown'
  return s.ok ? 'ok' : 'error'
}

function statusText(s: ServiceStatusItem) {
  // 探测进行中才是「检测中」；探测完成后仍为 null 说明该服务不可达
  if (s.ok === null) return healthLoading.value ? '检测中' : '不可达'
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
.admin-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-body);
}

/* === 顶部主导航 Tab：通栏白条 + 激活项粘连内容区 + 顶部品牌蓝指示线 === */
.admin-tabs {
  display: flex;
  gap: var(--space-1);
  padding: 2px var(--space-8) 0;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--corp-border-light);
  flex-shrink: 0;
}

.admin-tab-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 22px 12px;
  border: none;
  border-top: 1px solid transparent;
  background: transparent;
  color: var(--corp-text-secondary);
  font-size: var(--text-base);
  font-weight: 500;
  cursor: pointer;
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  position: relative;
  transition: color var(--corp-transition-base), background var(--corp-transition-base);
}

.admin-tab-item:hover {
  color: var(--corp-text-primary);
  background: var(--bg-surface-hover);
}

.admin-tab-item.active {
  color: var(--color-primary-700);
  background: var(--bg-body);
  border-top-color: var(--corp-border-light);
  font-weight: 600;
}

/* 激活项顶部品牌蓝指示线 */
.admin-tab-item.active::before {
  content: '';
  position: absolute;
  top: -2px;
  left: 16px;
  right: 16px;
  height: 2px;
  border-radius: 0 0 2px 2px;
  background: linear-gradient(90deg, var(--color-primary-600), var(--color-primary-400));
}

.tab-content {
  flex: 1;
  overflow: auto;
  padding: var(--space-6) var(--space-8) var(--space-8);
}

/* === 系统健康 === */
.health-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-6);
  margin-bottom: var(--space-6);
}

.last-check {
  font-size: var(--text-sm);
  color: var(--corp-text-tertiary);
  margin-right: var(--space-1);
}

/* 服务状态行 */
.status-list { display: flex; flex-direction: column; gap: var(--space-2); }

.status-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-base);
  padding: 9px var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  background: var(--bg-surface-hover);
  transition: background var(--corp-transition-fast), border-color var(--corp-transition-fast);
}

.status-item:hover { background: var(--bg-surface-active); }

/* 异常行：整行浅红提示 */
.status-item.is-error {
  background: var(--color-danger-bg);
  border-color: rgba(239, 68, 68, 0.18);
}

.status-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex-shrink: 0;
}

.status-dot.ok {
  background: var(--color-success);
  animation: pulse-green 2s infinite;
}

.status-dot.error {
  background: var(--color-danger);
  animation: pulse-red 1.5s infinite;
}

.status-dot.checking {
  background: var(--corp-text-tertiary);
  animation: pulse-gray 1.2s infinite;
}

/* 不可达：定格灰点，不做「检测中」的闪烁假象 */
.status-dot.unknown {
  background: var(--corp-text-tertiary);
}

@keyframes pulse-gray {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

@keyframes pulse-green {
  0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.45); }
  50% { box-shadow: 0 0 0 4px rgba(34, 197, 94, 0); }
}

@keyframes pulse-red {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45); }
  50% { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0); }
}

.status-name {
  flex: 1;
  color: var(--color-gray-700);
  font-weight: 500;
}

.status-item.is-error .status-name {
  color: var(--color-danger-text);
}

.status-val {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  font-weight: 500;
}

.status-val.val-error {
  color: var(--color-danger);
  cursor: help;
}

/* 关键指标：单行汇总条（只留数字与标签，不做卡片） */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
}

.metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-value {
  font-size: 20px;
  font-weight: 600;
  line-height: 1.2;
  color: var(--corp-text-primary);
  font-variant-numeric: tabular-nums;
}

.metric-label {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
}

/* === 配置子导航：分段控件（灰底容器 + 白底激活，与内层导航统一） === */
/* 激活态不再用实心品牌蓝——「实心蓝」留给真正的操作按钮（保存/测试），
   导航层级靠位置与缩进区分，视觉语言统一为「灰底胶囊 + 白底浮起项」。 */
.config-nav {
  display: inline-flex;
  gap: var(--space-1);
  padding: var(--space-1);
  margin-bottom: var(--space-5);
  background: var(--color-gray-100);
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
}

.config-nav-item {
  padding: 8px 20px;
  border: none;
  border-radius: var(--radius-lg);
  background: transparent;
  color: var(--corp-text-secondary);
  font-size: var(--text-base);
  font-weight: 500;
  cursor: pointer;
  transition: color var(--corp-transition-base), background var(--corp-transition-base), box-shadow var(--corp-transition-base);
}

.config-nav-item:hover {
  color: var(--corp-text-primary);
  background: var(--bg-surface-hover);
}

.config-nav-item.active {
  background: var(--bg-surface);
  color: var(--color-primary-600);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(15, 23, 42, 0.06);
}

/* 配置内容舞台：白卡容器 */
.config-content {
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-card);
  min-height: 420px;
  overflow: hidden;
}

@media (max-width: 768px) {
  .admin-tabs { padding-left: var(--space-4); padding-right: var(--space-4); }
  .tab-content { padding: var(--space-5) var(--space-4); }
  .metrics-grid { grid-template-columns: repeat(2, 1fr); }
  .config-nav { flex-wrap: wrap; }
}
</style>
