<template>
  <el-container class="layout-container">
    <el-aside :width="sidebarCollapsed ? '64px' : 'var(--corp-sidebar-width)'" class="aside" :class="{ collapsed: sidebarCollapsed, 'sidebar-open': sidebarOpen }">
      <div class="logo" :class="{ 'logo-collapsed': sidebarCollapsed }" @click="goWorkspace" role="button" tabindex="0" @keydown.enter="goWorkspace" @keydown.space.prevent="goWorkspace">
        <div class="logo-icon-wrap">
          <img src="/logo.jpg" alt="Logo" class="logo-img" />
        </div>
        <div class="logo-text" v-show="!sidebarCollapsed">
          <h2>核审通</h2>
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
        <!-- ===== 鐢ㄦ埛鍔熻兘锛堟墍鏈夎鑹插彲瑙侊級===== -->
        <el-menu-item index="/workspace">
          <el-icon><DataBoard /></el-icon>
          <template #title><span>工作台</span></template>
        </el-menu-item>
        <el-menu-item index="/review">
          <el-icon><DocumentAdd /></el-icon>
          <template #title><span>智能审查</span></template>
        </el-menu-item>
        <el-menu-item index="/langchain/search">
          <el-icon><Search /></el-icon>
          <template #title><span>LC 知识检索</span></template>
        </el-menu-item>
        <el-menu-item index="/langchain/qa">
          <el-icon><ChatDotRound /></el-icon>
          <template #title><span>LC 智能问答</span></template>
        </el-menu-item>
        <el-menu-item index="/tasks">
          <el-icon><List /></el-icon>
          <template #title><span>我的任务</span></template>
        </el-menu-item>

        <div class="menu-divider" v-show="!sidebarCollapsed"></div>
        <el-menu-item index="/feedback">
          <el-icon><ChatLineRound /></el-icon>
          <template #title><span>反馈意见</span></template>
        </el-menu-item>
        <el-menu-item index="/announcements">
          <el-icon><Bell /></el-icon>
          <template #title><span>系统公告</span></template>
        </el-menu-item>

        <!-- ===== 管理后台锛圓DMIN/MANAGER 鍙锛屾姌鍙犲瓙鑿滃崟锛?==== -->
        <template v-if="userStore.isAdminOrManager()">
          <div class="menu-divider" v-show="!sidebarCollapsed"></div>
          <el-sub-menu index="/admin" popper-class="admin-submenu-popper">
            <template #title>
              <el-icon><Setting /></el-icon>
              <span>管理后台</span>
            </template>
            <el-menu-item-group title="统一管理">
              <el-menu-item index="/admin">
                <el-icon><Grid /></el-icon>
                <template #title><span>管理面板</span></template>
              </el-menu-item>
            </el-menu-item-group>
            <el-menu-item-group title="运营与监控">
              <el-menu-item index="/admin/dashboard">
                <el-icon><DataBoard /></el-icon>
                <template #title><span>数据看板</span></template>
              </el-menu-item>
              <el-menu-item index="/admin/feedback">
                <el-icon><ChatLineSquare /></el-icon>
                <template #title><span>反馈管理</span></template>
              </el-menu-item>
            </el-menu-item-group>
            <el-menu-item-group title="规范与知识">
              <el-menu-item index="/admin/standards">
                <el-icon><Reading /></el-icon>
                <template #title><span>标准库管理</span></template>
              </el-menu-item>
              <el-menu-item index="/admin/knowledge-categories">
                <el-icon><FolderOpened /></el-icon>
                <template #title><span>知识库管理</span></template>
              </el-menu-item>
              <el-menu-item index="/admin/rule-libraries">
                <el-icon><Notebook /></el-icon>
                <template #title><span>规则库管理</span></template>
              </el-menu-item>
            </el-menu-item-group>
            <el-menu-item-group title="审查配置">
              <el-menu-item index="/admin/rules">
                <el-icon><Operation /></el-icon>
                <template #title><span>审查规则</span></template>
              </el-menu-item>
              <el-menu-item index="/admin/prompts">
                <el-icon><Edit /></el-icon>
                <template #title><span>提示词模板</span></template>
              </el-menu-item>
            </el-menu-item-group>
            <el-menu-item-group title="系统设置">
              <el-menu-item index="/admin/system">
                <el-icon><Tools /></el-icon>
                <template #title><span>系统总览</span></template>
              </el-menu-item>
              <el-menu-item index="/admin/users">
                <el-icon><User /></el-icon>
                <template #title><span>部门与员工</span></template>
              </el-menu-item>
              <el-menu-item index="/admin/storage">
                <el-icon><FolderOpened /></el-icon>
                <template #title><span>存储管理</span></template>
              </el-menu-item>
              <el-menu-item index="/admin/ai-engine">
                <el-icon><Tools /></el-icon>
                <template #title><span>AI 引擎</span></template>
              </el-menu-item>
              <el-menu-item index="/admin/basic">
                <el-icon><Setting /></el-icon>
                <template #title><span>基础设置</span></template>
              </el-menu-item>
            </el-menu-item-group>
            <el-menu-item-group title="治理与审计">
              <el-menu-item index="/admin/audit">
                <el-icon><Document /></el-icon>
                <template #title><span>审计日志</span></template>
              </el-menu-item>
            </el-menu-item-group>
          </el-sub-menu>
        </template>
      </el-menu>

      <div class="collapse-btn" @click="sidebarCollapsed = !sidebarCollapsed">
        <el-icon :size="18">
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
            <span class="breadcrumb-item">{{ route.meta.title || '绯荤粺' }}</span>
          </div>
        </div>
        <div class="security-warning">
          <el-icon :size="14"><WarningFilled /></el-icon>
          <span>审查内容由 AI 生成，仅供参考。平台严禁处理、存储和传输涉密敏感信息。</span>
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
                <!-- 鐢ㄦ埛淇℃伅澶?-->
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
                  <el-icon><SwitchButton /></el-icon>退出登录                </el-dropdown-item>
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

    <!-- 修改登录账号对话框 -->
    <el-dialog v-model="usernameDialogVisible" title="修改登录账号" width="420px" destroy-on-close>
      <el-form ref="usernameFormRef" :model="usernameForm" :rules="usernameRules" label-width="100px">
        <el-form-item label="当前账号">
          <el-input :model-value="userStore.userInfo?.username" disabled />
        </el-form-item>
        <el-form-item label="新账号" prop="newUsername">
          <el-input v-model="usernameForm.newUsername" placeholder="请输入新登录账号" maxlength="50" show-word-limit />
        </el-form-item>
        <el-form-item label="登录密码" prop="password">
          <el-input v-model="usernameForm.password" type="password" show-password placeholder="请输入当前密码验证身份" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="usernameDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="usernameLoading" @click="submitUsernameChange">确认修改</el-button>
        </span>
      </template>
    </el-dialog>

    <GlobalSearch ref="globalSearchRef" />

    <AnnouncementPopup ref="announcementPopupRef" v-if="showAnnouncementPopup" />

    <NotificationCenter ref="notificationCenterRef" />

    <el-dialog v-model="showShortcutHelp" title="快捷键" width="520px">
      <el-table :data="shortcutsList" border size="small">
        <el-table-column label="快捷键" width="180" align="center">
          <template #default="{ row }">
            <kbd class="kbd">{{ row.keys }}</kbd>
          </template>
        </el-table-column>
        <el-table-column label="鍔熻兘" prop="desc" />
      </el-table>
      <template #footer>
        <el-button type="primary" @click="showShortcutHelp = false">知道了</el-button>
      </template>
    </el-dialog>

    <div v-if="isMobile && sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>
  </el-container>
</template>

<script setup lang="ts">
import { computed, ref, reactive, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import {
  DataBoard, DocumentAdd, List, Reading,
  Setting, Grid,
  Document, FullScreen, ArrowDown, Lock, SwitchButton,
  Fold, Expand, Search, QuestionFilled, Edit,
  Tools, Operation, WarningFilled, ChatDotRound, ChatLineRound, ChatLineSquare,
  Bell, FolderOpened, Notebook, User,
} from '@element-plus/icons-vue'
import { logoutApi, changePasswordApi, changeUsernameApi, loginApi } from '@/api/auth'
import GlobalSearch from '@/components/GlobalSearch.vue'
import AnnouncementPopup from '@/components/AnnouncementPopup.vue'
import NotificationCenter from '@/components/NotificationCenter.vue'
import { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts'
import { useAnnouncements } from '@/composables/useAnnouncements'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const activeMenu = computed(() => route.path)
const roleDisplayText = computed(() => {
  const role = userStore.userInfo?.role
  const map: Record<string, string> = { ADMIN: '系统管理员', MANAGER: '部门管理员', USER: '普通用户' }
  return map[role || ''] || userStore.userInfo?.departmentName || role || '普通用户'
})
const sidebarCollapsed = ref(localStorage.getItem('sidebar_collapsed') === 'true')
const sidebarOpen = ref(false)

watch(sidebarCollapsed, (val) => {
  localStorage.setItem('sidebar_collapsed', String(val))
})

// 监听其他页面通过 localStorage 发出的侧边栏控制信号
const onStorageChange = (e: StorageEvent) => {
  if (e.key === 'sidebar_collapsed' && e.newValue !== null) {
    sidebarCollapsed.value = e.newValue === 'true'
  }
}
onMounted(() => window.addEventListener('storage', onStorageChange))
onUnmounted(() => window.removeEventListener('storage', onStorageChange))

const globalSearchRef = ref<InstanceType<typeof GlobalSearch> | null>(null)
const showShortcutHelp = ref(false)

const goWorkspace = () => {
  router.push('/workspace')
}

// 系统公告
const announcementPopupRef = ref<InstanceType<typeof AnnouncementPopup> | null>(null)
const notificationCenterRef = ref<InstanceType<typeof NotificationCenter> | null>(null)
const {
  unreadCount: announcementUnreadCount,
  showAnnouncementPopup,
  checkAndShow: checkAnnouncements,
} = useAnnouncements()

const handleAnnouncementClick = () => {
  notificationCenterRef.value?.open()
}

const isMobile = ref(false)

const shortcutsList = [
  { keys: 'Ctrl + K', desc: '全局搜索' },
  { keys: 'Ctrl + N', desc: '智能审查' },
  { keys: 'Esc', desc: '关闭弹窗/返回' },
  { keys: '?', desc: '显示快捷键帮助' },
  { keys: 'Ctrl + S', desc: '保存当前编辑（表单页）' },
]

onMounted(() => {
  isMobile.value = window.innerWidth < 1024
  window.addEventListener('resize', () => {
    isMobile.value = window.innerWidth < 1024
    if (!isMobile.value) sidebarOpen.value = false
  })

  // 检查未读公告
  checkAnnouncements()
})

const { register } = useKeyboardShortcuts()

register({ key: 'k', label: '全局搜索', modifiers: { ctrl: true }, handler: () => globalSearchRef.value?.open() })
register({ key: 'n', label: '智能审查', modifiers: { ctrl: true }, handler: () => router.push('/review') })
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
    callback(new Error('两次输入密码不一致'))
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
  } else if (command === 'myTasks') {
    router.push('/tasks')
  } else if (command === 'myFeedbacks') {
    router.push('/feedback')
  } else if (command === 'changeUsername') {
    usernameDialogVisible.value = true
    usernameForm.newUsername = userStore.userInfo?.username || ''
    if (usernameFormRef.value) {
      usernameFormRef.value.resetFields()
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
        ElMessage.error(error?.response?.data?.message || '密码修改失败')
      } finally {
        passwordLoading.value = false
      }
    }
  })
}

// 修改登录账号
const usernameDialogVisible = ref(false)
const usernameLoading = ref(false)
const usernameFormRef = ref<FormInstance>()

const usernameForm = reactive({
  newUsername: '',
  password: '',
})

const usernameRules = reactive<FormRules>({
  newUsername: [
    { required: true, message: '请输入新登录账号', trigger: 'blur' },
    { min: 2, message: '账号长度不能小于2位', trigger: 'blur' },
    { max: 50, message: '账号长度不能超过50位', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]+$/, message: '账号只能包含字母、数字和下划线', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入当前密码验证身份', trigger: 'blur' },
  ],
})

const submitUsernameChange = async () => {
  if (!usernameFormRef.value) return
  await usernameFormRef.value.validate(async (valid) => {
    if (valid) {
      usernameLoading.value = true
      try {
        await changeUsernameApi({
          newUsername: usernameForm.newUsername,
          password: usernameForm.password,
        })
        ElMessage.success('登录账号修改成功')
        usernameDialogVisible.value = false
        // 鐢ㄦ柊璐﹀彿閲嶆柊鐧诲綍鍒锋柊鐢ㄦ埛淇℃伅
        const { data } = await loginApi({
          username: usernameForm.newUsername,
          password: usernameForm.password,
        })
        userStore.setToken(data.token)
        userStore.setUserInfo(data.user)
      } catch (error: any) {
        ElMessage.error(error?.response?.data?.message || '修改失败')
      } finally {
        usernameLoading.value = false
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

/* 内层容器：确保填充侧边栏右侧的所有空间 */
.layout-container > .el-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ===== 渚ц竟鏍?鈥?Near-black with subtle depth ===== */
.aside {
  background:
    linear-gradient(180deg, #0F0F0F 0%, #111111 30%, #111111 70%, #0D0D0D 100%);
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 10;
  transition: width 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
  border-right: 1px solid rgba(255, 255, 255, 0.04);
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
  .aside.sidebar-open { left: 0; }
  .sidebar-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 99;
  }
}

.aside.collapsed { width: 56px !important; }

@media (max-width: 1024px) {
  .aside.collapsed { left: -220px; }
  .aside.collapsed.sidebar-open { left: 0; }
}

.aside.collapsed .logo { justify-content: center; padding: 0; }

.logo {
  height: 52px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  color: #FFFFFF;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
  gap: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.logo[role="button"] {
  cursor: pointer;
}

.logo[role="button"]:focus-visible {
  outline: 2px solid rgba(96, 165, 250, 0.85);
  outline-offset: 2px;
}

.logo-icon-wrap {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.logo-img {
  width: 28px;
  height: 28px;
  object-fit: contain;
  border-radius: 6px;
}

.logo-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.logo h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.5px;
  color: #FFFFFF;
  white-space: nowrap;
  line-height: 1.3;
}

.menu-divider {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  margin: 8px 16px;
}

.menu {
  flex: 1;
  border-right: none;
  padding: 6px 0;
  overflow-y: auto;
}

/* 鑿滃崟椤?鈥?绱у噾銆佸乏渚ф縺娲绘寚绀烘潯 */
.clean-menu :deep(.el-menu-item.el-menu-item) {
  height: 40px;
  line-height: 40px;
  margin: 2px 8px;
  border-radius: 6px;
  font-weight: 500;
  font-size: 13px;
  padding-left: 16px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  border-left: none;
  position: relative;
}

.clean-menu :deep(.el-menu-item.el-menu-item::before) {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 20px;
  border-radius: 0 3px 3px 0;
  background: var(--color-primary-400);
  transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.clean-menu :deep(.el-menu-item.el-menu-item:hover) {
  background-color: rgba(255, 255, 255, 0.06);
  color: #E5E7EB;
}

.clean-menu :deep(.el-menu-item.el-menu-item:hover .el-icon) {
  color: #E5E7EB;
}

.clean-menu :deep(.el-menu-item.el-menu-item.is-active) {
  background-color: rgba(59, 130, 246, 0.12);
  color: #FFFFFF;
  font-weight: 600;
}

.clean-menu :deep(.el-menu-item.el-menu-item.is-active::before) {
  transform: translateY(-50%) scaleY(1);
}

.clean-menu :deep(.el-menu-item.el-menu-item.is-active .el-icon) {
  color: var(--color-primary-300);
}

.clean-menu :deep(.el-menu-item.el-menu-item .el-icon) {
  font-size: 17px;
  margin-right: 10px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  color: #8B93A0;
}

.clean-menu.el-menu--collapse {
  padding: 6px 0;
}

.clean-menu.el-menu--collapse :deep(.el-menu-item.el-menu-item) {
  padding: 0;
  justify-content: center;
  margin: 2px 6px;
  padding-left: 0;
}

.clean-menu.el-menu--collapse :deep(.el-menu-item.el-menu-item .el-icon) {
  margin-right: 0;
  font-size: 18px;
}

.clean-menu.el-menu--collapse :deep(.el-menu-item.el-menu-item.is-active .el-icon) {
  color: var(--color-primary-300);
}

.clean-menu.el-menu--collapse :deep(.el-menu-item.el-menu-item.is-active::before) {
  display: none;
}

/* 管理后台鎶樺彔瀛愯彍鍗?*/
.clean-menu :deep(.el-sub-menu .el-sub-menu__title) {
  height: 40px;
  line-height: 40px;
  margin: 2px 8px;
  border-radius: 6px;
  font-weight: 500;
  font-size: 13px;
  padding-left: 16px;
  color: #9CA3AF;
  border-left: none;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.clean-menu :deep(.el-sub-menu .el-sub-menu__title:hover) {
  background-color: rgba(255, 255, 255, 0.06);
  color: #E5E7EB;
}

.clean-menu :deep(.el-sub-menu .el-sub-menu__title .el-icon) {
  font-size: 17px;
  margin-right: 10px;
  color: #8B93A0;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.clean-menu :deep(.el-sub-menu.is-opened .el-sub-menu__title) {
  color: #FFFFFF;
}

.clean-menu :deep(.el-sub-menu.is-opened .el-sub-menu__title .el-icon) {
  color: var(--color-primary-300);
}

.clean-menu :deep(.el-sub-menu .el-menu) {
  background-color: rgba(0, 0, 0, 0.25);
  border-radius: 0 0 6px 6px;
  margin: 0 8px 4px;
  padding: 4px 0;
}

.clean-menu :deep(.el-sub-menu .el-menu .el-menu-item) {
  height: 34px;
  line-height: 34px;
  padding-left: 44px;
  font-size: 12px;
  margin: 1px 4px;
  border-left: none;
  border-radius: 4px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.clean-menu :deep(.el-sub-menu .el-menu .el-menu-item:hover) {
  background-color: rgba(255, 255, 255, 0.04);
  color: #E5E7EB;
}

.clean-menu :deep(.el-sub-menu .el-menu .el-menu-item .el-icon) {
  font-size: 14px;
  margin-right: 8px;
  color: #8B93A0;
}

.clean-menu :deep(.el-sub-menu .el-menu .el-menu-item.is-active) {
  background-color: rgba(59, 130, 246, 0.12);
  color: #FFFFFF;
}

.clean-menu.el-menu--collapse :deep(.el-sub-menu .el-sub-menu__title) {
  padding: 0;
  justify-content: center;
  margin: 2px 6px;
  padding-left: 0;
}

.clean-menu.el-menu--collapse :deep(.el-sub-menu .el-sub-menu__title .el-icon) {
  margin-right: 0;
  font-size: 18px;
}

.clean-menu.el-menu--collapse :deep(.el-sub-menu.is-opened .el-sub-menu__title .el-icon) {
  color: var(--color-primary-300);
}

.collapse-btn {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8B93A0;
  cursor: pointer;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}

.collapse-btn:hover {
  color: #D1D5DB;
  background-color: rgba(255, 255, 255, 0.04);
}

/* 澶撮儴 鈥?姣涚幓鐠冩晥鏋?*/
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

/* 瀹夊叏璀﹀憡 鈥?浣庤皟鑳跺泭 */
.security-warning {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 12px;
  background: #FEF3C7;
  border-radius: var(--radius-full);
  color: #92400E;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.security-warning .el-icon {
  color: #F59E0B;
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
  background: #111111;
  color: #FFFFFF;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
}

/* 涓嬫媺鑿滃崟鐢ㄦ埛淇℃伅澶?*/
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
  font-size: 11px;
  color: #6B7280;
  line-height: 1.3;
}

.dropdown-account {
  font-size: 11px;
  color: #9CA3AF;
  line-height: 1.3;
}

/* 主内容区（紧凑模式：为内容页最大化展示空间，使用flex填充剩余高度） */
.main-content {
  background-color: #F5F5F5;
  padding: 12px;
  overflow-y: auto; /* 允许内容滚动 */
  flex: 1; /* 关键：使用flex填充el-container的剩余空间 */
  min-height: 0; /* 允许在flex容器中正确收缩 */
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

<!-- 管理后台鎶樺彔寮瑰嚭鑿滃崟 鈥?闈?scoped锛坱eleported 鍒?body锛?-->
<style>
.admin-submenu-popper {
  background: #1A1A1A !important;
  border: 1px solid rgba(255, 255, 255, 0.08) !important;
  border-radius: 8px !important;
  padding: 4px 0 !important;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4) !important;
  min-width: 180px !important;
}

.admin-submenu-popper .el-menu--popup .el-menu-item {
  height: 36px !important;
  line-height: 36px !important;
  padding: 0 16px !important;
  font-size: 13px !important;
  color: #9CA3AF !important;
  background-color: transparent !important;
  border-radius: 4px !important;
  margin: 2px 6px !important;
  transition: all 0.15s ease !important;
}

.admin-submenu-popper .el-menu--popup .el-menu-item:hover {
  background-color: rgba(255, 255, 255, 0.06) !important;
  color: #E5E7EB !important;
}

.admin-submenu-popper .el-menu--popup .el-menu-item.is-active {
  background-color: rgba(59, 130, 246, 0.15) !important;
  color: #FFFFFF !important;
  font-weight: 600 !important;
}

.admin-submenu-popper .el-menu--popup .el-menu-item .el-icon {
  color: #8B93A0 !important;
  font-size: 16px !important;
  margin-right: 8px !important;
}

.admin-submenu-popper .el-menu--popup .el-menu-item.is-active .el-icon {
  color: var(--color-primary-300, #93C5FD) !important;
}

.admin-submenu-popper .el-menu--popup .el-menu-item:hover .el-icon {
  color: #D1D5DB !important;
}
</style>




