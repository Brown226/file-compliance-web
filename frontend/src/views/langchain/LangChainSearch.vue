<template>
  <div class="lc-search-page">
    <div class="lc-search-shell">
      <aside class="lc-sidebar">
        <div class="lc-sidebar__header">
          <div class="lc-badge">LC</div>
          <div>
            <h2>知识检索</h2>
            <p class="lc-sidebar__subtitle">LangChain RAG 引擎</p>
          </div>
        </div>

        <div class="lc-sidebar__section">
          <label class="lc-label">选择知识库</label>
          <el-tree-select
            v-model="selectedCategoryId"
            :data="categoryTree"
            :props="{ label: 'name', value: 'id', children: 'children' }"
            placeholder="选择知识库分类"
            check-strictly
            filterable
            class="lc-tree-select"
          />
        </div>

        <div class="lc-sidebar__section">
          <label class="lc-label">检索增强</label>
          <div class="lc-toggle-group">
            <div class="lc-toggle-item">
              <el-switch v-model="enableMultiQuery" size="small" />
              <span>多查询扩展</span>
            </div>
            <div class="lc-toggle-item">
              <el-switch v-model="enableHyDE" size="small" />
              <span>假设性文档</span>
            </div>
          </div>
        </div>

        <div class="lc-sidebar__section">
          <label class="lc-label">返回数量</label>
          <el-slider v-model="topK" :min="1" :max="20" :step="1" show-input size="small" />
        </div>

        <div class="lc-sidebar__footer">
          <div class="lc-engine-tag">
            <span class="lc-engine-dot"></span>
            LangChain.js RAG
          </div>
        </div>
      </aside>

      <main class="lc-main">
        <div class="lc-search-bar">
          <el-input
            v-model="query"
            placeholder="输入检索内容，例如：消防泵房防火间距要求"
            size="large"
            clearable
            class="lc-search-input"
            @keydown.enter="doSearch"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <el-button
            type="primary"
            size="large"
            class="lc-search-btn"
            :loading="loading"
            :disabled="!query.trim()"
            @click="doSearch"
          >
            检索
          </el-button>
        </div>

        <div v-if="!searched && !loading" class="lc-empty">
          <div class="lc-empty__icon">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none">
              <circle cx="32" cy="32" r="28" stroke="#E5E7EB" stroke-width="2" stroke-dasharray="6 4"/>
              <circle cx="32" cy="32" r="12" fill="#EFF6FF" stroke="#3B82F6" stroke-width="2"/>
              <path d="M28 32L31 35L37 29" stroke="#3B82F6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <h3>输入关键词开始检索</h3>
          <p>支持多查询扩展和假设性文档嵌入，提升召回率</p>
        </div>

        <div v-if="loading" class="lc-loading">
          <div class="lc-loading__spinner"></div>
          <p>正在检索知识库...</p>
          <p class="lc-loading__hint">MultiQuery 生成变体查询 → 向量检索 → Rerank 重排序</p>
        </div>

        <div v-if="searched && !loading" class="lc-results">
          <div class="lc-results__header">
            <span class="lc-results__count">找到 {{ results.length }} 条结果</span>
            <span class="lc-results__time">耗时 {{ searchTime }}ms</span>
          </div>

          <div v-if="debugInfo" class="lc-debug-panel">
            <div class="lc-debug-toggle" @click="showDebug = !showDebug">
              <el-icon><component :is="showDebug ? 'ArrowDown' : 'ArrowRight'" /></el-icon>
              <span>检索调试信息</span>
            </div>
            <div v-if="showDebug" class="lc-debug-body">
              <div v-if="debugInfo.multiQueryVariants?.length" class="lc-debug-section">
                <label>多查询变体</label>
                <div class="lc-debug-tags">
                  <el-tag v-for="v in debugInfo.multiQueryVariants" :key="v" size="small" type="info">{{ v }}</el-tag>
                </div>
              </div>
              <div v-if="debugInfo.hydeAnswer" class="lc-debug-section">
                <label>HyDE 假设性答案</label>
                <p class="lc-debug-hyde">{{ debugInfo.hydeAnswer }}</p>
              </div>
              <div class="lc-debug-section">
                <label>统计</label>
                <div class="lc-debug-stats">
                  <span>候选: {{ debugInfo.retrievedCount }}</span>
                  <span>压缩后: {{ debugInfo.afterCompressionCount }}</span>
                  <span>Rerank: {{ debugInfo.rerankApplied ? '✓' : '✗' }}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="lc-result-list">
            <div v-for="(item, idx) in results" :key="item.id" class="lc-result-card">
              <div class="lc-result-card__rank">{{ idx + 1 }}</div>
              <div class="lc-result-card__body">
                <div class="lc-result-card__header">
                  <span class="lc-result-card__title">{{ item.title || '未知文档' }}</span>
                  <span v-if="item.clauseId" class="lc-result-card__clause">{{ item.clauseId }}</span>
                  <el-tag v-if="item.isTable" size="small" type="warning">表格</el-tag>
                </div>
                <div class="lc-result-card__content">{{ item.content }}</div>
                <div class="lc-result-card__meta">
                  <span class="lc-score">
                    <span class="lc-score__label">向量分</span>
                    <span class="lc-score__value">{{ (item.score * 100).toFixed(1) }}%</span>
                  </span>
                  <span v-if="item.rerankScore" class="lc-score lc-score--rerank">
                    <span class="lc-score__label">Rerank</span>
                    <span class="lc-score__value">{{ (item.rerankScore * 100).toFixed(1) }}%</span>
                  </span>
                  <span class="lc-chunk-idx">分片 #{{ item.chunkIndex }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="results.length === 0" class="lc-no-results">
            <p>未找到相关内容，请尝试调整查询或更换知识库</p>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Search, ArrowDown, ArrowRight } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { langchainSearchApi, langchainHitTestApi, type LangChainSearchResult, type LangChainHitTestResult } from '@/api/langchain'
import { getKnowledgeTreeApi, type KnowledgeTreeNode } from '@/api/knowledge-category'

const query = ref('')
const selectedCategoryId = ref('')
const enableMultiQuery = ref(true)
const enableHyDE = ref(true)
const topK = ref(10)
const loading = ref(false)
const searched = ref(false)
const results = ref<LangChainSearchResult[]>([])
const searchTime = ref(0)
const debugInfo = ref<LangChainHitTestResult['stats'] & { multiQueryVariants?: string[]; hydeAnswer?: string; retrievedCount: number; afterCompressionCount: number; rerankApplied: boolean } | null>(null)
const showDebug = ref(false)
const categoryTree = ref<KnowledgeTreeNode[]>([])

const loadCategories = async () => {
  try {
    const { data } = await getKnowledgeTreeApi()
    categoryTree.value = data || []
  } catch {
    categoryTree.value = []
  }
}

const doSearch = async () => {
  if (!query.value.trim()) return
  if (!selectedCategoryId.value) {
    ElMessage.warning('请先选择知识库')
    return
  }

  loading.value = true
  searched.value = false
  results.value = []
  debugInfo.value = null

  try {
    const { data } = await langchainHitTestApi({
      query: query.value.trim(),
      categoryId: selectedCategoryId.value,
      topNumber: topK.value,
      enableMultiQuery: enableMultiQuery.value,
      enableHyDE: enableHyDE.value,
    })

    results.value = data.results || []
    searchTime.value = data.stats.searchTimeMs
    debugInfo.value = {
      ...data.stats,
      multiQueryVariants: data.multiQueryVariants,
      hydeAnswer: data.hydeAnswer,
      retrievedCount: data.stats.totalCandidates,
      afterCompressionCount: data.stats.afterRerank,
      rerankApplied: true,
    }
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '检索失败')
  } finally {
    loading.value = false
    searched.value = true
  }
}

onMounted(() => {
  loadCategories()
})
</script>

<style scoped>
.lc-search-page {
  height: calc(100vh - 92px);
  min-height: calc(100vh - 92px);
  color: var(--corp-text-primary);
  overflow: hidden;
  background: #f6f8fc;
}

.lc-search-shell {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr);
  gap: 16px;
  padding: 16px;
}

.lc-sidebar {
  display: flex;
  flex-direction: column;
  padding: 20px 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 20px;
  background: #fff;
  overflow-y: auto;
}

.lc-sidebar__header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 16px;
  margin-bottom: 16px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
}

.lc-badge {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%);
  color: #fff;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: -0.5px;
  flex-shrink: 0;
}

.lc-sidebar__header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.lc-sidebar__subtitle {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--corp-text-tertiary);
  letter-spacing: 0.5px;
}

.lc-sidebar__section {
  margin-bottom: 20px;
}

.lc-label {
  display: block;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--corp-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.lc-tree-select {
  width: 100%;
}

.lc-toggle-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lc-toggle-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.lc-sidebar__footer {
  margin-top: auto;
  padding-top: 16px;
  border-top: 1px solid rgba(226, 232, 240, 0.8);
}

.lc-engine-tag {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--corp-text-tertiary);
}

.lc-engine-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  animation: lc-pulse-dot 2s infinite;
}

@keyframes lc-pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.lc-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 20px;
  background: #fff;
}

.lc-search-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.8);
}

.lc-search-input {
  flex: 1;
}

.lc-search-input :deep(.el-input__wrapper) {
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px #e5e7eb;
  padding: 4px 12px;
}

.lc-search-input :deep(.el-input__wrapper:hover) {
  box-shadow: inset 0 0 0 1px #d1d5db;
}

.lc-search-input :deep(.el-input__wrapper.is-focus) {
  box-shadow: inset 0 0 0 1px #3b82f6, 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.lc-search-btn {
  flex-shrink: 0;
  border-radius: 12px;
  padding: 8px 24px;
  background: linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%);
  border: none;
  font-weight: 600;
}

.lc-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
}

.lc-empty h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.lc-empty p {
  margin: 0;
  font-size: 13px;
  color: var(--corp-text-secondary);
}

.lc-loading {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
}

.lc-loading__spinner {
  width: 36px;
  height: 36px;
  border: 3px solid #e5e7eb;
  border-top-color: #7c3aed;
  border-radius: 50%;
  animation: lc-spin 0.8s linear infinite;
}

@keyframes lc-spin {
  to { transform: rotate(360deg); }
}

.lc-loading p {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}

.lc-loading__hint {
  font-size: 12px !important;
  color: var(--corp-text-tertiary) !important;
  font-weight: 400 !important;
}

.lc-results {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
}

.lc-results__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--corp-text-secondary);
}

.lc-results__count {
  font-weight: 600;
  color: var(--corp-text-primary);
}

.lc-debug-panel {
  margin-bottom: 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 12px;
  background: #faf5ff;
  overflow: hidden;
}

.lc-debug-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: #7c3aed;
}

.lc-debug-body {
  padding: 0 14px 14px;
}

.lc-debug-section {
  margin-bottom: 10px;
}

.lc-debug-section label {
  display: block;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--corp-text-tertiary);
  text-transform: uppercase;
}

.lc-debug-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.lc-debug-hyde {
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fff;
  font-size: 12px;
  line-height: 1.7;
  color: var(--corp-text-secondary);
  max-height: 120px;
  overflow-y: auto;
}

.lc-debug-stats {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--corp-text-secondary);
}

.lc-result-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.lc-result-card {
  display: flex;
  gap: 14px;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 14px;
  background: #fff;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.lc-result-card:hover {
  border-color: rgba(124, 58, 237, 0.24);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.06);
}

.lc-result-card__rank {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border-radius: 8px;
  background: #f5f3ff;
  color: #7c3aed;
  font-size: 12px;
  font-weight: 700;
}

.lc-result-card__body {
  flex: 1;
  min-width: 0;
}

.lc-result-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.lc-result-card__title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lc-result-card__clause {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 6px;
  background: #eff6ff;
  color: #2563eb;
  font-weight: 500;
}

.lc-result-card__content {
  font-size: 13px;
  line-height: 1.7;
  color: var(--corp-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 10px;
}

.lc-result-card__meta {
  display: flex;
  align-items: center;
  gap: 14px;
  font-size: 11px;
}

.lc-score {
  display: flex;
  align-items: center;
  gap: 4px;
}

.lc-score__label {
  color: var(--corp-text-tertiary);
}

.lc-score__value {
  font-weight: 700;
  color: #7c3aed;
}

.lc-score--rerank .lc-score__value {
  color: #10b981;
}

.lc-chunk-idx {
  color: var(--corp-text-tertiary);
}

.lc-no-results {
  padding: 40px 20px;
  text-align: center;
  color: var(--corp-text-secondary);
  font-size: 14px;
}

@media (max-width: 1024px) {
  .lc-search-shell {
    grid-template-columns: 240px minmax(0, 1fr);
  }
}

@media (max-width: 768px) {
  .lc-search-shell {
    grid-template-columns: 1fr;
  }
}
</style>
