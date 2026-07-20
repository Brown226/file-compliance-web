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
    path: '/change-password',
    name: 'ChangePassword',
    component: () => import('../views/ChangePassword.vue'),
    meta: { title: '修改密码', requiresAuth: true }
  },
  {
    path: '/',
    component: AppLayout,
    redirect: '/review-center',
    meta: { requiresAuth: true },
    children: [
      // ===== 审查中心（主入口） =====
      {
        path: 'review-center',
        name: 'ReviewCenter',
        component: () => import('../views/ReviewCenter.vue'),
        meta: { title: '审查中心' }
      },
      { path: 'workspace', redirect: '/review-center' },
      { path: 'tasks', redirect: '/review-center?tab=tasks' },
      {
        path: 'review',
        name: 'SmartReview',
        component: () => import('../views/ReviewEntry.vue'),
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
        path: 'ai',
        name: 'AiWorkspace',
        component: () => import('../views/AiWorkspace.vue'),
        meta: { title: 'AI 工作台' }
      },
      { path: 'ai-assistant', redirect: '/ai?tab=chat' },
      { path: 'polish', redirect: '/ai?tab=polish' },
      // ===== 知识中心 =====
      {
        path: 'knowledge',
        name: 'KnowledgeCenter',
        component: () => import('../views/KnowledgeCenter.vue'),
        meta: { title: '知识中心' }
      },
      { path: 'admin/standards', redirect: '/knowledge' },
      { path: 'admin/knowledge', redirect: '/knowledge?tab=maxkb' },
      { path: 'admin/rule-libraries', redirect: '/knowledge?tab=rules' },
      { path: 'openspec/clauses', redirect: '/knowledge?tab=clauses' },
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
        path: 'admin/standards',
        name: 'AdminStandards',
        component: () => import('../views/StandardLibrary/index.vue'),
        meta: { title: '标准库清单管理', allowViewer: true }
      },
      {
        path: 'admin/knowledge',
        name: 'AdminKnowledge',
        component: () => import('../views/StandardLibrary/MaxKBTab.vue'),
        meta: { title: 'MaxKB 知识库', requiresAdminOrManager: true }
      },
      {
        path: 'admin/knowledge-categories',
        redirect: '/admin/knowledge'
      },
      {
        path: 'admin/knowledge-categories/:id/documents',
        redirect: '/admin/knowledge'
      },
      {
        path: 'admin/rule-libraries',
        name: 'RuleLibraries',
        component: () => import('../views/admin/RuleLibraries.vue'),
        meta: { title: '语义知识库', allowViewer: true }
      },
      {
        path: 'admin/rules',
        name: 'AdminReviewRules',
        component: () => import('../views/ReviewRules.vue'),
        meta: { title: '审查规则配置', allowViewer: true }
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
        path: 'admin/llm-profiles',
        redirect: '/admin/ai-engine'
      },
      {
        path: 'admin/ai-call-dashboard',
        name: 'AdminAiCallDashboard',
        component: () => import('../views/admin/AiCallDashboard.vue'),
        meta: { title: 'AI 调用看板', requiresAdminOrManager: true }
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
        meta: { title: '反馈管理', requiresAdmin: true }
      },

      // ===== 旧路由重定向（兼容已有书签）=====
      { path: 'dashboard', redirect: '/workspace' },
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

      // ===== OpenSpec 高级功能（文档生成 + 长期记忆 + 智能审查）=====
      {
        path: 'openspec',
        redirect: '/openspec/create',
        meta: { title: 'OpenSpec', hidden: true }
      },
      {
        path: 'openspec/create',
        name: 'OpenSpecCreate',
        component: () => import('@/views/openspec/CreateDocument.vue'),
        meta: { title: '文档生成', icon: 'DocumentAdd' }
      },
      {
        path: 'openspec/editor/:id?',
        name: 'OpenSpecEditor',
        component: () => import('@/views/openspec/Editor.vue'),
        meta: { title: '文档编辑', hidden: true }
      },
      {
        path: 'openspec/memory',
        redirect: '/ai?tab=memory'
      },
      {
        path: 'openspec/review',
        name: 'OpenSpecReview',
        component: () => import('@/views/openspec/ReviewList.vue'),
        meta: { title: 'OpenSpec审查', icon: 'Search' }
      },
      {
        path: 'openspec/review/:id',
        name: 'OpenSpecReviewResult',
        component: () => import('@/views/openspec/ReviewResult.vue'),
        meta: { title: '审查结果', hidden: true }
      },
      {
        path: 'openspec/standards',
        name: 'OpenSpecStandards',
        component: () => import('@/views/openspec/StandardReview.vue'),
        meta: { title: '标准条文', icon: 'Reading' }
      },
      {
        path: 'openspec/clauses',
        name: 'OpenSpecClauses',
        component: () => import('@/views/openspec/StandardClauses.vue'),
        meta: { title: '条文库', icon: 'Collection' }
      },
      // ===== OpenSpec 扩展页面 =====
      {
        path: 'openspec/home',
        name: 'OpenSpecHome',
        component: () => import('@/views/openspec/Home.vue'),
        meta: { title: 'OpenSpec 首页', icon: 'HomeFilled', hidden: true }
      },
      {
        path: 'openspec/wizard',
        redirect: '/ai?tab=generate'
      },
      {
        path: 'openspec/qa',
        redirect: '/ai?tab=qa'
      },
      {
        path: 'openspec/templates/:id',
        name: 'OpenSpecTemplateDetail',
        component: () => import('@/views/openspec/TemplateDetail.vue'),
        meta: { title: '模板详情', hidden: true }
      },
      {
        path: 'openspec/settings',
        name: 'OpenSpecSettings',
        component: () => import('@/views/openspec/Settings.vue'),
        meta: { title: 'OpenSpec 设置', icon: 'Setting' }
      },
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
  } else if (to.meta.allowViewer && !isAuthenticated) {
    next({ name: 'Login' })
  } else if (to.meta.requiresAdminOrManager && !userStore.isAdminOrManager()) {
    next({ path: '/review-center' })
  } else if (to.meta.requiresAdmin && !userStore.isAdmin()) {
    next({ path: '/review-center' })
  } else if (to.name === 'Login' && isAuthenticated) {
    next({ path: '/review-center' })
  } else {
    next()
  }
})

export default router
