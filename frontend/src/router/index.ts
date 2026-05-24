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
    redirect: '/workspace',
    meta: { requiresAuth: true },
    children: [
      // ===== 用户路由（所有角色可见）=====
      {
        path: 'workspace',
        name: 'Workspace',
        component: () => import('../views/Workspace.vue'),
        meta: { title: '工作台' }
      },
      {
        path: 'review',
        name: 'SmartReview',
        component: () => import('../views/SmartReviewNew.vue'),
        meta: { title: '智能审查' }
      },
      {
        path: 'review/:id',
        name: 'TaskResults',
        component: () => import('../views/TaskResultsView.vue'),
        meta: { title: '审查结果', hidden: true }
      },
      {
        path: 'tasks/details/:id',
        redirect: to => ({ path: `/review/${to.params.id}` })
      },
      {
        path: 'langchain/search',
        name: 'LangChainSearch',
        component: () => import('../views/langchain/LangChainSearch.vue'),
        meta: { title: 'LC 知识检索' }
      },
      {
        path: 'langchain/qa',
        name: 'LangChainQA',
        component: () => import('../views/langchain/LangChainQA.vue'),
        meta: { title: 'LC 智能问答' }
      },
      {
        path: 'tasks',
        name: 'TaskHistory',
        component: () => import('../views/TaskHistory.vue'),
        meta: { title: '我的任务' }
      },
      {
        path: 'feedback',
        name: 'MyFeedbacks',
        component: () => import('../views/MyFeedbacks.vue'),
        meta: { title: '反馈意见' }
      },
      {
        path: 'feedback/submit',
        name: 'FeedbackSubmit',
        component: () => import('../views/FeedbackSubmit.vue'),
        meta: { title: '提交反馈' }
      },
      {
        path: 'feedback/:id',
        name: 'FeedbackDetail',
        component: () => import('../views/FeedbackDetail.vue'),
        meta: { title: '反馈详情', hidden: true }
      },
      {
        path: 'announcements',
        name: 'Announcements',
        component: () => import('../views/AnnouncementManagement.vue'),
        meta: { title: '系统公告' }
      },

      // ===== 管理员路由（ADMIN/MANAGER 可见）=====
      {
        path: 'admin',
        name: 'UnifiedPanel',
        component: () => import('../views/UnifiedPanel.vue'),
        meta: { title: '统一管理面板', requiresAdminOrManager: true }
      },
      {
        path: 'admin/dashboard',
        name: 'AdminDashboard',
        component: () => import('../views/Dashboard.vue'),
        meta: { title: '数据看板', requiresAdminOrManager: true }
      },
      {
        path: 'admin/standards',
        name: 'AdminStandards',
        component: () => import('../views/StandardLibrary/index.vue'),
        meta: { title: '标准库清单管理', requiresAdminOrManager: true }
      },
      {
        path: 'admin/knowledge-categories',
        name: 'KnowledgeCategories',
        component: () => import('../views/admin/KnowledgeCategories.vue'),
        meta: { title: '知识库管理', requiresAdminOrManager: true }
      },
      {
        path: 'admin/knowledge-categories/:id/documents',
        name: 'KnowledgeDocuments',
        component: () => import('../views/admin/KnowledgeDocuments.vue'),
        meta: { title: '知识库文档管理', requiresAdminOrManager: true, hidden: true }
      },
      {
        path: 'admin/rule-libraries',
        name: 'RuleLibraries',
        component: () => import('../views/admin/RuleLibraries.vue'),
        meta: { title: '规则库管理', requiresAdminOrManager: true }
      },
      {
        path: 'admin/rules',
        name: 'AdminReviewRules',
        component: () => import('../views/ReviewRules.vue'),
        meta: { title: '审查规则配置', requiresAdminOrManager: true }
      },
      {
        path: 'admin/prompts',
        name: 'AdminPrompts',
        component: () => import('../views/PromptConfig.vue'),
        meta: { title: '提示词模板', requiresAdminOrManager: true }
      },
      {
        path: 'admin/system',
        name: 'AdminSystem',
        component: () => import('../views/SystemManagement.vue'),
        meta: { title: '绯荤粺璁剧疆', requiresAdminOrManager: true }
      },
      {
        path: 'admin/users',
        name: 'AdminDepartment',
        component: () => import('../views/admin/DepartmentManagement.vue'),
        meta: { title: '部门与员工', requiresAdminOrManager: true }
      },
      {
        path: 'admin/storage',
        name: 'AdminStorage',
        component: () => import('../views/admin/StorageManagement.vue'),
        meta: { title: '存储管理', requiresAdminOrManager: true }
      },
      {
        path: 'admin/ai-engine',
        name: 'AdminAiEngine',
        component: () => import('../views/admin/AiEngineConfig.vue'),
        meta: { title: 'AI 引擎配置', requiresAdminOrManager: true }
      },
      {
        path: 'admin/basic',
        name: 'AdminBasic',
        component: () => import('../views/admin/BasicSettings.vue'),
        meta: { title: '基础设置', requiresAdminOrManager: true }
      },
      {
        path: 'admin/audit',
        name: 'AdminAudit',
        component: () => import('../views/AuditLogs.vue'),
        meta: { title: '审计日志', requiresAdminOrManager: true }
      },
      {
        path: 'admin/feedback',
        name: 'AdminFeedback',
        component: () => import('../views/FeedbackManagement.vue'),
        meta: { title: '反馈管理', requiresAdminOrManager: true }
      },

      // ===== 旧路由重定向（兼容已有书签）=====
      { path: 'dashboard', redirect: '/admin/dashboard' },
      { path: 'tasks/new', redirect: '/review' },
      { path: 'tasks/history', redirect: '/tasks' },
      { path: 'standards', redirect: '/admin/standards' },
      { path: 'system', redirect: '/admin/users' },
      { path: 'llm-config', redirect: '/admin/ai-engine' },
      { path: 'audit-logs', redirect: '/admin/audit' },
      { path: 'review-rules', redirect: '/admin/rules' },
      { path: 'pipeline-config', redirect: '/admin/rules' },
      { path: 'regex-tool', redirect: '/admin/rules' },
      { path: 'tasks/:id', redirect: to => ({ path: `/review/${to.params.id}` }) },
    ]
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

router.beforeEach((to, _from, next) => {
  cancelAllPendingRequests()

  const userStore = useUserStore()
  const isAuthenticated = !!userStore.token

  if (to.meta.requiresAuth && !isAuthenticated) {
    next({ name: 'Login' })
  } else if (to.meta.requiresAdminOrManager && !userStore.isAdminOrManager()) {
    next({ path: '/workspace' })
  } else if (to.meta.requiresAdmin && !userStore.isAdmin()) {
    next({ path: '/workspace' })
  } else if (to.name === 'Login' && isAuthenticated) {
    next({ path: '/workspace' })
  } else {
    next()
  }
})

export default router
