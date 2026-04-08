<template>
  <div class="dashboard-container">
    <div class="header">
      <h2>业务质量数据看板</h2>
    </div>

    <el-row :gutter="20" class="chart-row">
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span>最高频错别字 Top 10</span>
            </div>
          </template>
          <div ref="typoChartRef" class="chart-box"></div>
        </el-card>
      </el-col>
      <el-col :span="12">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span>最常被违反的标准规范 Top 10</span>
            </div>
          </template>
          <div ref="standardChartRef" class="chart-box"></div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="chart-row">
      <el-col :span="24">
        <el-card shadow="hover">
          <template #header>
            <div class="card-header">
              <span>各部门平均出错率对比</span>
            </div>
          </template>
          <div ref="deptChartRef" class="chart-box" style="height: 400px;"></div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, shallowRef, nextTick } from 'vue';
import * as echarts from 'echarts';

// Chart DOM refs
const typoChartRef = ref<HTMLElement | null>(null);
const standardChartRef = ref<HTMLElement | null>(null);
const deptChartRef = ref<HTMLElement | null>(null);

// ECharts instances
const typoChart = shallowRef<echarts.ECharts | null>(null);
const standardChart = shallowRef<echarts.ECharts | null>(null);
const deptChart = shallowRef<echarts.ECharts | null>(null);

const initCharts = () => {
  if (typoChartRef.value) {
    typoChart.value = echarts.init(typoChartRef.value);
    typoChart.value.setOption({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'value',
        boundaryGap: [0, 0.01]
      },
      yAxis: {
        type: 'category',
        data: ['的/得', '在/再', '需/须', '其它/其他', '做/作', '以/已', '致/至', '戴/带', '度/渡', '像/象'].reverse()
      },
      series: [
        {
          name: '出现频次',
          type: 'bar',
          data: [1200, 980, 850, 760, 650, 540, 430, 320, 210, 150].reverse(),
          itemStyle: { color: '#409EFF' }
        }
      ]
    });
  }

  if (standardChartRef.value) {
    standardChart.value = echarts.init(standardChartRef.value);
    standardChart.value.setOption({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' }
      },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'value',
        boundaryGap: [0, 0.01]
      },
      yAxis: {
        type: 'category',
        data: ['GB 50016', 'GB 50009', 'GB 50011', 'GB 50015', 'JGJ 16', 'GB 50010', 'GB 50300', 'GB 50204', 'GB 50203', 'GB 50242'].reverse()
      },
      series: [
        {
          name: '违反次数',
          type: 'bar',
          data: [850, 720, 680, 540, 490, 410, 350, 290, 210, 180].reverse(),
          itemStyle: { color: '#F56C6C' }
        }
      ]
    });
  }

  if (deptChartRef.value) {
    deptChart.value = echarts.init(deptChartRef.value);
    deptChart.value.setOption({
      tooltip: {
        trigger: 'axis'
      },
      legend: {
        data: ['建筑设计部', '结构设计部', '机电设计部', '景观设计部', '室内设计部']
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: ['1月', '2月', '3月', '4月', '5月', '6月', '7月']
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          formatter: '{value} %'
        }
      },
      series: [
        {
          name: '建筑设计部',
          type: 'line',
          data: [12.5, 11.2, 10.5, 9.8, 8.5, 7.2, 6.5]
        },
        {
          name: '结构设计部',
          type: 'line',
          data: [8.2, 7.5, 7.8, 6.5, 6.2, 5.8, 5.1]
        },
        {
          name: '机电设计部',
          type: 'line',
          data: [15.3, 14.8, 16.2, 13.5, 12.8, 11.5, 10.2]
        },
        {
          name: '景观设计部',
          type: 'line',
          data: [6.8, 7.2, 6.5, 5.8, 5.2, 4.8, 4.5]
        },
        {
          name: '室内设计部',
          type: 'line',
          data: [5.4, 5.8, 5.1, 4.5, 4.2, 3.8, 3.2]
        }
      ]
    });
  }
};

const handleResize = () => {
  typoChart.value?.resize();
  standardChart.value?.resize();
  deptChart.value?.resize();
};

onMounted(() => {
  nextTick(() => {
    initCharts();
    window.addEventListener('resize', handleResize);
  });
});

onUnmounted(() => {
  window.removeEventListener('resize', handleResize);
  typoChart.value?.dispose();
  standardChart.value?.dispose();
  deptChart.value?.dispose();
});
</script>

<style scoped>
.dashboard-container {
  padding: 20px;
}

.header {
  margin-bottom: 20px;
}

.header h2 {
  margin: 0;
  font-size: 24px;
  color: #303133;
}

.chart-row {
  margin-bottom: 20px;
}

.card-header {
  font-weight: bold;
  font-size: 16px;
}

.chart-box {
  width: 100%;
  height: 300px;
}
</style>
