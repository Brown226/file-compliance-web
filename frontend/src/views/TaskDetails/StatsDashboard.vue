<template>
  <div class="stats-dashboard">
    <div class="stats-grid">
      <div class="stat-card-dash">
        <span class="stat-icon-dash">📄</span>
        <div class="stat-body">
          <span class="stat-value-dash">{{ totalFiles }}</span>
          <span class="stat-label-dash">审查文件</span>
        </div>
      </div>
      <div class="stat-card-dash">
        <span class="stat-icon-dash">🎯</span>
        <div class="stat-body">
          <span class="stat-value-dash">{{ taskMode }}</span>
          <span class="stat-label-dash">审查模式</span>
        </div>
      </div>
      <div class="stat-card-dash" :class="{ 'has-issues': issueCount > 0 }">
        <span class="stat-icon-dash">{{ issueCount > 0 ? '⚠️' : '✅' }}</span>
        <div class="stat-body">
          <span class="stat-value-dash">{{ issueCount }}</span>
          <span class="stat-label-dash">发现问题</span>
        </div>
      </div>
      <div class="stat-card-dash">
        <span class="stat-icon-dash">📊</span>
        <div class="stat-body">
          <span class="stat-value-dash">{{ objective }}</span>
          <span class="stat-label-dash">审查目标</span>
        </div>
      </div>
    </div>

    <!-- 合同审查评分卡片 -->
    <div v-if="isContractReview && contractScore.score > 0" class="contract-score-card">
      <div class="score-header">
        <div class="score-value" :class="scoreLevel">{{ contractScore.score }}</div>
        <div class="score-meta">
          <div class="score-label">综合评分 / 100</div>
          <div class="score-conclusion">{{ scoreConclusion }}</div>
        </div>
      </div>
      <div class="risk-summary">
        <div class="risk-item high">
          <span class="risk-count">{{ contractScore.high }}</span>
          <span class="risk-label">高风险</span>
        </div>
        <div class="risk-item medium">
          <span class="risk-count">{{ contractScore.medium }}</span>
          <span class="risk-label">中风险</span>
        </div>
        <div class="risk-item low">
          <span class="risk-count">{{ contractScore.low }}</span>
          <span class="risk-label">低风险</span>
        </div>
      </div>
    </div>

    <!-- AI 审查空结果警告 -->
    <div v-if="showAiWarning" class="ai-warning-banner">
      <el-icon color="#E6A23C" :size="16"><WarningFilled /></el-icon>
      <span>
        <template v-if="reviewMode === 'CONTRACT_REVIEW'">
          合同风险审查未发现风险条款。可能原因：上传的文件不是合同文本，或合同条款对该立场无明显风险。建议更换为正式合同文件后重新审查。
        </template>
        <template v-else>
          AI 审查未产出结果。
          <template v-if="!aiEngineUsed">任务未配置或未使用 AI 引擎。</template>
          <template v-else-if="aiEngineUsed === 'none'">AI 引擎已禁用。</template>
          <template v-else>引擎 {{ aiEngineUsed }} 已执行但未发现问题，请结合规则覆盖范围人工复核。</template>
        </template>
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { WarningFilled } from '@element-plus/icons-vue'

const props = defineProps<{
  totalFiles: number
  taskMode: string
  issueCount: number
  objective: string
  isContractReview: boolean
  contractScore: { score: number; high: number; medium: number; low: number }
  showAiWarning: boolean
  reviewMode?: string
  aiEngineUsed?: string
}>()

const scoreLevel = computed(() => {
  if (props.contractScore.score >= 80) return 'level-good'
  if (props.contractScore.score >= 60) return 'level-warning'
  return 'level-danger'
})

const scoreConclusion = computed(() => {
  if (props.contractScore.score >= 80) return '合同整体风险较低'
  if (props.contractScore.score >= 60) return '合同存在一定风险，建议重点关注中高风险项'
  return '合同风险较高，建议逐条审查并修改'
})
</script>
