<template>
  <div class="hit-test-page">
    <div class="hit-test-header">
      <h2>检索效果测试</h2>
      <p class="hit-test-desc">测试知识库的检索质量，对比不同搜索模式和查询优化效果</p>
    </div>

    <!-- 查询区域 -->
    <el-card class="query-card" shadow="never">
      <el-form :model="form" label-position="top" @submit.prevent="handleSearch">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="测试查询">
              <el-input
                v-model="form.query"
                placeholder="输入要检索的内容，如：消防水泵扬程要求"
                clearable
                @keyup.enter="handleSearch"
              />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="知识子库">
              <el-select v-model="form.categoryId" placeholder="全部子库" clearable style="width: 100%">
                <el-option
                  v-for="cat in categories"
                  :key="cat.id"
                  :label="cat.name"
                  :value="cat.id"
                />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="返回条数">
              <el-input-number v-model="form.topNumber" :min="1" :max="50" style="width: 100%" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="6">
            <el-form-item label="搜索模式">
              <el-radio-group v-model="form.searchMode">
                <el-radio-button value="hybrid">混合</el-radio-button>
                <el-radio-button value="vector">向量</el-radio-button>
                <el-radio-button value="keyword">关键词</el-radio-button>
              </el-radio-group>
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label="查询优化">
              <el-switch
                v-model="form.enableQueryRewrite"
                active-text="开启LLM重写"
                inactive-text="关闭"
              />
            </el-form-item>
          </el-col>
          <el-col :span="6">
            <el-form-item label=" ">
              <el-button type="primary" @click="handleSearch" :loading="loading" style="width: 100%">
                <el-icon><Search /></el-icon> 开始测试
              </el-button>
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>

    <!-- 结果统计 -->
    <div v-if="result" class="stats-row">
      <el-tag type="info" effect="plain">耗时 {{ result.stats.searchTimeMs }}ms</el-tag>
      <el-tag v-if="result.stats.queryRewriteTimeMs" type="success" effect="plain">
        查询优化 {{ result.stats.queryRewriteTimeMs }}ms
      </el-tag>
      <el-tag type="info" effect="plain">候选 {{ result.stats.totalCandidates }} 条</el-tag>
      <el-tag type="warning" effect="plain">裁剪 {{ result.filteredBySimilarity }} 条</el-tag>
      <el-tag :type="result.rerankApplied ? 'success' : 'info'" effect="plain">
        Rerank {{ result.rerankApplied ? '已启用' : '未启用' }}
      </el-tag>
      <el-tag :type="result.directReturnHit ? 'success' : 'info'" effect="plain">
        Direct Return {{ result.directReturnHit ? '命中' : '未命中' }}
      </el-tag>
      <el-tag v-if="result.rewrittenQuery" type="warning" effect="plain">
        优化查询: {{ result.rewrittenQuery }}
      </el-tag>
    </div>

    <el-card v-if="result" class="query-card" shadow="never">
      <template #header>本次检索配置摘要</template>
      <div class="config-grid">
        <el-tag effect="plain">minSimilarity: {{ result.usedConfig.minSimilarity }}</el-tag>
        <el-tag effect="plain">directReturnThreshold: {{ result.usedConfig.directReturnThreshold }}</el-tag>
        <el-tag effect="plain">maxReferenceChars: {{ result.usedConfig.maxReferenceChars }}</el-tag>
        <el-tag :type="result.usedConfig.enableRerank ? 'success' : 'info'" effect="plain">
          enableRerank: {{ result.usedConfig.enableRerank }}
        </el-tag>
      </div>
    </el-card>

    <!-- 结果列表 -->
    <div v-if="result" class="results-list">
      <div v-if="result.results.length === 0" class="empty-state">
        <el-empty description="未检索到相关内容" />
      </div>
      <div
        v-for="(item, index) in result.results"
        :key="item.id"
        class="result-item"
      >
        <div class="result-item__header">
          <div class="result-item__rank">#{{ index + 1 }}</div>
          <div class="result-item__title">
            {{ item.title || '未知文档' }}
            <el-tag v-if="item.clauseId" size="small" type="primary" effect="plain" style="margin-left: 8px">
              {{ item.clauseId }}
            </el-tag>
            <el-tag v-if="item.isTable" size="small" type="warning" effect="plain" style="margin-left: 4px">
              表格
            </el-tag>
          </div>
          <div class="result-item__scores">
            <el-tag size="small" :type="scoreType(item.comprehensiveScore)" effect="plain">
              综合 {{ (item.comprehensiveScore * 100).toFixed(1) }}%
            </el-tag>
            <el-tag size="small" effect="plain">
              向量 {{ (item.vectorScore * 100).toFixed(1) }}%
            </el-tag>
            <el-tag v-if="item.rerankScore != null" size="small" type="success" effect="plain">
              Rerank {{ (item.rerankScore * 100).toFixed(1) }}%
            </el-tag>
          </div>
        </div>
        <div class="result-item__content">
          {{ item.content.substring(0, 500) }}{{ item.content.length > 500 ? '...' : '' }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { hitTestApi, getAllKnowledgeCategoriesApi, type HitTestResult, type KnowledgeCategory } from '@/api/knowledge-category'

const loading = ref(false)
const categories = ref<KnowledgeCategory[]>([])
const result = ref<HitTestResult | null>(null)

const form = ref({
  query: '',
  categoryId: '',
  topNumber: 10,
  searchMode: 'hybrid' as 'vector' | 'keyword' | 'hybrid',
  enableQueryRewrite: false,
})

onMounted(async () => {
  try {
    const res = await getAllKnowledgeCategoriesApi()
    categories.value = res.data || []
  } catch { /* ignore */ }
})

const handleSearch = async () => {
  if (!form.value.query.trim()) return
  loading.value = true
  try {
    const res = await hitTestApi({
      query: form.value.query.trim(),
      categoryId: form.value.categoryId || undefined,
      topNumber: form.value.topNumber,
      searchMode: form.value.searchMode,
      enableQueryRewrite: form.value.enableQueryRewrite,
    })
    result.value = res.data
  } catch (err: any) {
    console.error('Hit test failed:', err)
  } finally {
    loading.value = false
  }
}

const scoreType = (score: number) => {
  if (score >= 0.8) return 'success'
  if (score >= 0.5) return 'warning'
  return 'info'
}
</script>

<style scoped>
.hit-test-page {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
}
.hit-test-header h2 {
  margin: 0 0 4px 0;
  font-size: 20px;
  font-weight: 700;
  color: var(--corp-text-primary);
}
.hit-test-desc {
  margin: 0 0 20px 0;
  color: var(--corp-text-secondary);
  font-size: 14px;
}
.query-card {
  margin-bottom: 16px;
}
.stats-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.results-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.result-item {
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  box-shadow: var(--shadow-surface);
  transition: box-shadow var(--corp-transition-base);
}
.result-item:hover {
  box-shadow: var(--shadow-card);
}
.result-item__header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.result-item__rank {
  font-size: 16px;
  font-weight: 800;
  color: var(--color-primary-500);
  min-width: 32px;
}
.result-item__title {
  flex: 1;
  font-weight: 600;
  color: var(--corp-text-primary);
  font-size: 14px;
}
.result-item__scores {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.result-item__content {
  font-size: 13px;
  color: var(--corp-text-secondary);
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
}
.empty-state {
  padding: 40px 0;
}
</style>
