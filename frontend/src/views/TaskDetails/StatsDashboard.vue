<template>
  <div class="stats-dashboard">
    <div class="stats-grid">
      <div class="stat-card-dash">
        <el-icon class="stat-icon-dash" :size="18"><Document /></el-icon>
        <div class="stat-body">
          <span class="stat-value-dash">{{ totalFiles }}</span>
          <span class="stat-label-dash">审查文件</span>
        </div>
      </div>
      <div class="stat-card-dash">
        <el-icon class="stat-icon-dash" :size="18"><Aim /></el-icon>
        <div class="stat-body">
          <span class="stat-value-dash">{{ taskMode }}</span>
          <span class="stat-label-dash">审查模式</span>
        </div>
      </div>
      <div class="stat-card-dash" :class="{ 'has-issues': issueCount > 0 }">
        <el-icon class="stat-icon-dash" :size="18" :color="issueCount > 0 ? '#D97706' : '#16A34A'">
          <WarningFilled v-if="issueCount > 0" />
          <CircleCheckFilled v-else />
        </el-icon>
        <div class="stat-body">
          <span class="stat-value-dash">{{ issueCount }}</span>
          <span class="stat-label-dash">发现问题</span>
        </div>
      </div>
      <div class="stat-card-dash">
        <el-icon class="stat-icon-dash" :size="18"><DataAnalysis /></el-icon>
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
import {
  WarningFilled,
  CircleCheckFilled,
  Document,
  Aim,
  DataAnalysis,
} from '@element-plus/icons-vue'

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

<style scoped>
.stats-dashboard {
  margin-bottom: 20px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.stat-card-dash {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: #F9FAFB;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.stat-card-dash:hover {
  border-color: #D1D5DB;
  box-shadow: 0 1px 4px rgba(0,0,0,0.04);
}
.stat-card-dash.has-issues {
  background: #FEF2F2;
  border-color: #FECACA;
}

.stat-icon-dash {
  font-size: 18px;
  flex-shrink: 0;
}

.stat-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.stat-value-dash {
  font-size: 15px;
  font-weight: 700;
  color: #111827;
  line-height: 1.2;
}

.stat-label-dash {
  font-size: 11px;
  color: #6B7280;
}

/* ===== 合同审查评分卡片 ===== */
.contract-score-card {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 16px 20px;
  margin-top: 12px;
  background: linear-gradient(135deg, #F0F9FF 0%, #E0F2FE 100%);
  border: 1px solid #BAE6FD;
  border-radius: 8px;
}
.score-header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.score-value {
  font-size: 42px;
  font-weight: 800;
  line-height: 1;
}
.score-value.level-good { color: #16A34A; }
.score-value.level-warning { color: #D97706; }
.score-value.level-danger { color: #DC2626; }
.score-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.score-label {
  font-size: 12px;
  color: #6B7280;
}
.score-conclusion {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
}
.risk-summary {
  display: flex;
  gap: 20px;
  margin-left: auto;
}
.risk-item {
  text-align: center;
}
.risk-count {
  font-size: 22px;
  font-weight: 700;
  display: block;
}
.risk-item.high .risk-count { color: #DC2626; }
.risk-item.medium .risk-count { color: #D97706; }
.risk-item.low .risk-count { color: #16A34A; }
.risk-label {
  font-size: 11px;
  color: #6B7280;
}

.ai-warning-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  margin-top: 8px;
  background: rgba(230, 162, 60, 0.08);
  border: 1px solid rgba(230, 162, 60, 0.25);
  border-radius: 6px;
  font-size: 13px;
  color: #90640b;
  line-height: 1.5;
}

@media (max-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .contract-score-card {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  .risk-summary {
    margin-left: 0;
    width: 100%;
    justify-content: space-between;
  }
}
</style>
