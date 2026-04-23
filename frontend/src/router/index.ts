import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'
import { useUserStore } from '@/stores/user'
import { cancelAllPendingRequests } from '@/utils/request'

const routes: Array<RouteRecordRaw> = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/Login.vue'),
    meta: { title: '登录' }
  },
  {
    path: '/',
    component: AppLayout,
    redirect: '/dashboard',
    meta: { requiresAuth: true },
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('../views/Dashboard.vue'),
        meta: { title: 'Dashboard' }
      },
      {
        path: 'tasks/new',
        name: 'NewTask',
        component: () => import('../views/NewTask/index.vue'),
        meta: { title: '新建任务' }
      },
      {
        path: 'tasks/history',
        name: 'TaskHistory',
        component: () => import('../views/TaskHistory.vue'),
        meta: { title: '任务历史' }
      },
      {
        path: 'tasks/:id',
        name: 'TaskDetails',
        component: () => import('../views/TaskDetails/index.vue'),
        meta: { title: '任务详情', hidden: true }
      },
      {
        path: 'standards',
        name: 'StandardLibrary',
        component: () => import('../views/StandardLibrary/index.vue'),
        meta: { title: '标准库' }
      },
      {
        path: 'system',
        name: 'SystemManagement',
        component: () => import('../views/SystemManagement.vue'),
        meta: { title: '系统管理' }
      },
      {
        path: 'audit-logs',
        name: 'AuditLogs',
        component: () => import('../views/AuditLogs.vue'),
        meta: { title: '审计日志' }
      },
      {
        path: 'llm-config',
        name: 'LLMConfig',
        component: () => import('../views/LLMConfig/index.vue'),
        meta: { title: 'LLM服务配置' }
      },
      {
        path: 'pipeline-config',
        name: 'PipelineConfig',
        component: () => import('../views/PipelineConfig.vue'),
        meta: { title: '审查配置', requiresAdmin: true }
      },
      {
        path: 'review-rules',
        name: 'ReviewRules',
        component: () => import('../views/ReviewRules.vue'),
        meta: { title: '审查规则管理' }
      },
      {
        path: 'regex-tool',
        name: 'RegexTool',
        component: () => import('../views/RegexTool.vue'),
        meta: { title: '正则表达式工具', requiresAdmin: true }
      },

    ]
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

router.beforeEach((to, _from, next) => {
  // 路由切换时取消所有未完成的 API 请求，防止旧页面请求阻塞新页面
  cancelAllPendingRequests()

  const userStore = useUserStore()
  const isAuthenticated = !!userStore.token

  if (to.meta.requiresAuth && !isAuthenticated) {
    next({ name: 'Login' })
  } else if (to.meta.requiresAdmin && !userStore.isAdmin()) {
    // 非 ADMIN 用户尝试访问管理员页面，重定向到 Dashboard
    next({ path: '/dashboard' })
  } else if (to.name === 'Login' && isAuthenticated) {
    next({ path: '/' })
  } else {
    next()
  }
})

export default router
