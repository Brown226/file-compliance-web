<template>
  <el-aside
    :width="sidebarCollapsed ? '64px' : 'var(--corp-sidebar-width)'"
    class="aside"
    :class="{ collapsed: sidebarCollapsed, 'sidebar-open': sidebarOpen }"
  >
    <div
      class="logo"
      :class="{ 'logo-collapsed': sidebarCollapsed }"
      @click="goWorkspace"
      role="button"
      tabindex="0"
      @keydown.enter="goWorkspace"
      @keydown.space.prevent="goWorkspace"
    >
      <div class="logo-icon-wrap">
        <img src="/logo.jpg" alt="Logo" class="logo-img" />
      </div>
      <div class="logo-text" v-show="!sidebarCollapsed">
        <h2>{{ systemConfigStore.systemName }}</h2>
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
      <!-- ===== 用户功能（所有角色可见）===== -->
      <el-menu-item v-for="item in mainMenuItems" :key="item.path" :index="item.path">
        <el-icon><component :is="item.icon" /></el-icon>
        <template #title><span>{{ item.title }}</span></template>
      </el-menu-item>

      <!-- ===== 管理功能（ADMIN/MANAGER only，菜单由路由 meta.menu.group 驱动）===== -->
      <template v-if="adminMenuItems.length > 0">
        <div class="menu-divider" v-show="!sidebarCollapsed"></div>
        <el-menu-item v-for="item in adminMenuItems" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <template #title><span>{{ item.title }}</span></template>
        </el-menu-item>
      </template>
    </el-menu>

    <div class="collapse-btn" @click="sidebarCollapsed = !sidebarCollapsed">
      <el-icon :size="18">
        <Fold v-if="!sidebarCollapsed" />
        <Expand v-else />
      </el-icon>
    </div>
  </el-aside>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RouteRecordRaw, RouteMeta } from 'vue-router'
import type { Component } from 'vue'
import {
  DataBoard,
  DocumentAdd,
  Collection,
  MagicStick,
  ChatLineRound,
  Bell,
  DataLine,
  Setting,
  Fold,
  Expand,
} from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import { useSystemConfigStore } from '@/stores/system-config'
import { useAppLayout } from '@/composables/useAppLayout'

/** 路由 meta.menu 配置：icon 为 @element-plus/icons-vue 组件名，group 决定菜单分组，order 控制组内排序 */
interface MenuMeta {
  /** 菜单显示名；缺省回退到路由 meta.title */
  title?: string
  icon?: string
  group?: 'main' | 'admin'
  order?: number
  /** true 时仅 ADMIN 可见（如系统公告）；默认 main 组全角色、admin 组 ADMIN/MANAGER */
  adminOnly?: boolean
}

interface MenuItem {
  path: string
  title: string
  icon: Component
  order: number
}

const iconMap: Record<string, Component> = {
  DataBoard,
  DocumentAdd,
  Collection,
  MagicStick,
  ChatLineRound,
  Bell,
  DataLine,
  Setting,
}

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const systemConfigStore = useSystemConfigStore()

const { sidebarCollapsed, sidebarOpen } = useAppLayout()

/** 取 AppLayout 父路由下的子路由列表 */
const layoutChildren = computed<RouteRecordRaw[]>(() => {
  const app = router.options.routes.find(r => r.path === '/')
  return app?.children || []
})

const getMenu = (r: RouteRecordRaw): MenuMeta | undefined => {
  const meta = r.meta as RouteMeta & { menu?: MenuMeta }
  return meta?.menu
}

const normalizePath = (p: string) => (p.startsWith('/') ? p : `/${p}`)

const isVisible = (menu: MenuMeta | undefined): boolean => {
  if (!menu) return false
  if (menu.group === 'admin') {
    return menu.adminOnly ? userStore.isAdmin() : userStore.isAdminOrManager()
  }
  return menu.adminOnly ? userStore.isAdmin() : true
}

const toMenuItem = (r: RouteRecordRaw): MenuItem => {
  const menu = getMenu(r)
  return {
    path: normalizePath(r.path),
    title: menu?.title || (r.meta?.title as string) || '',
    icon: iconMap[menu?.icon || ''] || DataBoard,
    order: menu?.order ?? 0,
  }
}

/** 用户功能菜单（main 组） */
const mainMenuItems = computed<MenuItem[]>(() =>
  layoutChildren.value
    .filter(r => getMenu(r)?.group !== 'admin')
    .filter(r => isVisible(getMenu(r)))
    .map(toMenuItem)
    .sort((a, b) => a.order - b.order),
)

/** 管理功能菜单（admin 组） */
const adminMenuItems = computed<MenuItem[]>(() =>
  layoutChildren.value
    .filter(r => getMenu(r)?.group === 'admin')
    .filter(r => isVisible(getMenu(r)))
    .map(toMenuItem)
    .sort((a, b) => a.order - b.order),
)

const menuPaths = computed(() => [...mainMenuItems.value, ...adminMenuItems.value].map(i => i.path))

/** 侧边栏高亮：优先取路由 meta.activeMenu，其次精确匹配，最后按路径前缀兜底（如 /review/123 → /review） */
const activeMenu = computed(() => {
  const metaActive = (route.meta as RouteMeta & { activeMenu?: string }).activeMenu
  if (typeof metaActive === 'string') return metaActive
  if (menuPaths.value.includes(route.path)) return route.path
  const byPrefix = [...menuPaths.value]
    .sort((a, b) => b.length - a.length)
    .find(p => route.path.startsWith(`${p}/`))
  return byPrefix || ''
})

const goWorkspace = () => {
  router.push('/review-center')
}
</script>

<style scoped>
/* ===== 侧边栏：近黑底、带轻微层次感 ===== */
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

/* 菜单项：紧凑、左侧激活指示条 */
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
  background-color: rgba(58, 110, 165, 0.14);
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
</style>
