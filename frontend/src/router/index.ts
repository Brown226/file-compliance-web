import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import AppLayout from '../components/layout/AppLayout.vue'
import { useUserStore } from '../stores/user'

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
        path: 'workspace',
        name: 'Workspace',
        component: () => import('../views/Workspace.vue'),
        meta: { title: '工作台' }
      },
      {
        path: 'tasks/new',
        name: 'NewTask',
        component: () => import('../views/NewTask.vue'),
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
        component: () => import('../views/TaskDetails.vue'),
        meta: { title: '任务详情', hidden: true }
      },
      {
        path: 'standards',
        name: 'StandardLibrary',
        component: () => import('../views/StandardLibrary.vue'),
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
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to, _from, next) => {
  const userStore = useUserStore()
  const isAuthenticated = !!userStore.token

  if (to.meta.requiresAuth && !isAuthenticated) {
    next({ name: 'Login' })
  } else if (to.name === 'Login' && isAuthenticated) {
    next({ path: '/' })
  } else {
    next()
  }
})

export default router
