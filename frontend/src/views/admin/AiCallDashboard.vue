<template>
  <div class="ai-call-dashboard">
    <h2>AI 调用看板</h2>
    <el-row :gutter="20">
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-value">{{ totalCalls }}</div>
            <div class="stat-label">总调用次数</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-value">{{ totalTokens }}</div>
            <div class="stat-label">总 Token 消耗</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-value">{{ avgLatency }}ms</div>
            <div class="stat-label">平均响应时间</div>
          </div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card>
          <div class="stat-card">
            <div class="stat-value">{{ errorRate }}%</div>
            <div class="stat-label">错误率</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card style="margin-top: 20px">
      <template #header>
        <span>每日 Token 消耗趋势（近 30 天）</span>
      </template>
      <div ref="chartRef" style="height: 300px"></div>
    </el-card>

    <el-card style="margin-top: 20px">
      <template #header>
        <span>模型调用分布</span>
      </template>
      <el-table :data="modelStats" stripe>
        <el-table-column prop="model" label="模型" />
        <el-table-column prop="calls" label="调用次数" />
        <el-table-column prop="totalTokens" label="总 Token" />
        <el-table-column prop="avgLatency" label="平均耗时(ms)" />
        <el-table-column prop="costEstimate" label="预估成本(元)" />
      </el-table>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { ElMessage } from 'element-plus';
import * as echarts from 'echarts';
import { getAiCallStatsApi, type AiCallStats } from '@/api/system';

const totalCalls = ref(0);
const totalTokens = ref(0);
const avgLatency = ref(0);
const errorRate = ref(0);
const modelStats = ref<AiCallStats['modelStats']>([]);
const chartRef = ref<HTMLElement>();
let chart: echarts.ECharts | null = null;

onMounted(async () => {
  try {
    const res = await getAiCallStatsApi();
    const data = res.data;
    totalCalls.value = data.totalCalls;
    totalTokens.value = data.totalTokens;
    avgLatency.value = data.avgLatency;
    errorRate.value = data.errorRate;
    modelStats.value = data.modelStats;
    renderChart(data.dailyTrend);
  } catch {
    ElMessage.error('加载 AI 调用数据失败');
  }
});

onBeforeUnmount(() => {
  chart?.dispose();
});

function renderChart(trend: AiCallStats['dailyTrend']) {
  if (!chartRef.value) return;
  chart = echarts.init(chartRef.value);
  chart.setOption({
    xAxis: { type: 'category', data: trend.map(d => d.date) },
    yAxis: { type: 'value' },
    series: [{ type: 'line', data: trend.map(d => d.tokens), smooth: true, areaStyle: {} }],
    tooltip: { trigger: 'axis' },
  });
}
</script>

<style scoped>
.stat-card { text-align: center; padding: 10px; }
.stat-value { font-size: 28px; font-weight: bold; color: var(--color-action); }
.stat-label { font-size: 14px; color: var(--corp-text-secondary); margin-top: 5px; }
</style>
