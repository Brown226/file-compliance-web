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
    // 2026-09-10：审查报告打印页（「审查摘要」→ 导出 PDF）。
    // 同为独立路由，不嵌套 AppLayout —— 打印时无侧边栏/页头干扰，
    // A4 排版与 @media print 分页控制见组件内样式。
    path: '/review-report/print',
    name: 'ReviewReportPrint',
    component: () => import('@/views/TaskDetails/ReviewReportPrint.vue'),
    meta: { title: '审查报告打印', requiresAuth: true }
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
        meta: { title: '审查中心', menu: { icon: 'DataBoard', group: 'main', order: 0 } }
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
        meta: { title: '智能审查', menu: { icon: 'DocumentAdd', group: 'main', order: 1 } }
      },
      {
        path: 'review/:id',
        name: 'TaskResults',
        component: () => import('../views/TaskResultsView.vue'),
        meta: { title: '审查结果', hidden: true, activeMenu: '/review-center' }
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
        meta: { title: 'Agent 审查助手', hideHeader: true, menu: { icon: 'MagicStick', group: 'main', order: 3 } }
      },
      // ===== 知识中心 =====
      {
        path: 'knowledge',
        name: 'KnowledgeCenter',
        component: () => import('../views/KnowledgeCenter.vue'),
        meta: { title: '知识中心', menu: { icon: 'Collection', group: 'main', order: 2 } }
      },
      { path: 'admin/standards', redirect: '/knowledge' },
      { path: 'admin/knowledge', redirect: '/knowledge?tab=maxkb' },
      { path: 'admin/rule-libraries', redirect: '/knowledge?tab=clauses' },
      { path: 'openspec/clauses', redirect: '/knowledge?tab=clauses' },
      {
        path: 'feedback',
        name: 'MyFeedbacks',
        component: () => import('../views/MyFeedbacks.vue'),
        meta: { title: '反馈意见', menu: { icon: 'ChatLineRound', group: 'main', order: 4 } }
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
        meta: { title: '反馈详情', hidden: true, activeMenu: '/feedback' }
      },
      {
        path: 'announcements',
        name: 'Announcements',
        component: () => import('../views/AnnouncementManagement.vue'),
        meta: { title: '系统公告', menu: { icon: 'Bell', group: 'admin', adminOnly: true } }
      },

      // ===== 管理员路由（ADMIN/MANAGER 可见）=====
      {
        path: 'accuracy-dashboard',
        name: 'AccuracyDashboard',
        component: () => import('../views/AccuracyDashboard.vue'),
        meta: { title: '审查质量看板', requiresAdminOrManager: true, menu: { icon: 'DataLine', group: 'admin' } }
      },
      {
        path: 'admin',
        name: 'UnifiedPanel',
        component: () => import('../views/UnifiedPanel.vue'),
        meta: { title: '统一管理面板', requiresAdminOrManager: true, menu: { icon: 'Setting', group: 'admin' } }
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
        redirect: (to) => `/knowledge?tab=clauses&standardId=${to.params.id}`,
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
      // V3.2 合并：条文库独立页面并入条文库，路由重定向
      {
        path: 'admin/rule-libraries',
        redirect: '/knowledge?tab=clauses',
      },
      {
        path: 'admin/rules',
        name: 'AdminReviewRules',
        component: () => import('../views/ReviewRules.vue'),
        meta: { title: '审查规则配置', allowViewer: true }
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

// 404 catch-all：未知路径显示 NotFound 页（放在路由表末尾，匹配所有未命中路径）
router.addRoute({
  path: '/:pathMatch(.*)*',
  name: 'NotFound',
  component: () => import('../views/NotFound.vue'),
  meta: { title: '页面不存在' }
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
