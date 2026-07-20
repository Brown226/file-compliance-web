<template>
  <div class="polish-tool">
    <h2>AI 智能润色</h2>
    <p class="subtitle">选择风格，AI 自动优化你的文本</p>

    <el-row :gutter="20">
      <!-- 左侧：输入区 -->
      <el-col :span="12">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>输入文本</span>
              <el-button size="small" @click="clearText">清空</el-button>
            </div>
          </template>
          <el-input
            v-model="inputText"
            type="textarea"
            :rows="12"
            placeholder="请输入需要润色的文本..."
            :maxlength="10000"
            show-word-limit
          />
        </el-card>
      </el-col>

      <!-- 右侧：结果区 -->
      <el-col :span="12">
        <el-card>
          <template #header>
            <div class="card-header">
              <span>润色结果</span>
              <el-button v-if="result" size="small" @click="copyResult">复制</el-button>
            </div>
          </template>
          <div v-if="result" class="result-content">
            <div class="polished-text" v-html="renderedResult"></div>
          </div>
          <div v-else class="result-placeholder">
            <el-icon :size="48"><EditPen /></el-icon>
            <p>选择风格后点击"开始润色"</p>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 风格选择 + 操作区 -->
    <el-card class="action-bar">
      <div class="action-row">
        <div class="style-selector">
          <span class="label">润色风格：</span>
          <el-radio-group v-model="selectedStyle">
            <el-radio-button
              v-for="s in styles"
              :key="s.key"
              :value="s.key"
            >
              {{ s.name }}
            </el-radio-button>
          </el-radio-group>
        </div>
        <el-button
          type="primary"
          size="large"
          :loading="loading"
          :disabled="!inputText.trim() || !selectedStyle"
          @click="doPolish"
        >
          开始润色
        </el-button>
      </div>
      <div v-if="selectedStyleDesc" class="style-desc">
        {{ selectedStyleDesc }}
      </div>
    </el-card>

    <!-- 修改对比 -->
    <el-card v-if="result && result.diffs.length > 0" class="diff-card">
      <template #header>修改对比</template>
      <el-table :data="result.diffs" stripe>
        <el-table-column prop="original" label="原文" />
        <el-table-column prop="polished" label="修改后" />
      </el-table>
    </el-card>

    <!-- 优化说明 -->
    <el-card v-if="result && result.explanations.length > 0" class="explain-card">
      <template #header>优化说明</template>
      <ul>
        <li v-for="(exp, idx) in result.explanations" :key="idx">{{ exp }}</li>
      </ul>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { EditPen } from '@element-plus/icons-vue';
import { getPolishStylesApi, doPolishApi, type PolishResult } from '@/api/polish';
import MarkdownIt from 'markdown-it';
const md = new MarkdownIt();

const inputText = ref('');
const selectedStyle = ref('');
const loading = ref(false);
const styles = ref<Array<{ key: string; name: string; description: string }>>([]);
const result = ref<PolishResult | null>(null);

const selectedStyleDesc = computed(() => {
  const s = styles.value.find(s => s.key === selectedStyle.value);
  return s ? s.description : '';
});

const renderedResult = computed(() => {
  if (!result.value?.polished) return '';
  return md.render(result.value.polished);
});

onMounted(async () => {
  try {
    const res = await getPolishStylesApi();
    styles.value = (res as any).data || [];
    if (styles.value.length > 0) {
      selectedStyle.value = styles.value[0].key;
    }
  } catch {
    ElMessage.error('加载润色风格失败');
  }
});

async function doPolish() {
  if (!inputText.value.trim() || !selectedStyle.value) return;
  loading.value = true;
  try {
    const res = await doPolishApi({ text: inputText.value, style: selectedStyle.value });
    result.value = (res as any).data;
    ElMessage.success('润色完成');
  } catch (e: any) {
    ElMessage.error(e.message || '润色失败');
  } finally {
    loading.value = false;
  }
}

function clearText() {
  inputText.value = '';
  result.value = null;
}

async function copyResult() {
  if (!result.value?.polished) return;
  try {
    await navigator.clipboard.writeText(result.value.polished);
    ElMessage.success('已复制到剪贴板');
  } catch {
    ElMessage.warning('复制失败，请手动选择复制');
  }
}
</script>

<style scoped>
.polish-tool { max-width: 1200px; margin: 0 auto; padding: 20px; }
.subtitle { color: #909399; margin-bottom: 20px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.result-placeholder { text-align: center; padding: 60px 0; color: #c0c4cc; }
.result-placeholder p { margin-top: 12px; }
.polished-text { line-height: 1.8; }
.polished-text :deep(h3) { margin: 12px 0 8px; }
.polished-text :deep(table) { width: 100%; border-collapse: collapse; margin: 12px 0; }
.polished-text :deep(td), .polished-text :deep(th) { border: 1px solid #e4e7ed; padding: 8px; }
.action-bar { margin-top: 16px; }
.action-row { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.style-selector { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.style-selector .label { font-size: 14px; color: #606266; white-space: nowrap; }
.style-desc { margin-top: 8px; font-size: 12px; color: #909399; }
.diff-card, .explain-card { margin-top: 16px; }
.explain-card li { margin: 4px 0; }
</style>