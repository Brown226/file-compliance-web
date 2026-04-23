<template>
  <el-container class="layout-container">
    <el-aside :width="sidebarCollapsed ? '64px' : 'var(--corp-sidebar-width)'" class="aside" :class="{ collapsed: sidebarCollapsed, 'sidebar-open': sidebarOpen }">
      <div class="logo" :class="{ 'logo-collapsed': sidebarCollapsed }">
        <div class="logo-icon-wrap">
          <svg class="logo-svg" viewBox="0 0 32 32" fill="none">
            <rect x="2" y="2" width="28" height="28" rx="8" fill="var(--color-primary-500)" />
            <path d="M10 16L14 20L22 12" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        <div class="logo-text" v-show="!sidebarCollapsed">
          <h2>智能审查系统</h2>
        </div>
      </div>

      <el-menu
        :default-active="activeMenu"
        class="menu clean-menu"
        :collapse="sidebarCollapsed"
        router
        background-color="transparent"
        text-color="#9CA3AF"
        active-text-color="#FFFFFF"
      >
        <!-- 常用功能 -->
        <div class="menu-group-label" v-show="!sidebarCollapsed">常用功能</div>
        <el-menu-item index="/dashboard">
          <el-icon><DataBoard /></el-icon>
          <template #title><span>监控</span></template>
        </el-menu-item>

        <!-- 任务管理 -->
        <div class="menu-divider" v-show="!sidebarCollapsed"></div>
        <div class="menu-group-label" v-show="!sidebarCollapsed">任务管理</div>
        <el-menu-item index="/tasks/new">
          <el-icon><DocumentAdd /></el-icon>
          <template #title><span>新建</span></template>
        </el-menu-item>
        <el-menu-item index="/tasks/history">
          <el-icon><List /></el-icon>
          <template #title><span>历史</span></template>
        </el-menu-item>

        <!-- 知识配置 - ADMIN/MANAGER -->
        <div class="menu-divider" v-show="!sidebarCollapsed"></div>
        <div class="menu-group-label" v-show="!sidebarCollapsed">知识配置</div>
        <el-menu-item v-if="userStore.isAdminOrManager()" index="/standards">
          <el-icon><Reading /></el-icon>
          <template #title><span>标准库</span></template>
        </el-menu-item>

        <!-- 系统配置 - ADMIN -->
        <div class="menu-divider" v-show="!sidebarCollapsed"></div>
        <div class="menu-group-label" v-show="!sidebarCollapsed">系统配置</div>
        <el-menu-item v-if="userStore.isAdmin()" index="/system">
          <el-icon><Tools /></el-icon>
          <template #title><span>系统管理</span></template>
        </el-menu-item>
        <el-menu-item v-if="userStore.isAdmin()" index="/llm-config">
          <el-icon><Connection /></el-icon>
          <template #title><span>LLM配置</span></template>
        </el-menu-item>
        <el-menu-item v-if="userStore.isAdmin()" index="/pipeline-config">
          <el-icon><Operation /></el-icon>
          <template #title><span>审查配置</span></template>
        </el-menu-item>

        <!-- 规则管理 - ADMIN -->
        <div class="menu-divider" v-show="!sidebarCollapsed"></div>
        <div class="menu-group-label" v-show="!sidebarCollapsed">规则管理</div>
        <el-menu-item v-if="userStore.isAdmin()" index="/review-rules">
          <el-icon><Setting /></el-icon>
          <template #title><span>审查规则</span></template>
        </el-menu-item>
        <el-menu-item v-if="userStore.isAdmin()" index="/regex-tool">
          <el-icon><Edit /></el-icon>
          <template #title><span>正则工具</span></template>
        </el-menu-item>

        <!-- 审计 - ADMIN -->
        <div class="menu-divider" v-show="!sidebarCollapsed"></div>
        <el-menu-item v-if="userStore.isAdmin()" index="/audit-logs">
          <el-icon><Document /></el-icon>
          <template #title><span>审计日志</span></template>
        </el-menu-item>
      </el-menu>

      <div class="collapse-btn" @click="sidebarCollapsed = !sidebarCollapsed">
        <el-icon :size="16">
          <Fold v-if="!sidebarCollapsed" />
          <Expand v-else />
        </el-icon>
      </div>
    </el-aside>

    <el-container>
      <el-header class="header">
        <div class="header-left">
          <div class="header-toggle" @click="sidebarOpen = !sidebarOpen" v-show="isMobile">
            <el-icon :size="20"><Fold /></el-icon>
          </div>
          <div class="breadcrumb">
            <span class="breadcrumb-item">{{ route.meta.title || '系统' }}</span>
          </div>
        </div>
        <div class="security-warning">
          <el-icon :size="14"><WarningFilled /></el-icon>
          <span>审查内容由AI审查，仅供参考！本平台严禁处理、存储和传递涉密敏感信息！</span>
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
          </div>
          <div class="header-divider"></div>
          <el-dropdown @command="handleCommand" trigger="click">
            <div class="user-info">
              <el-avatar :size="32" class="user-avatar">{{ userStore.userInfo?.username?.charAt(0).toUpperCase() || 'A' }}</el-avatar>
              <span class="username" v-show="!sidebarCollapsed">{{ userStore.userInfo?.username || 'Admin' }}</span>
              <el-icon class="arrow-icon" :size="12"><arrow-down /></el-icon>
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="changePassword">
                  <el-icon><Lock /></el-icon>修改密码
                </el-dropdown-item>
                <el-dropdown-item command="shortcuts" @click="showShortcutHelp = true">
                  <el-icon><QuestionFilled /></el-icon>快捷键
                </el-dropdown-item>
                <el-dropdown-item command="logout" divided class="text-danger">
                  <el-icon><SwitchButton /></el-icon>退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main-content">
        <router-view v-slot="{ Component }">
          <transition name="fade-slide" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>

    <el-dialog v-model="passwordDialogVisible" title="修改密码" width="420px" destroy-on-close>
      <el-form
        ref="passwordFormRef"
        :model="passwordForm"
        :rules="passwordRules"
        label-width="100px"
      >
        <el-form-item label="原密码" prop="oldPassword">
          <el-input v-model="passwordForm.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="passwordForm.newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input v-model="passwordForm.confirmPassword" type="password" show-password />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="passwordDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="passwordLoading" @click="submitPasswordChange">
            确认修改
          </el-button>
        </span>
      </template>
    </el-dialog>

    <GlobalSearch ref="globalSearchRef" />

    <el-dialog v-model="showShortcutHelp" title="⌨️ 快捷键" width="520px">
      <el-table :data="shortcutsList" border size="small">
        <el-table-column label="快捷键" width="180" align="center">
          <template #default="{ row }">
            <kbd class="kbd">{{ row.keys }}</kbd>
          </template>
        </el-table-column>
        <el-table-column label="功能" prop="desc" />
      </el-table>
      <template #footer>
        <el-button type="primary" @click="showShortcutHelp = false">知道了</el-button>
      </template>
    </el-dialog>

    <div v-if="isMobile && sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>
  </el-container>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  DataBoard, DocumentAdd, List, Reading,
  Setting,
  Document, FullScreen, ArrowDown, Lock, SwitchButton,
  Fold, Expand, Search, QuestionFilled, Edit,
  Tools, Connection, Operation, WarningFilled,
} from '@element-plus/icons-vue'
import { logoutApi, changePasswordApi } from '@/api/auth'
import GlobalSearch from '@/components/GlobalSearch.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const activeMenu = computed(() => route.path)
const sidebarCollapsed = ref(false)
const sidebarOpen = ref(false)

const globalSearchRef = ref<InstanceType<typeof GlobalSearch> | null>(null)
const showShortcutHelp = ref(false)

const isMobile = ref(false)

const shortcutsList = [
  { keys: 'Ctrl + K', desc: '全局搜索' },
  { keys: 'Ctrl + N', desc: '新建任务' },
  { keys: 'Esc', desc: '关闭弹窗/返回' },
  { keys: '?', desc: '显示快捷键帮助' },
  { keys: 'Ctrl + S', desc: '保存当前编辑 (表单页)' },
]

onMounted(() => {
  isMobile.value = window.innerWidth < 1024
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth < 1024
    if (!isMobile.value) sidebarOpen.value = false
  })
})

const { register } = useKeyboardShortcuts()

register({ key: 'k', label: '全局搜索', modifiers: { ctrl: true }, handler: () => globalSearchRef.value?.open() })
register({ key: 'n', label: '新建任务', modifiers: { ctrl: true }, handler: () => router.push('/tasks/new') })
register({ key: '?', label: '快捷键帮助', handler: () => showShortcutHelp.value = true })
register({ key: 'escape', label: '关闭', handler: () => {
  globalSearchRef.value?.close()
  showShortcutHelp.value = false
}})

const passwordDialogVisible = ref(false)
const passwordLoading = ref(false)
const passwordFormRef = ref<FormInstance>()

const passwordForm = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

const validateConfirmPassword = (_rule: any, value: string, callback: any) => {
  if (value === '') {
    callback(new Error('请再次输入新密码'))
  } else if (value !== passwordForm.newPassword) {
    callback(new Error('两次输入密码不一致!'))
  } else {
    callback()
  }
}

const passwordRules = reactive<FormRules>({
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 6, message: '密码长度不能小于6位', trigger: 'blur' }
  ],
  confirmPassword: [
    { required: true, validator: validateConfirmPassword, trigger: 'blur' }
  ]
})

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
    if (passwordFormRef.value) {
      passwordFormRef.value.resetFields()
    }
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

const submitPasswordChange = async () => {
  if (!passwordFormRef.value) return
  await passwordFormRef.value.validate(async (valid) => {
    if (valid) {
      passwordLoading.value = true
      try {
        await changePasswordApi({
          oldPassword: passwordForm.oldPassword,
          newPassword: passwordForm.newPassword,
        })
        ElMessage.success('密码修改成功，请重新登录')
        passwordDialogVisible.value = false
        userStore.logout()
        router.push('/login')
      } catch (error: any) {
      } finally {
        passwordLoading.value = false
      }
    }
  })
}
</script>

<style scoped>
.layout-container {
  height: 100vh;
  width: 100vw;
  background-color: var(--bg-body);
}

.aside {
  background: var(--color-gray-900);
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 10;
  box-shadow: 1px 0 3px rgba(0, 0, 0, 0.08);
  transition: width 0.2s ease;
  overflow: hidden;
}

@media (max-width: 1024px) {
  .aside {
    position: fixed;
    left: -220px;
    top: 0;
    bottom: 0;
    z-index: 100;
    width: var(--corp-sidebar-width) !important;
    transition: left 0.2s ease;
  }
  .aside.sidebar-open {
    left: 0;
  }
  .sidebar-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 99;
  }
}

.aside.collapsed {
  width: 64px !important;
}

@media (max-width: 1024px) {
  .aside.collapsed {
    left: -220px;
  }
  .aside.collapsed.sidebar-open {
    left: 0;
  }
}

.aside.collapsed .logo {
  justify-content: center;
  padding: 0;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 20px;
  color: var(--corp-text-inverse);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
  gap: var(--space-3);
}

.logo-icon-wrap {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-svg {
  width: 32px;
  height: 32px;
}

.logo-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.logo h2 {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  letter-spacing: 0.3px;
  color: var(--corp-text-inverse);
  white-space: nowrap;
  line-height: 1.3;
}

.menu-divider {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  margin: var(--space-2) var(--space-4);
}

.menu-group-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.25);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  padding: 4px 20px 2px;
  font-weight: 600;
  user-select: none;
}

.menu {
  flex: 1;
  border-right: none;
  padding: 8px 0;
  overflow-y: auto;
}

.clean-menu :deep(.el-menu-item.el-menu-item) {
  height: 44px;
  line-height: 44px;
  margin: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  font-weight: 400;
  font-size: var(--text-base);
  padding-left: 20px;
  transition: all 0.15s ease;
  position: relative;
  border-left: 3px solid transparent;
}

.clean-menu :deep(.el-menu-item.el-menu-item:hover) {
  background-color: rgba(255, 255, 255, 0.06);
  color: var(--color-gray-200);
}

.clean-menu :deep(.el-menu-item.el-menu-item:hover .el-icon) {
  color: var(--color-gray-200);
}

.clean-menu :deep(.el-menu-item.el-menu-item.is-active) {
  background-color: rgba(37, 99, 235, 0.15);
  color: var(--corp-text-inverse);
  border-left-color: var(--color-primary-500);
  box-shadow: none;
}

.clean-menu :deep(.el-menu-item.el-menu-item.is-active .el-icon) {
  color: var(--corp-text-inverse);
}

.clean-menu :deep(.el-menu-item.el-menu-item .el-icon) {
  font-size: 17px;
  margin-right: 10px;
  transition: color 0.15s ease;
}

.clean-menu.el-menu--collapse {
  padding: 8px 0;
}

.clean-menu.el-menu--collapse :deep(.el-menu-item.el-menu-item) {
  padding: 0;
  justify-content: center;
  margin: var(--space-1) 6px;
  padding-left: 0;
}

.clean-menu.el-menu--collapse :deep(.el-menu-item.el-menu-item .el-icon) {
  margin-right: 0;
}

.collapse-btn {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  color: rgba(255, 255, 255, 0.3);
  cursor: pointer;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  transition: all 0.15s;
  flex-shrink: 0;
  font-size: var(--text-sm);
}

.collapse-btn:hover {
  color: rgba(255, 255, 255, 0.7);
  background-color: rgba(255, 255, 255, 0.04);
}

.header {
  background-color: var(--bg-surface);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-6);
  height: 56px;
  z-index: 9;
  border-bottom: 1px solid var(--color-gray-200);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  gap: 16px;
}

.security-warning {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 14px;
  background: #fef2f2;
  border: 1px solid #fca5a5;
  border-radius: var(--radius-sm);
  color: #dc2626;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
  white-space: nowrap;
  flex-shrink: 0;
}

.security-warning .el-icon {
  color: #dc2626;
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
  gap: 12px;
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
  font-size: 15px;
  color: var(--corp-text-primary);
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.header-tools {
  display: flex;
  gap: var(--space-1);
}

.tool-icon-wrap {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--color-gray-600);
  cursor: pointer;
  transition: all 0.15s;
  position: relative;
}

.tool-icon-wrap:hover {
  background-color: var(--color-gray-100);
  color: var(--color-primary-500);
}

.badge-dot {
  position: absolute;
  top: 4px;
  right: 4px;
  min-width: 16px;
  height: 16px;
  border-radius: var(--radius-full);
  background: var(--color-danger);
  color: white;
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

.header-divider {
  width: 1px;
  height: 24px;
  background-color: var(--color-gray-200);
}

.user-info {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px 4px 4px;
  border-radius: var(--radius-sm);
  transition: background 0.15s;
}

.user-info:hover {
  background: var(--color-gray-100);
}

.username {
  color: var(--corp-text-primary);
  font-weight: 500;
  font-size: var(--text-sm);
  line-height: 1.2;
}

.arrow-icon {
  color: var(--color-gray-400);
}

.user-avatar {
  background: var(--color-primary-500);
  color: var(--corp-text-inverse);
  font-weight: 600;
  font-size: var(--text-sm);
  flex-shrink: 0;
}

.main-content {
  background-color: var(--bg-body);
  padding: var(--space-6);
  overflow-y: auto;
  min-height: calc(100vh - var(--corp-header-height));
}

@media (max-width: 1024px) {
  .main-content {
    padding: 12px;
  }
}

.text-danger.text-danger {
  color: var(--color-danger);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.kbd {
  font-size: var(--text-xs);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-gray-100);
  color: var(--color-gray-500);
  border: 1px solid var(--color-gray-200);
  font-family: inherit;
}
</style>
