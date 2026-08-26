<template>
  <el-header v-if="!hideHeader" class="header">
    <div class="header-left">
      <div class="header-toggle" @click="sidebarOpen = !sidebarOpen" v-show="isMobile">
        <el-icon :size="20"><Fold /></el-icon>
      </div>
      <div v-if="isAdminSubRoute" class="admin-back-btn" @click="router.push('/admin')">
        <el-icon :size="14"><ArrowLeft /></el-icon>
        <span>管理后台</span>
      </div>
      <div class="breadcrumb">
        <span class="breadcrumb-item">{{ route.meta.title || '系统' }}</span>
      </div>
    </div>
    <div class="security-warning" v-if="!warningDismissed">
      <el-icon :size="14" color="#E6A23C"><WarningFilled /></el-icon>
      <span class="warning-text">
        <strong>AI 辅助审查</strong> · 生成内容仅供参考
        <span class="security-detail">· 平台严禁处理、存储和传输涉密敏感信息。请确保上传的文档符合安全规定。</span>
      </span>
      <el-icon
        class="warning-close"
        :size="14"
        @click="warningDismissed = true"
      >
        <Close />
      </el-icon>
    </div>
    <div class="header-right">
      <div class="header-tools">
        <el-tooltip content="全局搜索 (Ctrl+K)" placement="bottom">
          <div class="tool-icon-wrap" @click="globalSearchRef?.open()">
            <el-icon :size="18"><Search /></el-icon>
          </div>
        </el-tooltip>
        <el-tooltip content="全屏" placement="bottom">
          <div class="tool-icon-wrap" @click="toggleFullscreen">
            <el-icon :size="18"><FullScreen /></el-icon>
          </div>
        </el-tooltip>
        <el-tooltip content="快捷键 (?)" placement="bottom">
          <div class="tool-icon-wrap" @click="showShortcutHelp = true">
            <el-icon :size="18"><QuestionFilled /></el-icon>
          </div>
        </el-tooltip>
        <el-tooltip content="系统公告" placement="bottom">
          <div class="tool-icon-wrap" @click="handleAnnouncementClick" style="position: relative;">
            <el-icon :size="18"><Bell /></el-icon>
            <span v-if="announcementUnreadCount > 0" class="badge-dot">{{ announcementUnreadCount > 9 ? '9+' : announcementUnreadCount }}</span>
          </div>
        </el-tooltip>
      </div>
      <div class="header-divider"></div>
      <el-dropdown @command="handleCommand" trigger="click">
        <div class="user-info">
          <el-avatar :size="32" class="user-avatar">{{ userStore.userInfo?.name?.charAt(0).toUpperCase() || 'A' }}</el-avatar>
          <span class="username" v-show="!sidebarCollapsed">{{ userStore.userInfo?.name || userStore.userInfo?.username || 'Admin' }}</span>
          <el-icon class="arrow-icon" :size="12"><arrow-down /></el-icon>
        </div>
        <template #dropdown>
          <el-dropdown-menu>
            <div class="dropdown-user-header">
              <el-avatar :size="40" class="dropdown-avatar">{{ userStore.userInfo?.name?.charAt(0).toUpperCase() || 'A' }}</el-avatar>
              <div class="dropdown-user-meta">
                <span class="dropdown-username">{{ userStore.userInfo?.name || userStore.userInfo?.username || 'Admin' }}</span>
                <span class="dropdown-role">{{ roleDisplayText }}</span>
                <span class="dropdown-account">账号：{{ userStore.userInfo?.username }}</span>
              </div>
            </div>
            <el-dropdown-item command="myTasks">
              <el-icon><List /></el-icon>我的任务
            </el-dropdown-item>
            <el-dropdown-item command="myFeedbacks">
              <el-icon><ChatLineRound /></el-icon>我的反馈
            </el-dropdown-item>
            <el-dropdown-item command="changeUsername">
              <el-icon><Edit /></el-icon>修改登录账号
            </el-dropdown-item>
            <el-dropdown-item command="changePassword">
              <el-icon><Lock /></el-icon>修改密码
            </el-dropdown-item>
            <el-dropdown-item command="logout" divided class="text-danger">
              <el-icon><SwitchButton /></el-icon>退出登录
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
  </el-header>

  <!-- ===== 顶栏触发的全局浮层 ===== -->
  <GlobalSearch ref="globalSearchRef" />
  <NotificationCenter ref="notificationCenterRef" />
  <ChangePasswordDialog v-model="passwordDialogVisible" />
  <ChangeUsernameDialog v-model="usernameDialogVisible" />
  <ShortcutHelpDialog v-model="showShortcutHelp" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowDown, ArrowLeft, Bell, ChatLineRound, Close,
  Edit, Fold, FullScreen, List, Lock, QuestionFilled,
  Search, SwitchButton, WarningFilled,
} from '@element-plus/icons-vue'
import { logoutApi } from '@/api/auth'
import { useUserStore } from '@/stores/user'
import { useAppLayout } from '@/composables/useAppLayout'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useAnnouncements } from '@/composables/useAnnouncements'
import GlobalSearch from '@/components/GlobalSearch.vue'
import NotificationCenter from '@/components/NotificationCenter.vue'
import ChangePasswordDialog from './dialogs/ChangePasswordDialog.vue'
import ChangeUsernameDialog from './dialogs/ChangeUsernameDialog.vue'
import ShortcutHelpDialog from './dialogs/ShortcutHelpDialog.vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const { sidebarCollapsed, sidebarOpen, isMobile, warningDismissed } = useAppLayout()
const { unreadCount: announcementUnreadCount } = useAnnouncements()

// 隐藏顶栏的页面（如 Agent 工作台：自身带顶栏，避免双层顶部栏堆叠）
const hideHeader = computed(() => !!route.meta.hideHeader)
const isAdminSubRoute = computed(() => route.path.startsWith('/admin/') && route.path !== '/admin')

const roleDisplayText = computed(() => {
  const role = userStore.userInfo?.role
  // role 历史兼容：接口可能返回数组（UserRole | UserRole[]），数组取第一个角色展示
  const roleStr = Array.isArray(role) ? role[0] : (role || '')
  const map: Record<string, string> = { ADMIN: '系统管理员', MANAGER: '部门管理员', USER: '普通用户' }
  return map[roleStr] || userStore.userInfo?.departmentName || roleStr || '普通用户'
})

const globalSearchRef = ref<InstanceType<typeof GlobalSearch> | null>(null)
const notificationCenterRef = ref<InstanceType<typeof NotificationCenter> | null>(null)

const showShortcutHelp = ref(false)
const passwordDialogVisible = ref(false)
const usernameDialogVisible = ref(false)

const handleAnnouncementClick = () => {
  notificationCenterRef.value?.open()
}

const toggleFullscreen = () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen()
  } else {
    document.exitFullscreen()
  }
}

const handleCommand = (command: string) => {
  if (command === 'changePassword') {
    passwordDialogVisible.value = true
  } else if (command === 'myTasks') {
    router.push('/tasks')
  } else if (command === 'myFeedbacks') {
    router.push('/feedback')
  } else if (command === 'changeUsername') {
    usernameDialogVisible.value = true
  } else if (command === 'logout') {
    ElMessageBox.confirm('确认退出登录吗?', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    }).then(async () => {
      try {
        await logoutApi()
      } catch (e) {
      }
      userStore.logout()
      ElMessage.success('已退出登录')
      router.push('/login')
    }).catch(() => {})
  }
}

// ===== 全局快捷键 =====
const { register } = useKeyboardShortcuts()

register({ key: 'k', label: '全局搜索', modifiers: { ctrl: true }, handler: () => globalSearchRef.value?.open() })
register({ key: 'n', label: '智能审查', modifiers: { ctrl: true }, handler: () => router.push('/review') })
register({ key: '?', label: '快捷键帮助', handler: () => showShortcutHelp.value = true })
register({ key: 'escape', label: '关闭', handler: () => {
  globalSearchRef.value?.close()
  showShortcutHelp.value = false
}})
</script>

<style scoped>
/* ===== 顶部栏：毛玻璃效果 ===== */
.header {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: var(--corp-header-height);
  z-index: 9;
  box-shadow: inset 0 -1px 0 #E5E7EB;
  gap: 16px;
}

/* 安全警告：低调胶囊 */
.security-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  background: var(--bg-surface-hover);
  border: 1px solid var(--corp-border-light);
  border-radius: 20px;
  color: var(--corp-text-secondary);
  font-size: 12px;
  white-space: normal;
  flex-shrink: 0;
  transition: all 0.3s ease;
  max-width: 800px;
}

.security-warning:hover {
  border-color: var(--corp-border);
}

.warning-text {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  overflow: hidden;
}

.warning-text strong {
  color: var(--corp-text-primary);
  font-weight: 600;
}

.security-detail {
  color: var(--corp-text-tertiary);
  font-size: 12px;
  margin-left: 4px;
}

.warning-close {
  cursor: pointer;
  color: var(--corp-text-tertiary);
  transition: color 0.2s;
  flex-shrink: 0;
  margin-left: 4px;
}

.warning-close:hover {
  color: var(--corp-text-primary);
}

.security-warning .el-icon:first-child {
  flex-shrink: 0;
}

@media (max-width: 1024px) {
  .header {
    padding: 0 12px;
  }
  .username {
    display: none !important;
  }
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-toggle {
  display: none;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--color-gray-600);
  border-radius: var(--radius-sm);
}

.header-toggle:hover {
  background: var(--color-gray-100);
}

@media (max-width: 1024px) {
  .header-toggle {
    display: flex;
  }
}

.breadcrumb {
  display: flex;
  align-items: center;
}

.breadcrumb-item {
  font-size: 14px;
  color: #111827;
  font-weight: 700;
}

.admin-back-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-primary-500);
  transition: all 0.15s;
  white-space: nowrap;
}

.admin-back-btn:hover {
  background: var(--color-primary-50);
  color: var(--color-primary-600);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-tools {
  display: flex;
  gap: 2px;
}

.tool-icon-wrap {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: #6B7280;
  cursor: pointer;
  transition: all 0.12s;
  position: relative;
}

.tool-icon-wrap:hover {
  background-color: #F5F5F5;
  color: #111827;
}

.badge-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 15px;
  height: 15px;
  border-radius: var(--radius-full);
  background: #EF4444;
  color: white;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 3px;
}

.header-divider {
  width: 1px;
  height: 20px;
  background-color: #E5E7EB;
}

.user-info {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px 3px 3px;
  border-radius: var(--radius-md);
  transition: background 0.12s;
}

.user-info:hover {
  background: #F5F5F5;
}

.username {
  color: #111827;
  font-weight: 600;
  font-size: 12px;
  line-height: 1.2;
}

.arrow-icon {
  color: #9CA3AF;
}

.user-avatar {
  background: var(--color-primary-600);
  color: #FFFFFF;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
}

/* 下拉菜单用户信息头部 */
.dropdown-user-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid #E5E7EB;
  margin-bottom: 4px;
}

.dropdown-avatar {
  background: #111111;
  color: #FFFFFF;
  font-weight: 700;
  font-size: 14px;
  flex-shrink: 0;
}

.dropdown-user-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dropdown-username {
  font-size: 14px;
  font-weight: 700;
  color: #111827;
  line-height: 1.3;
}

.dropdown-role {
  font-size: 12px;
  color: #6B7280;
  line-height: 1.3;
}

.dropdown-account {
  font-size: 12px;
  color: #9CA3AF;
  line-height: 1.3;
}

.text-danger.text-danger {
  color: var(--color-danger);
}
</style>
