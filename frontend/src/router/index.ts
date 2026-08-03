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
    // Task 20：Agent 报告打印页（独立路由，不嵌套 AppLayout，打印时无侧边栏干扰）
    path: '/agent/report-print',
    name: 'AgentReportPrint',
    component: () => import('@/views/Agent/ReportPrint.vue'),
    meta: { title: '报告打印', requiresAuth: true }
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
      {
        path: 'tasks',
        name: 'TaskHistory',
        component: () => import('../views/TaskHistory.vue'),
        meta: { title: '全部任务' }
      },
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
        path: 'dwg-vision',
        name: 'DwgVisionAnalysis',
        component: () => import('../views/Tools/DwgVisionAnalysis.vue'),
        meta: { title: '图纸视觉分析' }
      },
      {
        path: 'dwg-batch',
        name: 'BatchDwgAnalysis',
        component: () => import('../views/Tools/BatchDwgAnalysis.vue'),
        meta: { title: '图纸批量分析' }
      },
      {
        path: 'agent',
        name: 'AgentChat',
        component: () => import('@/views/Agent/AgentChat.vue'),
        meta: { title: 'Agent 审查助手' }
      },
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
        path: 'accuracy-dashboard',
        name: 'AccuracyDashboard',
        component: () => import('../views/AccuracyDashboard.vue'),
        meta: { title: '审查质量看板', requiresAdminOrManager: true }
      },
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
        path: 'admin/standards/:id/checkpoints',
        name: 'StandardCheckpoints',
        component: () => import('../views/StandardLibrary/CheckpointManager.vue'),
        meta: { title: 'DEC 审点管理', allowViewer: true, hidden: true }
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
        meta: { title: '语义规则库', allowViewer: true }
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
        meta: { title: '系统设置', requiresAdminOrManager: true }
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
      {
        path: 'admin/feature-flags',
        name: 'AdminFeatureFlags',
        component: () => import('../views/admin/FeatureFlags.vue'),
        meta: { title: '功能管理', requiresAdmin: true }
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

      // ===== OpenSpec 遗留路由清理（2026-08-03：唯一 Agent = Node Agent）=====
      // 文档生成已作为 Node Agent 内置 skill（对话触发），入口指向 /agent；
      // 长期记忆/问答入口统一收敛到 /agent（/ai 页面已删除）
      {
        path: 'openspec',
        redirect: '/agent',
        meta: { title: 'OpenSpec', hidden: true }
      },
      {
        path: 'openspec/create',
        redirect: '/agent'
      },
      {
        path: 'openspec/editor/:id?',
        redirect: '/agent'
      },
      {
        path: 'openspec/memory',
        redirect: '/agent'
      },
      {
        path: 'openspec/qa',
        redirect: '/agent'
      },
      {
        path: 'openspec/wizard',
        redirect: '/agent'
      },
    ]
  }
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes
})

router.beforeEach(async (to, _from, next) => {
  cancelAllPendingRequests()

  const userStore = useUserStore()
  const isAuthenticated = !!userStore.token

  // 已认证用户首次跳转时加载功能开关（幂等，重复调用只发一次请求）
  if (isAuthenticated) {
    const { loadFeatureFlags } = await import('@/composables/useFeatureFlags')
    loadFeatureFlags()
  }

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
