<template>
  <div class="new-task-container">
    <!-- 步骤条 -->
    <div class="steps-card">
      <div class="steps-bar">
        <div class="step-item" :class="{ done: step > 1, active: step === 1 }">
          <div class="step-num">
            <span v-if="step > 1">&#10003;</span>
            <span v-else>1</span>
          </div>
          <div class="step-text">
            <span class="step-title">选择模式</span>
            <span class="step-sub">审查方式</span>
          </div>
        </div>
        <div class="step-line" :class="{ active: step >= 2 }"></div>
        <div class="step-item" :class="{ done: step > 2, active: step === 2 }">
          <div class="step-num">
            <span v-if="step > 2">&#10003;</span>
            <span v-else>2</span>
          </div>
          <div class="step-text">
            <span class="step-title">填写信息</span>
            <span class="step-sub">上传与配置</span>
          </div>
        </div>
        <div class="step-line" :class="{ active: step >= 3 }"></div>
        <div class="step-item" :class="{ done: step === 3, active: step === 3 }">
          <div class="step-num">
            <span v-if="step === 3">&#10003;</span>
            <span v-else>3</span>
          </div>
          <div class="step-text">
            <span class="step-title">确认提交</span>
            <span class="step-sub">核对信息</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 步骤1: 选择审查模式 -->
    <div v-if="step === 1" key="step1" class="step-content">
      <StepBasicInfo
        :selected-mode="selectedMode"
        :review-modes="reviewModes"
        @select-mode="selectMode"
        @next="step = 2"
      />
    </div>

    <!-- 步骤2: 填写表单 -->
    <div v-if="step === 2" key="step2" class="step-content">
      <StepFileUpload
        ref="stepFileUploadRef"
        :form="form"
        :selected-mode="selectedMode"
        :file-list="fileList"
        :ref-file-list="refFileList"
        :submitting="submitting"
        :knowledge-bases="knowledgeBases"
        :selected-knowledge-ids="selectedKnowledgeIds"
        :maxkb-initialized="maxkbInitialized"
        @prev="step = 1"
        @reset="resetForm"
        @submit="goToKnowledgeStep"
        @update:file-list="fileList = $event"
        @update:ref-file-list="refFileList = $event"
        @update:selected-knowledge-ids="selectedKnowledgeIds = $event"
      />
    </div>

    <!-- 步骤3: 确认提交 -->
    <div v-if="step === 3" key="step3" class="step-content">
      <StepConfirm
        :form="form"
        :selected-mode="selectedMode"
        :file-list="fileList"
        :ref-file-list="refFileList"
        :submitting="submitting"
        :knowledge-bases="knowledgeBases"
        :selected-knowledge-ids="selectedKnowledgeIds"
        @prev="step = 2"
        @submit="submitTask"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { UploadFile } from 'element-plus';
import { createTaskApi, getReviewModesApi, uploadRefFilesApi } from '@/api/task';
import { getKnowledgeBasesApi, getMaxKBStatusApi } from '@/api/maxkb';
import { useUserStore } from '@/stores/user';
import StepBasicInfo from './StepBasicInfo.vue';
import StepFileUpload from './StepFileUpload.vue';
import StepConfirm from './StepConfirm.vue';

const router = useRouter();
const userStore = useUserStore();
const stepFileUploadRef = ref<InstanceType<typeof StepFileUpload> | null>(null);

const step = ref(1);
const selectedMode = ref('FULL_REVIEW');
const reviewModes = ref<any[]>([]);
const fileList = ref<UploadFile[]>([]);
const refFileList = ref<UploadFile[]>([]);
const submitting = ref(false);
const knowledgeBases = ref<Array<{ id: string; name: string; desc?: string; documentCount?: number }>>([]);
const selectedKnowledgeIds = ref<string[]>([]);
const maxkbInitialized = ref(false);

const form = reactive({ title: '', description: '' });

const fetchReviewModes = async () => {
  try {
    const { data } = await getReviewModesApi();
    reviewModes.value = data || [];
  } catch (e) {
    reviewModes.value = [
      { mode: 'LIBRARY_REVIEW', displayName: '以库审文', description: '使用标准库+规则引擎+MaxKB/LLM进行合规检查', needsRefFiles: false, capabilities: { rules: true, standardRef: 'on', ai: true, aiStrategy: 'standard', crossFile: false, needsRefFiles: false } },
      { mode: 'DOC_REVIEW', displayName: '以文审文', description: '使用上游参照文件与待审文件进行比对审查', needsRefFiles: true, capabilities: { rules: true, standardRef: 'on', ai: true, aiStrategy: 'refCompare', crossFile: false, needsRefFiles: true } },
      { mode: 'CONSISTENCY', displayName: '全文一致性', description: '跨文件参数和语义一致性检查', needsRefFiles: false, capabilities: { rules: true, standardRef: 'on', ai: true, aiStrategy: 'standard', crossFile: true, needsRefFiles: false } },
      { mode: 'TYPO_GRAMMAR', displayName: '错别字/语法', description: '轻量级错别字和语法检查（通过MaxKB、普通LLM）', needsRefFiles: false, capabilities: { rules: true, standardRef: 'config', ai: true, aiStrategy: 'llmOnly', crossFile: false, needsRefFiles: false } },
      { mode: 'MULTIMODAL', displayName: '多模态识别', description: '表格结构化、公式识别、图纸智能分析', needsRefFiles: false, capabilities: { rules: true, standardRef: 'config', ai: true, aiStrategy: 'multimodal', crossFile: false, needsRefFiles: false } },
      { mode: 'CUSTOM_RULE', displayName: '自定义规则', description: '用户自定义规则审查（仅执行启用的规则）', needsRefFiles: false, capabilities: { rules: true, standardRef: 'config', ai: false, aiStrategy: 'standard', crossFile: false, needsRefFiles: false } },
      { mode: 'FULL_REVIEW', displayName: '全量审查', description: '执行所有规则和AI审查（后续兼容默认模式）', needsRefFiles: false, capabilities: { rules: true, standardRef: 'on', ai: true, aiStrategy: 'standard', crossFile: true, needsRefFiles: false } },
    ];
  }
};

const fetchKnowledgeBases = async () => {
  try {
    const { data } = await getMaxKBStatusApi();
    maxkbInitialized.value = data?.initialized && data?.maxkbReachable;
    if (maxkbInitialized.value) {
      const kbRes = await getKnowledgeBasesApi();
      knowledgeBases.value = kbRes.data || [];
    }
  } catch (e) { maxkbInitialized.value = false; }
};

onMounted(() => { fetchReviewModes(); fetchKnowledgeBases(); });

const selectMode = (mode: string) => { selectedMode.value = mode; };

/** 步骤2点击"开始审查"/点击知识库按钮时先做表单验证，通过后直接进入步骤3确认提交 */
const goToKnowledgeStep = async () => {
  const formRef = stepFileUploadRef.value?.formRef;
  if (!formRef) return;
  await formRef.validate(async (valid) => {
    if (!valid) return;
    if (!fileList.value.length) { ElMessage.warning('请至少上传一个文件用于审查'); return; }
    if (selectedMode.value === 'DOC_REVIEW' && !refFileList.value.length) {
      ElMessage.warning('以文审文模式请至少上传一个参照文件');
      return;
    }
    // 直接跳到步骤3（确认提交），不再经过知识库独立页面
    step.value = 3;
  });
};

/** 步骤3确认提交 */
const submitTask = async () => {
  // 检查用户是否已登录
  if (!userStore.token) {
    ElMessage.error('请先登录后再创建任务');
    router.push('/login');
    return;
  }

  submitting.value = true;
  try {
    const fd = new FormData();
    fd.append('title', form.title);
    fd.append('reviewMode', selectedMode.value);
    if (form.description) fd.append('description', form.description);
    if (selectedKnowledgeIds.value.length > 0) fd.append('maxkbKnowledgeIds', JSON.stringify(selectedKnowledgeIds.value));
    fileList.value.forEach(f => { if (f.raw) fd.append('files', f.raw); });

    // 附加 DWG WASM 解析数据（按文件名映射）
    // ★ 如果组件事件未收集到数据（WASM 加载慢/失败），在提交时直接同步解析
    let dwgDataMap = stepFileUploadRef.value?.getDwgParsedDataMap?.() || {};
    const dwgFiles = fileList.value.filter(f => f.name.toLowerCase().endsWith('.dwg') && f.raw);
    
    // 对没有解析数据的 DWG 文件，提交时直接调用 WASM 解析
    if (dwgFiles.length > 0 && Object.keys(dwgDataMap).length < dwgFiles.length) {
      console.log('[submitTask] 部分DWG文件未解析，提交时补充解析...');
      const { parseDwgFile } = await import('@/utils/dwg-parser');
      for (const f of dwgFiles) {
        if (!dwgDataMap[f.name]) {
          try {
            console.log('[submitTask] 解析 DWG:', f.name);
            const data = await parseDwgFile(f.raw!);
            dwgDataMap[f.name] = data;
            console.log('[submitTask] DWG 解析成功:', f.name, 'layers:', data.layers?.length);
          } catch (e) {
            console.error('[submitTask] DWG 解析失败:', f.name, e);
          }
        }
      }
    }
    
    if (Object.keys(dwgDataMap).length > 0) {
      fd.append('dwgParsedData', JSON.stringify(dwgDataMap));
      console.log('[submitTask] dwgParsedData appended, files:', Object.keys(dwgDataMap));
    } else if (dwgFiles.length > 0) {
      console.warn('[submitTask] 所有 DWG WASM 解析均失败，将使用后端降级审查');
    }

    const { data: task } = await createTaskApi(fd);
    if (selectedMode.value === 'DOC_REVIEW' && refFileList.value.length && task?.id) {
      const rfd = new FormData();
      refFileList.value.forEach(f => { if (f.raw) rfd.append('files', f.raw); });
      await uploadRefFilesApi(task.id, rfd);
    }
    ElMessage.success('审查任务创建成功！');
    router.push('/tasks/history');
  } catch (e) {
    console.error('创建任务失败:', e);
    ElMessage.error('创建任务失败: ' + (e instanceof Error ? e.message : String(e)));
  } finally { submitting.value = false; }
};

const resetForm = () => {
  const formRef = stepFileUploadRef.value?.formRef;
  if (!formRef) return;
  formRef.resetFields();
  fileList.value = [];
  refFileList.value = [];
  selectedKnowledgeIds.value = [];
};
</script>

<style scoped>
.new-task-container {
  background: var(--bg-body);
  padding: var(--space-6) var(--space-5);
}

.steps-card {
  max-width: 960px;
  margin: 0 auto var(--space-6);
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-lg);
  padding: var(--space-5) var(--space-6);
}

.steps-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.step-num {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-base);
  font-weight: 600;
  background: var(--color-gray-200);
  color: var(--corp-text-secondary);
  border: 2px solid var(--color-gray-300);
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.step-item.active .step-num {
  background: var(--corp-primary);
  color: var(--corp-text-inverse);
  border-color: transparent;
}

.step-item.done .step-num {
  background: var(--corp-success);
  color: var(--corp-text-inverse);
  border-color: transparent;
}

.step-title {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--corp-text-tertiary);
  white-space: nowrap;
  transition: color 0.2s ease;
}

.step-item.active .step-title,
.step-item.done .step-title {
  color: var(--corp-text-primary);
}

.step-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.step-sub {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  font-weight: 400;
}

.step-item.active .step-sub,
.step-item.done .step-sub {
  color: var(--corp-text-secondary);
}

.step-line {
  width: 64px;
  height: 2px;
  background: var(--color-gray-200);
  margin: 0 var(--space-4);
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.step-line.active {
  background: var(--corp-primary);
}

.step-content {
  max-width: 960px;
  margin: 0 auto;
}
</style>
