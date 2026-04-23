<template>
  <div class="dashboard-container">
    <!-- ===== Header ===== -->
    <div class="header">
      <div class="header-left">
        <h2>{{ viewMode === 'admin' ? '领导监控台' : '我的工作台' }}</h2>
      </div>
      <div class="header-right">
        <template v-if="canSwitchView">
          <el-button link class="view-toggle-btn" @click="toggleView">
            {{ viewMode === 'admin' ? '切换到我的工作台' : '切换到领导监控台' }}
          </el-button>
          <span class="header-divider">|</span>
        </template>
        <el-button-group v-if="viewMode === 'admin'" class="time-range-group">
          <el-button
            v-for="d in [7, 30, 90]"
            :key="d"
            :type="timeRange === d ? 'primary' : 'default'"
            size="small"
            @click="handleTimeRangeChange(d)"
          >{{ d }}天</el-button>
        </el-button-group>
        <el-button link class="refresh-btn" :loading="refreshing" @click="handleRefresh">
          刷新
        </el-button>
        <span class="date-text">{{ currentDate }}</span>
      </div>
    </div>

    <!-- ===== 领导视图：严重违规预警横幅（按部门聚合） ===== -->
    <div v-if="viewMode === 'admin' && hasHighSeverityIssues && !alertDismissed" class="alert-banner">
      <div class="alert-body">
        <div class="alert-title">
          <el-icon :size="18"><WarningFilled /></el-icon>
          <span>严重违规预警</span>
        </div>
        <div class="alert-depts">
          <span
            v-for="dept in unhandledHighDepts"
            :key="dept.deptName"
            class="alert-dept-item"
          >
            <span class="alert-dept-icon">⛔</span>
            <span>{{ dept.deptName }} — {{ dept.count }}个严重违规未处理</span>
            <el-button link size="small" class="alert-detail-link" @click="$router.push('/tasks/history')">
              查看详情 →
            </el-button>
          </span>
          <div v-if="!unhandledHighDepts.length" class="alert-dept-total">
            共 {{ highSeverityCount }} 个严重问题待处理
          </div>
        </div>
      </div>
      <div class="alert-actions">
        <el-button link class="alert-dismiss-btn" @click="dismissAlert">已知晓 ✕</el-button>
      </div>
    </div>

    <!-- ===== KPI 统计卡片区 ===== -->
    <div class="kpi-grid" :class="{ 'kpi-grid-5': viewMode === 'admin' }">
      <div
        v-for="(kpi, index) in currentKpiList"
        :key="index"
        class="kpi-card"
        :class="`kpi-${kpi.theme}`"
      >
        <div class="kpi-body">
          <div class="kpi-info">
            <div class="kpi-label">{{ kpi.label }}</div>
            <div class="kpi-value" :class="`value-${kpi.theme}`">
              {{ kpi.value }}<span class="unit" v-if="kpi.unit">{{ kpi.unit }}</span>
            </div>
            <div v-if="kpi.trend !== undefined" class="kpi-trend" :class="kpi.trend > 0 ? 'trend-up' : kpi.trend < 0 ? 'trend-down' : ''">
              {{ kpi.trend > 0 ? '↑' : kpi.trend < 0 ? '↓' : '—' }} 较上期 {{ Math.abs(kpi.trend) }}{{ kpi.trendUnit || '' }}
            </div>
          </div>
          <div class="kpi-icon-wrap">
            <div class="kpi-icon-inner" :class="`${kpi.theme}-icon-bg`">
              <el-icon :size="22"><component :is="kpi.icon" /></el-icon>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ===== 第一行图表 ===== -->
    <el-row :gutter="20" class="chart-row">
      <el-col :span="12">
        <el-card shadow="hover" class="chart-card">
          <template #header>
            <div class="card-header">{{ viewMode === 'admin' ? '审查与合规趋势' : '审查趋势（30天）' }}</div>
          </template>
          <div ref="deptChartRef" class="chart-box"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <!-- 用户视图：最近任务 -->
        <template v-if="viewMode === 'user'">
          <div class="recent-tasks-panel">
            <div class="card-header panel-header">最近任务</div>
            <div class="recent-task-list">
              <div
                v-for="task in recentTasks"
                :key="task.id"
                class="recent-task-item"
                @click="$router.push(`/tasks/${task.id}`)"
              >
                <div class="task-info">
                  <span class="task-name">{{ task.title }}</span>
                  <span class="task-time">{{ task.timeAgo }}{{ task.issueCount ? ' · ' + task.issueCount + '个问题' : '' }}</span>
                </div>
                <el-tag :type="getStatusTagType(task.status)" size="small" round>{{ getStatusLabel(task.status) }}</el-tag>
              </div>
              <div v-if="recentTasks.length === 0" class="empty-hint">暂无最近任务</div>
            </div>
            <div class="panel-footer">
              <el-button link type="primary" @click="$router.push('/tasks/history')">查看全部 →</el-button>
            </div>
          </div>
        </template>
        <!-- 领导视图：部门审查效率排行 -->
        <template v-else>
          <el-card shadow="hover" class="chart-card dept-efficiency-card">
            <template #header>
              <div class="card-header">部门审查效率排行</div>
            </template>
            <div class="dept-efficiency-table">
              <table class="dept-table">
                <thead>
                  <tr>
                    <th>部门</th>
                    <th>平均耗时</th>
                    <th>任务数</th>
                    <th>合规率</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="dept in departmentStats"
                    :key="dept.deptName"
                    :class="{ 'row-highlight': isDeptRowHighlight(dept) }"
                  >
                    <td class="dept-name">
                      <span class="dept-dot" :style="{ background: getDeptColor(dept) }"></span>
                      {{ dept.deptName }}
                    </td>
                    <td :class="{ 'cell-warn': dept.avgTimeMs && dept.avgTimeMs > 300000 }">
                      {{ formatAvgTime(dept.avgTimeMs || 0) }}
                    </td>
                    <td>{{ dept.taskCount || 0 }}</td>
                    <td>
                      <div class="compliance-bar-wrap">
                        <div class="compliance-bar-bg">
                          <div
                            class="compliance-bar-fill"
                            :style="{ width: (dept.complianceRate || 0) + '%' }"
                            :class="{ 'bar-warn': (dept.complianceRate || 0) < 80 }"
                          ></div>
                        </div>
                        <span class="compliance-value">{{ (dept.complianceRate || 0).toFixed(0) }}%</span>
                      </div>
                    </td>
                  </tr>
                  <tr v-if="departmentStats.length === 0">
                    <td colspan="4" class="empty-cell">暂无部门数据</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </el-card>
        </template>
      </el-col>
    </el-row>

    <!-- ===== 第二行图表 ===== -->
    <el-row :gutter="20" class="chart-row">
      <el-col :span="12">
        <!-- 用户视图：快捷操作 -->
        <template v-if="viewMode === 'user'">
          <div class="quick-actions-card">
            <div class="card-header panel-header">快捷操作</div>
            <div class="quick-actions">
              <div class="action-card" @click="$router.push('/tasks/new')">
                <el-icon :size="28" color="#2563eb"><EditPen /></el-icon>
                <span>新建任务</span>
              </div>
              <div class="action-card" @click="$router.push('/tasks/history')">
                <el-icon :size="28" color="#10b981"><List /></el-icon>
                <span>历史任务</span>
              </div>
              <div class="action-card" @click="$router.push('/standards')">
                <el-icon :size="28" color="#f59e0b"><Collection /></el-icon>
                <span>标准库</span>
              </div>
              <div class="action-card" @click="handleFeedback">
                <el-icon :size="28" color="#8b5cf6"><ChatDotRound /></el-icon>
                <span>反馈建议</span>
              </div>
            </div>
          </div>
        </template>
        <!-- 领导视图：违规类型分布 -->
        <template v-else>
          <el-card shadow="hover" class="chart-card">
            <template #header>
              <div class="card-header">违规类型分布 TOP10</div>
            </template>
            <div ref="violationChartRef" class="chart-box"></div>
          </el-card>
        </template>
      </el-col>
      <el-col :span="12">
        <!-- 用户视图：我的问题待处理 -->
        <template v-if="viewMode === 'user'">
          <div class="pending-issues-panel">
            <div class="card-header panel-header">
              <span>我的问题待处理</span>
              <el-badge v-if="pendingIssues.length > 0" :value="pendingIssues.length" class="issues-badge" />
            </div>
            <div class="pending-issues-list">
              <div
                v-for="(issue, idx) in pendingIssues"
                :key="issue.id"
                class="pending-issue-item"
                :class="{ 'issue-divider': idx > 0 }"
              >
                <div class="issue-header">
                  <span :class="`severity-dot severity-${getSeverityLevel(issue.severity)}`"></span>
                  <span class="issue-file">{{ issue.fileName || '未知文件' }} — {{ issue.description || '未描述' }}</span>
                </div>
                <div class="issue-actions">
                  <el-button size="small" type="primary" link @click="handleConfirmIssue(issue)">确认</el-button>
                  <el-button size="small" type="warning" link @click="handleFalsePositive(issue)">误报</el-button>
                </div>
              </div>
              <div v-if="pendingIssues.length === 0" class="empty-hint">暂无待处理问题</div>
            </div>
          </div>
        </template>
        <!-- 领导视图：任务状态分布饼图 -->
        <template v-else>
          <el-card shadow="hover" class="chart-card">
            <template #header>
              <div class="card-header">任务状态分布</div>
            </template>
            <div ref="statusChartRef" class="chart-box"></div>
          </el-card>
        </template>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick, computed, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import {
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { LinearGradient } from 'echarts/lib/util/graphic';
import {
  DocumentChecked, Warning, CircleClose, Timer,
  WarningFilled, EditPen, List, Collection, ChatDotRound,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { getDashboardStatsApi, getDashboardTrendApi } from '@/api/dashboard';
import { getTasksApi } from '@/api/task';
import { toggleFalsePositiveApi } from '@/api/task';
import { useECharts } from '@/composables/useECharts';
import { useUserStore } from '@/stores/user';

// 注册所需的 ECharts 模块
echarts.use([
  BarChart,
  LineChart,
  PieChart,
  TitleComponent,
  TooltipComponent,
  GridComponent,
  LegendComponent,
  CanvasRenderer,
]);

const router = useRouter();
const userStore = useUserStore();
const canSwitchView = computed(() => userStore.isAdminOrManager());

// ===== 视图模式切换 =====
const storedView = typeof localStorage !== 'undefined' ? localStorage.getItem('dashboard-view') : null;
const isAdminByRole = computed(() => userStore.isAdminOrManager());
const viewMode = ref<'admin' | 'user'>(
  storedView === 'user' ? 'user' : (isAdminByRole.value ? 'admin' : 'user')
);

const toggleView = () => {
  viewMode.value = viewMode.value === 'admin' ? 'user' : 'admin';
  localStorage.setItem('dashboard-view', viewMode.value);
  fetchStats();
};

// ===== 时间范围 =====
const timeRange = ref(30);
const handleTimeRangeChange = (days: number) => {
  timeRange.value = days;
  fetchStats();
};

// ===== 刷新 =====
const refreshing = ref(false);
const handleRefresh = async () => {
  refreshing.value = true;
  await fetchStats();
  refreshing.value = false;
};

// ===== 图表 ref =====
const typoChartRef = ref<HTMLElement | null>(null);
const violationChartRef = ref<HTMLElement | null>(null);
const deptChartRef = ref<HTMLElement | null>(null);
const statusChartRef = ref<HTMLElement | null>(null);

const typo = useECharts(typoChartRef, { resizeDebounce: 150 });
const violation = useECharts(violationChartRef, { resizeDebounce: 150 });
const dept = useECharts(deptChartRef, { resizeDebounce: 150 });
const status = useECharts(statusChartRef, { resizeDebounce: 150 });

// ===== 数据 =====
const stats = ref<any>({
  taskStats: { PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0, TOTAL: 0 },
  issueStats: { TYPO: 0, VIOLATION: 0, TOTAL: 0 },
  frequentTypos: [],
  topViolations: [],
  departmentStats: [],
  averageProcessingTimeMs: 0,
  complianceRate: 0,
  bySeverity: { error: 0, warning: 0, info: 0 },
  unhandledHigh: [],
  comparedToLastPeriod: { tasksDelta: 0, complianceDelta: 0, avgTimeDelta: 0 },
  pendingIssues: [],
  trendData: {},
});

// ===== 部门数据 =====
const departmentStats = ref<any[]>([]);

// ===== 日期显示 =====
const now = ref(new Date());
const currentDate = computed(() => {
  const d = now.value;
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${weekdays[d.getDay()]}`;
});

// ===== 严重违规预警 =====
const highSeverityCount = computed(() => stats.value.bySeverity?.error || 0);
const hasHighSeverityIssues = computed(() => highSeverityCount.value > 0);
const unhandledHighDepts = computed(() => {
  const data = stats.value.unhandledHigh || [];
  return Array.isArray(data) ? data.filter((d: any) => d.count > 0) : [];
});

const alertDismissed = ref(false);
const dismissAlert = () => {
  alertDismissed.value = true;
  localStorage.setItem('dashboard-alert-dismissed', new Date().toISOString().slice(0, 10));
};

// ===== 最近任务 =====
const recentTasks = ref<any[]>([]);

// ===== 待处理问题（用户视图） =====
const pendingIssues = ref<any[]>([]);

// ===== 辅助函数 =====
const formatAvgTime = (ms: number) => {
  if (!ms) return '0s';
  const sec = ms / 1000;
  if (sec >= 60) {
    return `${Math.floor(sec / 60)}m ${Math.round(sec % 60)}s`;
  }
  return `${sec.toFixed(1)}s`;
};

const getStatusLabel = (status: string) => {
  const map: Record<string, string> = { PENDING: '排队中', PROCESSING: '审查中', COMPLETED: '已完成', FAILED: '失败' };
  return map[status] || status;
};

const getStatusTagType = (status: string) => {
  const map: Record<string, string> = { PENDING: 'info', PROCESSING: '', COMPLETED: 'success', FAILED: 'danger' };
  return map[status] || 'info';
};

const getSeverityLevel = (severity: string) => {
  const map: Record<string, string> = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };
  return map[severity] || 'low';
};

const timeAgo = (dateStr: string) => {
  if (!dateStr) return '';
  const now = Date.now();
  const created = new Date(dateStr).getTime();
  const diff = now - created;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  return `${days}天前`;
};

// ===== 部门效率表格 =====
const isDeptRowHighlight = (dept: any) => {
  const highTime = dept.avgTimeMs && dept.avgTimeMs > 300000;
  const lowCompliance = dept.complianceRate && dept.complianceRate < 80;
  return highTime || lowCompliance;
};

const deptColors = ['#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const getDeptColor = (dept: any) => {
  // 从 deptName 字符串哈希派生颜色，确保同一部门始终显示相同颜色
  const name = dept?.deptName || '';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  return deptColors[Math.abs(hash) % deptColors.length];
};

// ===== KPI 数据 =====
const adminKpiList = computed(() => [
  {
    label: '审查总量',
    value: stats.value.taskStats.TOTAL || 0,
    unit: '',
    icon: DocumentChecked,
    theme: 'primary' as const,
    trend: stats.value.comparedToLastPeriod?.tasksDelta || 0,
    trendUnit: '%',
  },
  {
    label: '整体合规率',
    value: stats.value.complianceRate || 0,
    unit: '%',
    icon: CircleClose,
    theme: 'success' as const,
    trend: stats.value.comparedToLastPeriod?.complianceDelta || 0,
    trendUnit: '%',
  },
  {
    label: '严重问题',
    value: highSeverityCount.value,
    unit: '',
    icon: Warning,
    theme: 'danger' as const,
    trend: 0,
    trendUnit: '项',
  },
  {
    label: '平均耗时',
    value: formatAvgTime(stats.value.averageProcessingTimeMs),
    unit: '',
    icon: Timer,
    theme: 'success' as const,
    trend: stats.value.comparedToLastPeriod?.avgTimeDelta || 0,
    trendUnit: '%',
  },
  {
    label: '积压任务',
    value: stats.value.taskStats.PENDING || 0,
    unit: '',
    icon: Warning,
    theme: 'warning' as const,
    trend: 0,
    trendUnit: '项',
  },
]);

const userKpiList = computed(() => [
  {
    label: '我的任务',
    value: stats.value.taskStats.TOTAL || 0,
    unit: '',
    icon: DocumentChecked,
    theme: 'primary' as const,
    trend: undefined as number | undefined,
  },
  {
    label: '合规率',
    value: stats.value.complianceRate || 0,
    unit: '%',
    icon: CircleClose,
    theme: 'success' as const,
    trend: undefined as number | undefined,
  },
  {
    label: '待处理问题',
    value: pendingIssues.value.length || stats.value.issueStats.VIOLATION || 0,
    unit: '',
    icon: Warning,
    theme: 'warning' as const,
    trend: undefined as number | undefined,
  },
  {
    label: '平均耗时',
    value: formatAvgTime(stats.value.averageProcessingTimeMs),
    unit: '',
    icon: Timer,
    theme: 'success' as const,
    trend: undefined as number | undefined,
  },
]);

const currentKpiList = computed(() => viewMode.value === 'admin' ? adminKpiList.value : userKpiList.value);

// ===== 问题操作 =====
const handleConfirmIssue = (issue: any) => {
  ElMessage.success('已确认该问题');
  pendingIssues.value = pendingIssues.value.filter(i => i.id !== issue.id);
};

const handleFalsePositive = async (issue: any) => {
  try {
    if (issue.id) {
      await toggleFalsePositiveApi(issue.id, { isFalsePositive: true, reason: '用户标记为误报' });
      ElMessage.success('已标记为误报');
    } else {
      ElMessage.info('已记录误报反馈');
    }
    pendingIssues.value = pendingIssues.value.filter(i => i.id !== issue.id);
  } catch (e) {
    ElMessage.error('标记误报失败');
  }
};

const handleFeedback = () => {
  ElMessage.info('反馈功能开发中，请联系管理员');
};

// ===== 数据获取 =====
const fetchStats = async () => {
  try {
    const statsParams: any = {};
    if (viewMode.value === 'user') {
      statsParams.role = 'user';
      statsParams.userId = userStore.userInfo?.id;
    }

    const [statsRes, trendRes] = await Promise.all([
      getDashboardStatsApi(statsParams),
      getDashboardTrendApi(timeRange.value),
    ]);
    const data = statsRes.data;

    if (viewMode.value === 'user' && data.myTasks) {
      const byStatus = data.myTasks.by_status || {};
      stats.value = {
        taskStats: {
          PENDING: byStatus.PENDING || 0,
          PROCESSING: byStatus.PROCESSING || 0,
          COMPLETED: byStatus.COMPLETED || 0,
          FAILED: byStatus.FAILED || 0,
          TOTAL: data.myTasks.total || 0,
        },
        issueStats: { TYPO: 0, VIOLATION: data.pendingIssues?.length || 0, TOTAL: data.pendingIssues?.length || 0 },
        frequentTypos: [],
        topViolations: [],
        departmentStats: [],
        averageProcessingTimeMs: data.avgProcessingTimeMs || 0,
        complianceRate: data.complianceRate || 0,
        bySeverity: { error: 0, warning: 0, info: 0 },
        unhandledHigh: [],
        comparedToLastPeriod: { tasksDelta: 0, complianceDelta: 0, avgTimeDelta: 0 },
        pendingIssues: data.pendingIssues || [],
        trendData: trendRes.data || {},
      };
      pendingIssues.value = data.pendingIssues || [];
    } else {
      const byStatus = data.taskStats || {};
      const bySeverity = data.issues?.by_severity || {};
      stats.value = {
        taskStats: {
          PENDING: byStatus.PENDING || 0,
          PROCESSING: byStatus.PROCESSING || 0,
          COMPLETED: byStatus.COMPLETED || 0,
          FAILED: byStatus.FAILED || 0,
          TOTAL: byStatus.TOTAL || 0,
        },
        issueStats: {
          TYPO: data.issueStats?.TYPO || 0,
          VIOLATION: data.issueStats?.VIOLATION || 0,
          TOTAL: data.issueStats?.TOTAL || 0,
        },
        frequentTypos: data.frequentTypos || [],
        topViolations: data.topViolations || [],
        departmentStats: data.departmentStats || [],
        averageProcessingTimeMs: data.averageProcessingTimeMs || 0,
        complianceRate: data.complianceRate || 0,
        bySeverity,
        unhandledHigh: data.unhandledHigh || [],
        comparedToLastPeriod: data.comparedToLastPeriod || { tasksDelta: 0, complianceDelta: 0, avgTimeDelta: 0 },
        pendingIssues: [],
        trendData: trendRes.data || {},
      };
      departmentStats.value = data.departmentStats || [];
    }

    const dismissedDate = localStorage.getItem('dashboard-alert-dismissed');
    if (dismissedDate === new Date().toISOString().slice(0, 10)) {
      alertDismissed.value = true;
    }

    nextTick(() => {
      renderCharts();
    });
  } catch (e) {
    // 错误已在拦截器中处理
  }
};

// ===== 获取最近任务 =====
const fetchRecentTasks = async () => {
  try {
    const params: any = { page: 1, limit: 5 };
    if (viewMode.value === 'user') {
      params.userId = userStore.userInfo?.id;
    }
    const res = await getTasksApi(params);
    const items = res.data?.items || [];
    recentTasks.value = items.map((t: any) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      timeAgo: timeAgo(t.createdAt),
      issueCount: t._count?.taskDetails || 0,
    }));
  } catch (e) {
    recentTasks.value = [];
  }
};

// ===== 图表渲染 =====
const renderCharts = () => {
  const textColor = '#374151';
  const axisLineColor = '#E5E7EB';
  const splitLineColor = '#F9FAFB';

  const baseTooltip = {
    backgroundColor: '#FFFFFF',
    borderColor: '#E5E7EB',
    borderWidth: 1,
    padding: [10, 14],
    textStyle: { color: '#111827', fontSize: 13 },
    extraCssText: 'box-shadow: 0 4px 16px rgba(0,0,0,0.08); border-radius: 8px;',
  };

  const emptyTextStyle = {
    text: '暂无数据',
    textStyle: { color: '#9CA3AF', fontSize: 14, fontWeight: 500 },
    left: 'center',
    top: 'center',
  };

  // 审查趋势图表（领导：任务数+问题数+合规率三轴联动；用户：仅任务数）
  if (deptChartRef.value) {
    dept.initChart(echarts);
    const trendData = stats.value.trendData || {};
    const taskTrend = Array.isArray(trendData.task_trend) ? trendData.task_trend : [];
    const issueTrend = Array.isArray(trendData.issue_trend) ? trendData.issue_trend : [];
    const complianceTrend = Array.isArray(trendData.compliance_trend) ? trendData.compliance_trend : [];
    const allDates = [...new Set([
      ...taskTrend.map((t: any) => t.date),
      ...issueTrend.map((t: any) => t.date),
    ])].sort();

    // 无数据时显示提示
    const hasTrendData = allDates.length > 0;

    const seriesList: any[] = [
      {
        name: '任务数',
        type: 'line',
        yAxisIndex: 0,
        data: allDates.map(d => taskTrend.find((t: any) => t.date === d)?.count || 0),
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        itemStyle: { color: '#2563EB' },
        lineStyle: { width: 2 },
        areaStyle: {
          color: new LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(37,99,235,0.15)' },
            { offset: 1, color: 'rgba(37,99,235,0.02)' },
          ]),
        },
      },
      {
        name: '问题数',
        type: 'line',
        yAxisIndex: 0,
        data: allDates.map(d => issueTrend.find((t: any) => t.date === d)?.count || 0),
        smooth: true,
        symbol: 'circle',
        symbolSize: 5,
        itemStyle: { color: '#EF4444' },
        lineStyle: { width: 2 },
        areaStyle: {
          color: new LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(239,68,68,0.15)' },
            { offset: 1, color: 'rgba(239,68,68,0.02)' },
          ]),
        },
      },
    ];

    const legendData = ['任务数', '问题数'];

    if (viewMode.value === 'admin' && complianceTrend.length > 0) {
      seriesList.push({
        name: '合规率',
        type: 'line',
        yAxisIndex: 1,
        data: allDates.map(d => complianceTrend.find((t: any) => t.date === d)?.value ?? null),
        smooth: true,
        symbol: 'diamond',
        symbolSize: 6,
        itemStyle: { color: '#10B981' },
        lineStyle: { width: 2, type: 'dashed' },
      });
      legendData.push('合规率');
    }

    const yAxisConfig: any[] = [
      {
        type: 'value',
        splitLine: { lineStyle: { color: splitLineColor } },
        axisLabel: { color: textColor, fontSize: 12 },
      },
    ];

    if (viewMode.value === 'admin' && complianceTrend.length > 0) {
      yAxisConfig.push({
        type: 'value',
        position: 'right',
        min: 0,
        max: 100,
        splitLine: { show: false },
        axisLabel: { color: '#10B981', fontSize: 12, formatter: '{value}%' },
      });
    }

    dept.chartInstance.value?.setOption({
      backgroundColor: 'transparent',
      tooltip: hasTrendData ? { ...baseTooltip, trigger: 'axis' } : { show: false },
      legend: { data: legendData, textStyle: { color: textColor, fontSize: 12 }, top: 4 },
      grid: { left: '3%', right: viewMode.value === 'admin' && complianceTrend.length > 0 ? '8%' : '4%', bottom: '3%', top: 40, containLabel: true },
      xAxis: {
        type: 'category',
        data: allDates.map(d => typeof d === 'string' && d.length > 5 ? d.substring(5) : d),
        axisLine: { lineStyle: { color: axisLineColor } },
        axisLabel: { color: textColor, fontSize: 12, rotate: allDates.length > 15 ? 45 : 0 },
      },
      yAxis: yAxisConfig,
      series: seriesList,
    });

    if (!hasTrendData && dept.chartInstance.value) {
      dept.chartInstance.value.setOption({ graphic: [{ type: 'text', ...emptyTextStyle }] }, false);
    }
  }

  // 违规类型分布
  if (violationChartRef.value && viewMode.value === 'admin') {
    violation.initChart(echarts);
    const violationData = Array.isArray(stats.value.topViolations) ? stats.value.topViolations : [];
    if (violationData.length === 0) {
      violation.chartInstance.value?.setOption({ graphic: [{ type: 'text', ...emptyTextStyle }] });
    } else {
      violation.chartInstance.value?.setOption({
        backgroundColor: 'transparent',
        tooltip: { ...baseTooltip, trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(239,68,68,0.04)' } } },
        grid: { left: '3%', right: '5%', bottom: '3%', containLabel: true },
        xAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: splitLineColor } },
          axisLabel: { color: textColor, fontSize: 12 },
        },
        yAxis: {
          type: 'category',
          data: violationData.map((v: any) => v.standardTitle || '未知').reverse(),
          axisLine: { lineStyle: { color: axisLineColor } },
          axisLabel: { color: textColor, fontSize: 12, width: 120, overflow: 'truncate' },
        },
        series: [{
          name: '违反次数',
          type: 'bar',
          barWidth: '56%',
          data: violationData.map((v: any) => v.count).reverse(),
          itemStyle: { color: '#EF4444', borderRadius: [0, 6, 6, 0] },
        }],
      });
    }
  }

  // 任务状态分布饼图
  if (statusChartRef.value && viewMode.value === 'admin') {
    status.initChart(echarts);
    const ts = stats.value.taskStats || {};
    const statusData = [
      { value: ts.PENDING || 0, name: '排队中', itemStyle: { color: '#9CA3AF' } },
      { value: ts.PROCESSING || 0, name: '审查中', itemStyle: { color: '#2563EB' } },
      { value: ts.COMPLETED || 0, name: '已完成', itemStyle: { color: '#10B981' } },
      { value: ts.FAILED || 0, name: '失败', itemStyle: { color: '#EF4444' } },
    ].filter(d => d.value > 0);

    if (statusData.length === 0) {
      status.chartInstance.value?.setOption({ graphic: [{ type: 'text', ...emptyTextStyle }] });
    } else {
      status.chartInstance.value?.setOption({
        backgroundColor: 'transparent',
        tooltip: { ...baseTooltip, trigger: 'item', formatter: '{b}: {c} ({d}%)' },
        legend: { bottom: '2%', textStyle: { color: textColor, fontSize: 12 }, itemGap: 20 },
        series: [{
          name: '任务状态',
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '46%'],
          avoidLabelOverlap: false,
          itemStyle: { borderRadius: 8, borderColor: '#FFFFFF', borderWidth: 3 },
          label: { show: false, position: 'center' },
          emphasis: { label: { show: true, fontSize: 18, fontWeight: 'bold', color: '#111827' } },
          labelLine: { show: false },
          data: statusData,
        }],
      });
    }
  }

  // 左下角：用户视图任务状态饼图
  if (typoChartRef.value && viewMode.value === 'user') {
    typo.initChart(echarts);
    const ts = stats.value.taskStats;
    typo.chartInstance.value?.setOption({
      backgroundColor: 'transparent',
      tooltip: { ...baseTooltip, trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      legend: { bottom: '2%', textStyle: { color: textColor, fontSize: 12 }, itemGap: 20 },
      series: [{
        name: '任务状态',
        type: 'pie',
        radius: ['42%', '68%'],
        center: ['50%', '46%'],
        avoidLabelOverlap: false,
        itemStyle: { borderRadius: 8, borderColor: '#FFFFFF', borderWidth: 3 },
        label: { show: false, position: 'center' },
        emphasis: { label: { show: true, fontSize: 18, fontWeight: 'bold', color: '#111827' } },
        labelLine: { show: false },
        data: [
          { value: ts.PENDING, name: '排队中', itemStyle: { color: '#9CA3AF' } },
          { value: ts.PROCESSING, name: '审查中', itemStyle: { color: '#2563EB' } },
          { value: ts.COMPLETED, name: '已完成', itemStyle: { color: '#10B981' } },
          { value: ts.FAILED, name: '失败', itemStyle: { color: '#EF4444' } },
        ].filter(d => d.value > 0),
      }],
    });
  }
};

// ===== 生命周期 =====
let refreshTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  fetchStats();
  fetchRecentTasks();
  // 每 60 秒自动刷新
  refreshTimer = setInterval(() => {
    fetchStats();
    if (viewMode.value === 'user') fetchRecentTasks();
  }, 60000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<style scoped>
.dashboard-container {
  padding: 0;
}

/* ===== Header ===== */
.header {
  margin-bottom: var(--space-6);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left h2 {
  margin: 0;
  font-size: var(--text-xl);
  color: #0f172a;
  font-weight: 700;
}

.header-right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.time-range-group {
  margin-right: var(--space-2);
}

.header-divider {
  color: #cbd5e1;
  font-size: var(--text-base);
}

.view-toggle-btn {
  font-size: var(--text-sm);
  color: #64748b;
  font-weight: 500;
}

.view-toggle-btn:hover {
  color: #2563eb;
}

.refresh-btn {
  font-size: var(--text-sm);
  color: #64748b;
}

.refresh-btn:hover {
  color: #2563eb;
}

.date-text {
  font-size: var(--text-sm);
  color: #64748b;
  font-weight: 500;
}

/* ===== 严重违规预警横幅 ===== */
.alert-banner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: var(--space-4) var(--space-5);
  margin-bottom: var(--space-5);
  background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
  border: 1px solid #fca5a5;
  border-left: 4px solid #ef4444;
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 16px rgba(239, 68, 68, 0.12);
}

.alert-body {
  flex: 1;
}

.alert-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-base);
  color: #991b1b;
  font-weight: 700;
  margin-bottom: var(--space-2);
}

.alert-depts {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.alert-dept-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: #7f1d1d;
  font-weight: 500;
}

.alert-dept-icon {
  flex-shrink: 0;
}

.alert-detail-link {
  font-size: var(--text-xs);
  color: #dc2626;
  font-weight: 600;
}

.alert-dept-total {
  font-size: var(--text-sm);
  color: #991b1b;
  font-weight: 500;
}

.alert-actions {
  flex-shrink: 0;
  margin-left: var(--space-4);
}

.alert-dismiss-btn {
  color: #991b1b;
  font-weight: 500;
}

/* ===== 待办提醒横幅 ===== */
.todo-banner {
  padding: var(--space-4) var(--space-5);
  margin-bottom: var(--space-5);
  background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%);
  border: 1px solid #fcd34d;
  border-left: 4px solid #f59e0b;
  border-radius: var(--radius-lg);
  box-shadow: 0 4px 16px rgba(245, 158, 11, 0.12);
}

.todo-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-2);
}

.todo-title {
  font-size: var(--text-base);
  font-weight: 700;
  color: #92400e;
}

.todo-read-all-btn {
  color: #b45309;
  font-weight: 500;
}

.todo-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.todo-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: #78350f;
  font-weight: 500;
}

.todo-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.todo-dot-high { background: #ef4444; }
.todo-dot-medium { background: #f59e0b; }
.todo-dot-low { background: #3b82f6; }

.todo-action-btn {
  font-size: var(--text-xs);
  color: #b45309;
  font-weight: 600;
}

/* ===== KPI Grid ===== */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.kpi-grid-5 {
  grid-template-columns: repeat(5, 1fr);
}

.kpi-card {
  background: linear-gradient(145deg, #ffffff 0%, #f8fafc 100%);
  border: 1px solid #e2e8f0;
  border-left: 4px solid;
  border-radius: var(--radius-lg);
  padding: 24px 22px;
  transition: all 0.25s ease;
  cursor: default;
  position: relative;
  overflow: hidden;
}

.kpi-card::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 100px;
  height: 100px;
  border-radius: 50%;
  opacity: 0.06;
  transform: translate(30%, -30%);
  transition: opacity 0.25s ease;
}

.kpi-card:hover::before {
  opacity: 0.12;
}

.kpi-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08);
}

.kpi-primary { border-left-color: #2563eb; }
.kpi-primary::before { background: #2563eb; }
.kpi-primary:hover { box-shadow: 0 12px 24px rgba(37, 99, 235, 0.12); }

.kpi-success { border-left-color: #10b981; }
.kpi-success::before { background: #10b981; }
.kpi-success:hover { box-shadow: 0 12px 24px rgba(16, 185, 129, 0.12); }

.kpi-warning { border-left-color: #f59e0b; }
.kpi-warning::before { background: #f59e0b; }
.kpi-warning:hover { box-shadow: 0 12px 24px rgba(245, 158, 11, 0.12); }

.kpi-danger { border-left-color: #ef4444; }
.kpi-danger::before { background: #ef4444; }
.kpi-danger:hover { box-shadow: 0 12px 24px rgba(239, 68, 68, 0.12); }

.kpi-body {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.kpi-info {
  flex: 1;
  min-width: 0;
}

.kpi-label {
  font-size: var(--text-sm);
  color: #334155;
  margin-bottom: var(--space-2);
  font-weight: 600;
  letter-spacing: 0.3px;
}

.kpi-value {
  font-size: var(--text-3xl);
  line-height: 1.2;
  letter-spacing: -0.02em;
  font-weight: 800;
}

.kpi-value .unit {
  font-size: var(--text-base);
  font-weight: 600;
  margin-left: 3px;
  opacity: 0.7;
}

.kpi-trend {
  font-size: var(--text-xs);
  margin-top: var(--space-1);
  color: #475569;
  font-weight: 600;
}

.trend-up { color: #059669; }
.trend-down { color: #dc2626; }

.value-primary { color: #2563eb; }
.value-warning { color: #f59e0b; }
.value-danger { color: #ef4444; }
.value-success { color: #10b981; }

/* KPI Icon */
.kpi-icon-wrap {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 48px;
  height: 48px;
}

.kpi-icon-inner {
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  border-radius: var(--radius-md);
  font-size: 22px;
}

.primary-icon-bg { background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); color: #2563eb; }
.warning-icon-bg { background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); color: #f59e0b; }
.danger-icon-bg { background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%); color: #ef4444; }
.success-icon-bg { background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); color: #10b981; }

/* 严重问题 KPI 脉冲动画 */
.kpi-danger .kpi-icon-inner {
  animation: pulse-red 2s infinite;
}

@keyframes pulse-red {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.3); }
  50% { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0); }
}

/* ===== Chart Area ===== */
.chart-row {
  margin-bottom: var(--space-5);
}

.chart-card {
  height: 420px;
  border-radius: var(--radius-lg);
  border: 1px solid #d1d5db;
  background: #ffffff;
}

.chart-card :deep(.el-card__header) {
  border-bottom: 1px solid #e2e8f0;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  padding: 16px 20px;
}

.chart-card :deep(.el-card__body.el-card__body) {
  padding: 16px 20px 20px;
}

.card-header {
  font-weight: 700;
  font-size: var(--text-lg);
  color: #1e293b;
  letter-spacing: 0.3px;
}

.panel-header {
  padding: 16px 20px 0;
}

/* ===== 部门效率表格 ===== */
.dept-efficiency-card {
  height: 420px;
  display: flex;
  flex-direction: column;
}

.dept-efficiency-table {
  padding: 8px 20px 20px;
  flex: 1;
  overflow-y: auto;
}

.dept-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.dept-table thead th {
  text-align: left;
  padding: 10px 12px;
  color: #475569;
  font-weight: 700;
  font-size: var(--text-xs);
  border-bottom: 2px solid #cbd5e1;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.dept-table tbody td {
  padding: 12px;
  border-bottom: 1px solid #e2e8f0;
  color: #1e293b;
  vertical-align: middle;
}

.dept-table tbody tr:hover {
  background: #f8fafc;
}

.dept-table tbody tr.row-highlight {
  background: #fef3c7;
}

.dept-table tbody tr.row-highlight:hover {
  background: #fef9c3;
}

.dept-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #0f172a;
}

.dept-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.cell-warn {
  color: #ef4444;
  font-weight: 600;
}

.compliance-bar-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.compliance-bar-bg {
  flex: 1;
  height: 8px;
  background: #e2e8f0;
  border-radius: 4px;
  overflow: hidden;
}

.compliance-bar-fill {
  height: 100%;
  border-radius: 4px;
  background: #10b981;
  transition: width 0.5s ease;
}

.compliance-bar-fill.bar-warn {
  background: #f59e0b;
}

.compliance-value {
  font-size: var(--text-xs);
  font-weight: 700;
  color: #334155;
  min-width: 36px;
  text-align: right;
}

.empty-cell {
  text-align: center;
  color: #64748b;
  font-weight: 500;
  padding: 40px 0;
}

/* ===== 最近任务面板 ===== */
.recent-tasks-panel {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: var(--radius-lg);
  height: 420px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.recent-task-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 var(--space-5);
}

.recent-task-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-3) 0;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
  transition: all 0.15s;
}

.recent-task-item:hover {
  background: #f8fafc;
}

.task-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.task-name {
  font-size: var(--text-base);
  color: #0f172a;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-time {
  font-size: var(--text-xs);
  color: #64748b;
  font-weight: 500;
}

.panel-footer {
  padding: 8px 20px 16px;
}

.empty-hint {
  text-align: center;
  color: #64748b;
  font-size: var(--text-sm);
  font-weight: 500;
  padding: var(--space-10) 0;
}

/* ===== 我的问题待处理面板 ===== */
.pending-issues-panel {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: var(--radius-lg);
  height: 420px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.pending-issues-panel .card-header {
  padding: 16px 20px 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pending-issues-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px var(--space-5) 16px;
}

.pending-issue-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 0;
}

.issue-divider {
  border-top: 1px solid #f1f5f9;
}

.issue-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.severity-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.severity-high { background: #ef4444; }
.severity-medium { background: #f59e0b; }
.severity-low { background: #3b82f6; }

.issue-file {
  font-size: var(--text-sm);
  color: #1e293b;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issue-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}

/* ===== 快捷操作卡片 ===== */
.quick-actions-card {
  background: #ffffff;
  border: 1px solid #e2e8f0;
  border-radius: var(--radius-lg);
  height: 420px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.quick-actions {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-4);
  padding: var(--space-5) var(--space-5) var(--space-5);
  flex: 1;
  align-content: center;
}

.action-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: 32px var(--space-4);
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: var(--radius-lg);
  cursor: pointer;
  transition: all 0.25s ease;
  font-size: var(--text-sm);
  color: #1e293b;
  font-weight: 700;
  position: relative;
  overflow: hidden;
}

.action-card::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(37, 99, 235, 0.06) 0%, rgba(16, 185, 129, 0.06) 100%);
  opacity: 0;
  transition: opacity 0.25s ease;
}

.action-card:hover::after {
  opacity: 1;
}

.action-card:hover {
  border-color: #3b82f6;
  box-shadow: 0 8px 20px rgba(37, 99, 235, 0.1);
  transform: translateY(-3px);
  color: #1d4ed8;
}

.action-card span {
  position: relative;
  z-index: 1;
}

/* ===== 响应式 ===== */
@media (max-width: 1400px) {
  .kpi-grid-5 {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 1200px) {
  .kpi-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .kpi-grid-5 {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
