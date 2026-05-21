<template>
  <div class="ab-review-page">
    <div class="ab-review-shell">
      <aside class="ab-sidebar">
        <div class="ab-sidebar__header">
          <div class="ab-badge">A/B</div>
          <div>
            <h2>审查对比</h2>
            <p class="ab-sidebar__subtitle">旧系统 vs LangChain 新系统</p>
          </div>
        </div>

        <div class="ab-sidebar__section">
          <label class="ab-label">选择知识库</label>
          <el-tree-select
            v-model="selectedCategoryIds"
            :data="categoryTree"
            :props="{ label: 'name', value: 'id', children: 'children' }"
            placeholder="选择一个或多个知识库"
            multiple
            filterable
            check-strictly
            collapse-tags
            collapse-tags-tooltip
            class="ab-tree-select"
          />
        </div>

        <div class="ab-sidebar__section">
          <label class="ab-label">检索增强</label>
          <div class="ab-toggle-group">
            <div class="ab-toggle-item">
              <el-switch v-model="enableMultiQuery" size="small" />
              <span>多查询扩展</span>
            </div>
            <div class="ab-toggle-item">
              <el-switch v-model="enableHyDE" size="small" />
              <span>假设性文档</span>
            </div>
            <div class="ab-toggle-item">
              <el-switch v-model="enableCompression" size="small" />
              <span>上下文压缩</span>
            </div>
          </div>
        </div>

        <div class="ab-sidebar__section">
          <label class="ab-label">审查参数</label>
          <div class="ab-field-grid">
            <div>
              <span class="ab-field-label">TopK</span>
              <el-input-number v-model="topK" :min="1" :max="20" size="small" />
            </div>
            <div>
              <span class="ab-field-label">分片长度</span>
              <el-input-number v-model="chunkSize" :min="500" :max="8000" :step="500" size="small" />
            </div>
          </div>
        </div>
      </aside>

      <main class="ab-main">
        <div class="ab-editor-card">
          <div class="ab-editor-card__header">
            <span>待审查文本</span>
            <div class="ab-toolbar">
              <span class="ab-count">{{ text.length }} 字</span>
              <el-button type="primary" :loading="loading" :disabled="!canSubmit" @click="runCompare">开始对比</el-button>
            </div>
          </div>
          <el-input
            v-model="text"
            type="textarea"
            :rows="12"
            resize="none"
            placeholder="粘贴真实审查文本，例如制度条款、方案描述、施工要求等"
          />
        </div>

        <div v-if="result" class="ab-summary-grid">
          <div class="ab-summary-card">
            <div class="ab-summary-card__title">旧系统</div>
            <div class="ab-summary-card__value">{{ result.oldSystem.issueCount }} 个问题</div>
            <div class="ab-summary-card__meta">{{ result.oldSystem.elapsedMs }} ms · {{ result.oldSystem.sourceCount }} 条引用</div>
          </div>
          <div class="ab-summary-card ab-summary-card--highlight">
            <div class="ab-summary-card__title">LangChain 新系统</div>
            <div class="ab-summary-card__value">{{ result.langchainSystem.issueCount }} 个问题</div>
            <div class="ab-summary-card__meta">{{ result.langchainSystem.elapsedMs }} ms · {{ result.langchainSystem.sourceCount }} 条引用</div>
          </div>
        </div>

        <div v-if="result" class="ab-results-grid">
          <section class="ab-panel">
            <div class="ab-panel__header">
              <h3>旧系统审查结果</h3>
              <el-tag size="small">{{ result.oldSystem.engine }}</el-tag>
            </div>
            <div class="ab-panel__body">
              <div v-if="!result.oldSystem.issues.length" class="ab-empty">未检测到问题</div>
              <div v-for="(issue, idx) in result.oldSystem.issues" :key="`old-${idx}`" class="ab-issue-card">
                <div class="ab-issue-card__title">{{ issue.title || `问题 ${idx + 1}` }}</div>
                <div class="ab-issue-card__content">{{ issue.description || issue.content || issue.suggestion || JSON.stringify(issue) }}</div>
              </div>
            </div>
          </section>

          <section class="ab-panel">
            <div class="ab-panel__header">
              <h3>LangChain 新系统结果</h3>
              <el-tag type="primary" size="small">{{ result.langchainSystem.engine }}</el-tag>
            </div>
            <div class="ab-panel__body">
              <div v-if="!result.langchainSystem.issues.length" class="ab-empty">未检测到问题</div>
              <div v-for="(issue, idx) in result.langchainSystem.issues" :key="`new-${idx}`" class="ab-issue-card ab-issue-card--new">
                <div class="ab-issue-card__title">{{ issue.title || `问题 ${idx + 1}` }}</div>
                <div class="ab-issue-card__content">{{ issue.description || issue.content || issue.suggestion || JSON.stringify(issue) }}</div>
              </div>
            </div>
          </section>
        </div>

        <div v-if="result" class="ab-debug-card">
          <div class="ab-debug-card__header">LangChain 调试信息</div>
          <div class="ab-debug-card__body">
            <div class="ab-debug-item"><span>MultiQuery</span><span>{{ result.langchainSystem.debug?.multiQueryVariants?.length || 0 }} 个变体</span></div>
            <div class="ab-debug-item"><span>HyDE</span><span>{{ result.langchainSystem.debug?.hydeAnswer ? '已启用' : '未启用' }}</span></div>
            <div class="ab-debug-item"><span>候选召回</span><span>{{ result.langchainSystem.debug?.retrievedCount || 0 }}</span></div>
            <div class="ab-debug-item"><span>压缩后</span><span>{{ result.langchainSystem.debug?.afterCompressionCount || 0 }}</span></div>
            <div class="ab-debug-item"><span>Rerank</span><span>{{ result.langchainSystem.debug?.rerankApplied ? '已启用' : '未启用' }}</span></div>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { compareReviewApi, type CompareReviewResult } from '@/api/langchain'
import { getKnowledgeTreeApi, type KnowledgeTreeNode } from '@/api/knowledge-category'

const selectedCategoryIds = ref<string[]>([])
const categoryTree = ref<KnowledgeTreeNode[]>([])
const enableMultiQuery = ref(true)
const enableHyDE = ref(true)
const enableCompression = ref(true)
const topK = ref(8)
const chunkSize = ref(4000)
const text = ref('')
const loading = ref(false)
const result = ref<CompareReviewResult | null>(null)

const canSubmit = computed(() => text.value.trim().length > 0 && selectedCategoryIds.value.length > 0)

const loadCategories = async () => {
  try {
    const { data } = await getKnowledgeTreeApi()
    categoryTree.value = data || []
  } catch {
    categoryTree.value = []
  }
}

const runCompare = async () => {
  if (!canSubmit.value) {
    ElMessage.warning('请填写待审查文本并选择知识库')
    return
  }
  loading.value = true
  result.value = null
  try {
    const { data } = await compareReviewApi({
      text: text.value.trim(),
      categoryIds: selectedCategoryIds.value,
      chunkSize: chunkSize.value,
      topK: topK.value,
      enableMultiQuery: enableMultiQuery.value,
      enableHyDE: enableHyDE.value,
      enableCompression: enableCompression.value,
      scene: 'library_review',
    })
    result.value = data
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || 'A/B 对比失败')
  } finally {
    loading.value = false
  }
}

onMounted(loadCategories)
</script>

<style scoped>
.ab-review-page { height: calc(100vh - 92px); min-height: calc(100vh - 92px); overflow: hidden; background: #f6f8fc; }
.ab-review-shell { height: 100%; display: grid; grid-template-columns: 280px minmax(0,1fr); gap: 16px; padding: 16px; }
.ab-sidebar, .ab-editor-card, .ab-summary-card, .ab-panel, .ab-debug-card { background: #fff; border: 1px solid rgba(226,232,240,.9); border-radius: 20px; box-shadow: 0 10px 30px rgba(15,23,42,.05); }
.ab-sidebar { padding: 20px 16px; display: flex; flex-direction: column; gap: 18px; }
.ab-sidebar__header { display: flex; gap: 12px; align-items: center; }
.ab-badge { width: 48px; height: 48px; border-radius: 14px; display:flex; align-items:center; justify-content:center; color:#fff; font-weight:700; background: linear-gradient(135deg,#0f766e,#2563eb); }
.ab-sidebar__subtitle { margin: 4px 0 0; color: #64748b; font-size: 13px; }
.ab-label, .ab-field-label { display:block; margin-bottom: 8px; color:#475569; font-size:13px; }
.ab-toggle-group { display:flex; flex-direction:column; gap:10px; }
.ab-toggle-item { display:flex; align-items:center; justify-content:space-between; font-size:13px; color:#334155; }
.ab-field-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.ab-main { display:flex; flex-direction:column; gap:16px; min-width:0; overflow:auto; }
.ab-editor-card { padding: 16px; }
.ab-editor-card__header, .ab-panel__header, .ab-debug-card__header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
.ab-toolbar { display:flex; align-items:center; gap:12px; }
.ab-count { color:#64748b; font-size:12px; }
.ab-summary-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.ab-summary-card { padding:16px; }
.ab-summary-card--highlight { border-color: rgba(37,99,235,.3); background: linear-gradient(180deg,#eff6ff,#fff); }
.ab-summary-card__title { color:#64748b; font-size:13px; }
.ab-summary-card__value { margin-top:6px; font-size:26px; font-weight:700; color:#0f172a; }
.ab-summary-card__meta { margin-top:4px; color:#475569; font-size:13px; }
.ab-results-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; min-height: 0; }
.ab-panel { padding:16px; min-width:0; }
.ab-panel__body { display:flex; flex-direction:column; gap:12px; max-height:420px; overflow:auto; }
.ab-issue-card { padding:12px; border-radius:14px; background:#f8fafc; border:1px solid #e2e8f0; }
.ab-issue-card--new { background:#eff6ff; border-color:#bfdbfe; }
.ab-issue-card__title { font-weight:600; color:#0f172a; margin-bottom:6px; }
.ab-issue-card__content { color:#475569; font-size:13px; line-height:1.7; white-space:pre-wrap; }
.ab-debug-card { padding:16px; }
.ab-debug-card__body { display:grid; grid-template-columns:repeat(5,1fr); gap:12px; }
.ab-debug-item { padding:12px; border-radius:12px; background:#f8fafc; border:1px solid #e2e8f0; display:flex; flex-direction:column; gap:6px; font-size:13px; color:#475569; }
.ab-empty { color:#94a3b8; text-align:center; padding:40px 0; }
@media (max-width: 1200px) { .ab-review-shell, .ab-summary-grid, .ab-results-grid, .ab-debug-card__body { grid-template-columns: 1fr; } }
</style>
