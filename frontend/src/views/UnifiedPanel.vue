<template>
  <div class="unified-panel">
    <section class="stats-panel">
      <div class="stat-card" v-for="stat in stats" :key="stat.label" @click="navigateTo(stat.route)">
        <div class="stat-icon" :class="stat.color">
          <el-icon><component :is="iconMap[stat.icon]" /></el-icon>
        </div>
        <div class="stat-content">
          <p class="stat-value">{{ stat.value }}</p>
          <p class="stat-label">{{ stat.label }}</p>
        </div>
        <div class="stat-trend" v-if="stat.trend !== null">
          <span :class="stat.trend >= 0 ? 'trend-up' : 'trend-down'">
            {{ stat.trend >= 0 ? '↑' : '↓' }}
          </span>
          <span>{{ Math.abs(stat.trend) }}%</span>
        </div>
      </div>
    </section>

    <section class="main-layout">
      <aside class="nav-sidebar">
        <div class="sidebar-header">
          <el-icon><Menu /></el-icon>
          <span>管理导航</span>
        </div>
        <nav class="nav-tree">
          <div
            v-for="group in navGroups"
            :key="group.id"
            class="nav-group"
          >
            <div class="group-header" @click="toggleGroup(group.id)">
              <el-icon :class="{ 'rotated': expandedGroups.includes(group.id) }">
                <ArrowDown v-if="expandedGroups.includes(group.id)" />
                <ArrowRight v-else />
              </el-icon>
              <el-icon><component :is="iconMap[group.icon]" /></el-icon>
              <span>{{ group.name }}</span>
            </div>
            <ul class="group-items" v-show="expandedGroups.includes(group.id)">
              <li
                v-for="item in group.items"
                :key="item.id"
                class="nav-item"
                :class="{ active: activeNav === item.id }"
                @click="selectNav(item)"
              >
                <el-icon><component :is="iconMap[item.icon]" /></el-icon>
                <span>{{ item.name }}</span>
                <el-badge v-if="item.badge" :value="item.badge" type="warning" />
              </li>
            </ul>
          </div>
        </nav>
      </aside>

      <main class="content-area">
        <div class="content-header">
          <div class="header-info">
            <h3>{{ currentNav?.name || '选择管理项' }}</h3>
            <p>{{ currentNav?.description || '请从左侧选择要管理的项目' }}</p>
          </div>
          <div class="header-breadcrumb">
            <el-breadcrumb separator="/">
              <el-breadcrumb-item>统一管理</el-breadcrumb-item>
              <el-breadcrumb-item v-if="currentGroup">{{ currentGroup.name }}</el-breadcrumb-item>
              <el-breadcrumb-item v-if="currentNav">{{ currentNav.name }}</el-breadcrumb-item>
            </el-breadcrumb>
          </div>
        </div>

        <div class="content-body">
          <!-- 动态加载现有组件 -->
          <component 
            v-if="activeComponent" 
            :is="activeComponent" 
            :key="activeNav"
            class="embedded-component"
          />
          
          <!-- 系统概览（保留自定义） -->
          <div v-else-if="activeNav === 'overview'" class="overview-content">
            <div class="overview-grid">
              <div class="overview-card" v-for="card in overviewCards" :key="card.title" @click="navigateTo(card.route)">
                <div class="card-header">
                  <el-icon><component :is="iconMap[card.icon]" /></el-icon>
                  <span>{{ card.title }}</span>
                </div>
                <div class="card-body">
                  <p class="card-value">{{ card.value }}</p>
                  <p class="card-desc">{{ card.description }}</p>
                </div>
                <div class="card-footer">
                  <span class="card-action">点击进入 →</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 空状态 -->
          <div v-else class="empty-content">
            <el-empty description="请从左侧导航选择要管理的项目" />
          </div>
        </div>
      </main>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, defineAsyncComponent, markRaw } from 'vue'
import {
  DataBoard, Refresh, Menu, ArrowDown, ArrowRight,
  OfficeBuilding, User, FolderOpened, Document, ChatDotRound, Clock,
  WarningFilled, CircleCheck, Setting, Files, Bell, Grid, MagicStick,
  Reading, Connection
} from '@element-plus/icons-vue'

const iconMap: Record<string, any> = {
  DataBoard, Refresh, Menu, ArrowDown, ArrowRight,
  OfficeBuilding, User, FolderOpened, Document, ChatDotRound, Clock,
  WarningFilled, CircleCheck, Setting, Files, Bell, Grid, MagicStick,
  Reading, Connection,
}

const expandedGroups = ref(['overview', 'organization', 'knowledge', 'ai', 'system', 'audit'])
const activeNav = ref('overview')

// 动态导入现有组件（懒加载）
const componentsMap: Record<string, any> = {
  // 组织与权限
  departments: markRaw(defineAsyncComponent(() => import('./admin/DepartmentManagement.vue'))),
  employees: markRaw(defineAsyncComponent(() => import('./admin/DepartmentManagement.vue'))),
  
  // 规范与知识
  standards: markRaw(defineAsyncComponent(() => import('./StandardLibrary/LocalStandardTab.vue'))),
  knowledge: markRaw(defineAsyncComponent(() => import('./admin/KnowledgeCategories.vue'))),
  rules: markRaw(defineAsyncComponent(() => import('./admin/RuleLibraries.vue'))),
  
  // 审查配置
  reviewRules: markRaw(defineAsyncComponent(() => import('./ReviewRules.vue'))),
  prompts: markRaw(defineAsyncComponent(() => import('./PromptConfig.vue'))),
  
  // 系统设置
  systemOverview: markRaw(defineAsyncComponent(() => import('./Dashboard.vue'))),
  aiEngine: markRaw(defineAsyncComponent(() => import('./admin/AiEngineConfig.vue'))),
  storage: markRaw(defineAsyncComponent(() => import('./admin/StorageManagement.vue'))),
  basicSettings: markRaw(defineAsyncComponent(() => import('./admin/BasicSettings.vue'))),
  
  // 治理与审计
  audit: markRaw(defineAsyncComponent(() => import('./AuditLogs.vue'))),
}

const activeComponent = computed(() => {
  return componentsMap[activeNav.value] || null
})

const navGroups = ref([
  {
    id: 'overview',
    name: '总览中心',
    icon: 'MagicStick',
    items: [
      { id: 'overview', name: '系统概览', icon: 'DataBoard', description: '查看系统整体运行状态和关键指标', route: '' },
    ]
  },
  {
    id: 'organization',
    name: '组织与权限',
    icon: 'OfficeBuilding',
    items: [
      { id: 'departments', name: '部门与员工', icon: 'User', description: '管理企业部门架构和员工账号', badge: '3' },
    ]
  },
  {
    id: 'knowledge',
    name: '规范与知识',
    icon: 'Files',
    items: [
      { id: 'standards', name: '标准库管理', icon: 'Reading', description: '管理各类标准文档、误报库和术语表' },
      { id: 'knowledge', name: '知识库管理', icon: 'FolderOpened', description: '管理知识库分类和文档' },
      { id: 'rules', name: '规则库管理', icon: 'Document', description: '管理审查规则和规则库' },
    ]
  },
  {
    id: 'review',
    name: '审查配置',
    icon: 'Setting',
    items: [
      { id: 'reviewRules', name: '审查规则', icon: 'MagicStick', description: '管理和配置审查规则' },
      { id: 'prompts', name: '提示词模板', icon: 'ChatDotRound', description: '管理AI提示词模板和版本' },
    ]
  },
  {
    id: 'system',
    name: '系统设置',
    icon: 'Connection',
    items: [
      { id: 'systemOverview', name: '系统总览', icon: 'DataBoard', description: '查看系统整体运行状态' },
      { id: 'aiEngine', name: 'AI 引擎', icon: 'WarningFilled', description: '管理AI模型、OCR、向量检索等配置' },
      { id: 'storage', name: '存储管理', icon: 'FolderOpened', description: '管理系统存储空间和文件' },
      { id: 'basicSettings', name: '基础设置', icon: 'Setting', description: '管理系统基础参数和配置' },
    ]
  },
  {
    id: 'audit',
    name: '治理与审计',
    icon: 'Clock',
    items: [
      { id: 'audit', name: '审计日志', icon: 'Document', description: '查看系统操作记录和审计追踪' },
    ]
  },
])

const currentNav = computed(() => {
  for (const group of navGroups.value) {
    const item = group.items.find(i => i.id === activeNav.value)
    if (item) return item
  }
  return null
})

const currentGroup = computed(() => {
  for (const group of navGroups.value) {
    if (group.items.some(i => i.id === activeNav.value)) {
      return group
    }
  }
  return null
})

// 统计数据（后续可接入API）
const stats = ref([
  { label: '部门数量', value: '12', icon: 'OfficeBuilding', color: 'blue', trend: 15, route: 'departments' },
  { label: '员工总数', value: '256', icon: 'User', color: 'green', trend: 8, route: 'departments' },
  { label: '标准文档', value: '158', icon: 'Reading', color: 'purple', trend: 23, route: 'standards' },
  { label: '审查规则', value: '89', icon: 'Document', color: 'orange', trend: -2, route: 'rules' },
  { label: '待处理反馈', value: '12', icon: 'ChatDotRound', color: 'red', trend: 5, route: '' },
  { label: '系统公告', value: '3', icon: 'Bell', color: 'blue', trend: 0, route: '' },
])

const overviewCards = ref([
  {
    title: '组织架构',
    value: '12 部门',
    description: '管理部门结构和员工信息',
    icon: 'OfficeBuilding',
    route: 'departments'
  },
  {
    title: '知识资源',
    value: '247 文档',
    description: '标准库、知识库、规则库',
    icon: 'Files',
    route: 'standards'
  },
  {
    title: 'AI 配置',
    value: '已启用',
    description: '模型、提示词、向量检索',
    icon: 'WarningFilled',
    route: 'aiEngine'
  },
  {
    title: '审计日志',
    value: '1,234 条',
    description: '近期操作记录和变更追踪',
    icon: 'Clock',
    route: 'audit'
  },
])

const toggleGroup = (groupId: string) => {
  const index = expandedGroups.value.indexOf(groupId)
  if (index > -1) {
    expandedGroups.value.splice(index, 1)
  } else {
    expandedGroups.value.push(groupId)
  }
}

const selectNav = (item: { id: string }) => {
  activeNav.value = item.id
}

const navigateTo = (route: string) => {
  if (route && componentsMap[route]) {
    activeNav.value = route
  }
}

const refreshCurrent = () => {
  // 触发当前组件刷新（通过 key 变化）
  activeNav.value = ''
  setTimeout(() => {
    activeNav.value = currentNav.value?.id || 'overview'
  }, 50)
}
</script>

<style scoped>
.unified-panel {
  min-height: 100vh;
  background: #f3f4f6;
  padding: 16px;
}

.stats-panel {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.stat-card {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  cursor: pointer;
  transition: all 0.2s ease;
}

.stat-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.1);
}

.stat-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
}

.stat-icon.blue { background: #dbeafe; color: #3b82f6; }
.stat-icon.green { background: #dcfce7; color: #22c55e; }
.stat-icon.purple { background: #ede9fe; color: #8b5cf6; }
.stat-icon.orange { background: #fef3c7; color: #f59e0b; }
.stat-icon.red { background: #fee2e2; color: #ef4444; }

.stat-content {
  flex: 1;
  min-width: 0;
}

.stat-value {
  font-size: 18px;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 2px;
  line-height: 1.2;
}

.stat-label {
  font-size: 12px;
  color: #9ca3af;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.stat-trend {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.trend-up { color: #22c55e; }
.trend-down { color: #ef4444; }

.main-layout {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 16px;
}

.nav-sidebar {
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  padding: 12px;
  height: fit-content;
  position: sticky;
  top: 16px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  font-weight: 600;
  color: #1f2937;
  border-bottom: 1px solid #f3f4f6;
  margin-bottom: 6px;
  font-size: 13px;
}

.nav-group {
  margin-bottom: 2px;
}

.group-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
  font-size: 13px;
  font-weight: 500;
  color: #374151;
}

.group-header:hover {
  background: #f3f4f6;
}

.group-header .rotated {
  transform: rotate(90deg);
  transition: transform 0.2s;
}

.group-items {
  margin: 0;
  padding: 0;
  list-style: none;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px 7px 28px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 12px;
  color: #6b7280;
}

.nav-item:hover {
  background: #f9fafb;
  color: #374151;
}

.nav-item.active {
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
  color: #3b82f6;
  font-weight: 500;
}

.content-area {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  min-height: 500px;
}

.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px;
  border-bottom: 1px solid #e5e7eb;
  flex-wrap: wrap;
  gap: 12px;
}

.header-info h3 {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
  margin: 0 0 4px;
}

.header-info p {
  font-size: 14px;
  color: #6b7280;
  margin: 0;
}

.header-breadcrumb {
  font-size: 13px;
}

.content-body {
  flex: 1;
  padding: 0;
  overflow-y: auto;
}

.embedded-component {
  width: 100%;
  min-height: 400px;
}

.overview-content {
  width: 100%;
  padding: 24px;
}

.overview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 20px;
}

.overview-card {
  background: linear-gradient(135deg, #f9fafb 0%, #f3f4f6 100%);
  border-radius: 16px;
  padding: 24px;
  border: 1px solid #e5e7eb;
  cursor: pointer;
  transition: all 0.3s ease;
}

.overview-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  border-color: #3b82f6;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  font-weight: 600;
  color: #374151;
}

.card-value {
  font-size: 28px;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 8px;
}

.card-desc {
  font-size: 14px;
  color: #6b7280;
  margin: 0 0 16px;
}

.card-footer {
  border-top: 1px solid #e5e7eb;
  padding-top: 12px;
  margin-top: 12px;
}

.card-action {
  font-size: 13px;
  color: #3b82f6;
  font-weight: 500;
}

.empty-content {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

@media (max-width: 1200px) {
  .main-layout {
    grid-template-columns: 180px 1fr;
  }
  .stats-panel {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .main-layout {
    grid-template-columns: 1fr;
  }
  .nav-sidebar {
    order: 2;
    position: static;
  }
  .content-area {
    order: 1;
  }
  .stats-panel {
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .stat-card {
    padding: 10px 12px;
  }
  .stat-value {
    font-size: 16px;
  }
}
</style>