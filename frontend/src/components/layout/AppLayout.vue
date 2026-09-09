<template>
  <el-container class="layout-container">
    <AppSidebar />

    <!-- 内层容器：显式 direction="vertical"，规避自定义组件无法被 el-container 识别为 ElHeader 的方向判断坑 -->
    <el-container direction="vertical">
      <AppHeader />

      <el-main class="main-content" :class="{ 'header-hidden': hideHeader }">
        <router-view v-slot="{ Component }">
          <transition name="fade-slide" mode="out-in" appear>
            <!-- Agent 对话页切出时缓存而非卸载：SSE 流与对话状态在切页期间持续存活，避免「一离开页面对话就中断」 -->
            <keep-alive include="AgentChat">
              <component :is="Component" />
            </keep-alive>
          </transition>
        </router-view>
      </el-main>
    </el-container>

    <AnnouncementPopup v-if="showAnnouncementPopup" />

    <div v-if="isMobile && sidebarOpen" class="sidebar-overlay" @click="sidebarOpen = false"></div>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useSystemConfigStore } from '@/stores/system-config'
import { useAnnouncements } from '@/composables/useAnnouncements'
import { useAppLayout } from '@/composables/useAppLayout'
import AnnouncementPopup from '@/components/AnnouncementPopup.vue'
import AppSidebar from './AppSidebar.vue'
import AppHeader from './AppHeader.vue'

const route = useRoute()
const systemConfigStore = useSystemConfigStore()

const { isMobile, sidebarOpen, initLayoutState } = useAppLayout()
const { showAnnouncementPopup, checkAndShow: checkAnnouncements } = useAnnouncements()

// 隐藏顶栏的页面（如 Agent 工作台：自身带顶栏，避免双层顶部栏堆叠）
const hideHeader = computed(() => !!route.meta.hideHeader)

onMounted(() => {
  initLayoutState()
  systemConfigStore.loadSystemName()
  checkAnnouncements()
})
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

@media (max-width: 1024px) {
  .sidebar-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 99;
  }
}

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

/* ===== 隐藏顶栏的页面（Agent 工作台等）：移除主内容区 padding，让页面满宽撑满 ===== */
.main-content.header-hidden {
  padding: 0 !important;
}

/* ===== 路由切换过渡 ===== */
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
</style>
