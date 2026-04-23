<template>
  <div class="step-content-card">
    <!-- 顶部导航 -->
    <div class="form-nav">
      <button class="back-btn" @click="emit('prev')">
        <el-icon><ArrowLeft /></el-icon>
        返回选择
      </button>
      <div class="form-nav-center">
        <span class="form-nav-title">{{ currentModeLabel }}</span>
        <el-tag :type="modeTagType" size="small">{{ currentModeLabel }}</el-tag>
      </div>
    </div>

    <el-form :model="form" :rules="rules" ref="formRef" label-width="100px" class="task-form">
      <!-- 基本信息 -->
      <div class="form-block">
        <div class="block-label">基本信息</div>

        <el-form-item label="任务标题" prop="title">
          <el-input v-model="form.title" placeholder="请输入任务标题，如：XX项目设计文件审查" size="large" />
        </el-form-item>

        <el-form-item label="待审文件" prop="files">
          <el-upload class="up-area" drag multiple :auto-upload="false" :on-change="handleFileChange" :on-remove="handleFileRemove" :file-list="fileList" accept=".dwg,.doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx">
            <el-icon :size="48" color="var(--color-primary-300)"><UploadFilled /></el-icon>
            <p class="up-text">拖拽文件到此处，或 <em>点击浏览</em></p>
            <template #tip>
              <div class="up-hints">
                支持格式：DWG / Word / Excel / PDF / PPT &nbsp;&middot;&nbsp; 最多 50 个文件 &nbsp;&middot;&nbsp; 建议不超过 50MB
              </div>
            </template>
          </el-upload>
          <div v-if="fileList.length > 0" class="up-ok">
            <el-icon color="var(--color-success)" :size="16"><Check /></el-icon>
            已选 <strong>{{ fileList.length }}</strong> 个文件，共 <strong>{{ formatFileSize(totalFileSize) }}</strong>
          </div>
          <!-- DWG WASM 静默解析：silent 模式下组件不渲染 UI 但仍执行解析 -->
          <DwgPreview
            v-for="dwgFile in dwgPreviewFiles"
            :key="dwgFile.uid"
            :file="dwgFile.raw"
            :silent="true"
            @parsed="onDwgParsed(dwgFile.name, $event)"
            @error="onDwgParseError(dwgFile.name, $event)"
          />
        </el-form-item>
      </div>

      <!-- 知识库（以库审文/全量审查模式显示） -->
      <div v-if="showStandardSelect" class="form-block kb-block">
        <div class="block-label">
          <el-icon><Connection /></el-icon> 关联知识库
          <el-tag v-if="maxkbInitialized && selectedKnowledgeIds.length > 0" type="success" size="small" effect="dark" style="margin-left:8px;">已选 {{ selectedKnowledgeIds.length }} 个</el-tag>
        </div>
        <KnowledgeTreeSelector
          v-if="maxkbInitialized"
          :modelValue="selectedKnowledgeIds"
          @update:modelValue="emit('update:selectedKnowledgeIds', $event)"
          :multiple="true"
          :inline="true"
        />
        <div v-else class="kb-empty">
          <el-icon :size="20" color="var(--color-gray-400)"><WarningFilled /></el-icon>
          <span>MaxKB 知识库服务未初始化或不可用，请检查配置</span>
        </div>
      </div>

      <!-- 参照文件（仅以文审文） -->
      <div v-if="selectedMode === 'DOC_REVIEW'" class="form-block ref-block">
        <div class="block-label">
          <el-icon><Connection /></el-icon> 参照文件
          <el-tag size="small" type="success" v-if="refFileList.length > 0" style="margin-left:8px;">已选 {{ refFileList.length }} 个</el-tag>
        </div>
        <div class="ref-upload-card">
          <el-upload class="up-area up-ref" drag multiple :auto-upload="false" :on-change="handleRefFileChange" :on-remove="handleRefFileRemove" :file-list="refFileList" accept=".doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx">
            <div class="ref-upload-inner">
              <div class="ref-upload-icon">
                <el-icon :size="32"><UploadFilled /></el-icon>
              </div>
              <div class="ref-upload-text">
                <p class="up-text">拖拽参照文件到此处，或 <em>点击浏览</em></p>
                <span class="ref-upload-hint">上传上游文件用于比对审查 · 支持 Word、Excel、PDF、PPT</span>
              </div>
            </div>
          </el-upload>
        </div>
      </div>

      <!-- 底部按钮 -->
      <div class="card-foot card-foot-form">
        <button class="btn-default" @click="emit('reset')">重置</button>
        <button class="btn-primary" :disabled="submitting" @click="emit('submit')">
          开始审查 &#10003;
        </button>
      </div>
    </el-form>



  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { Check, UploadFilled, Connection, WarningFilled, ArrowLeft } from '@element-plus/icons-vue';
import type { UploadFile, UploadFiles, FormInstance, FormRules } from 'element-plus';
import { useFormatFileSize } from '@/composables/useFormatFileSize';
import KnowledgeTreeSelector from '@/components/KnowledgeTreeSelector.vue';
import DwgPreview from '@/components/DwgPreview.vue';
import type { DwgParsedData } from '@/utils/dwg-parser';

const { formatFileSize } = useFormatFileSize();

const props = defineProps<{
  form: { title: string; description: string };
  selectedMode: string;
  fileList: UploadFile[];
  refFileList: UploadFile[];
  submitting: boolean;
  knowledgeBases: Array<{ id: string; name: string; desc?: string; documentCount?: number }>;
  selectedKnowledgeIds: string[];
  maxkbInitialized: boolean;
}>();

const emit = defineEmits<{
  prev: [];
  reset: [];
  submit: [];
  'update:fileList': [val: UploadFile[]];
  'update:refFileList': [val: UploadFile[]];
  'update:selectedKnowledgeIds': [val: string[]];
}>();

const formRef = ref<FormInstance>();

const rules: FormRules = {
  title: [{ required: true, message: '请输入任务标题', trigger: 'blur' }]
};

const modeLabels: Record<string, string> = {
  LIBRARY_REVIEW: '以库审文', DOC_REVIEW: '以文审文', CONSISTENCY: '全文一致性',
  TYPO_GRAMMAR: '错别字/语法', MULTIMODAL: '多模态识别', CUSTOM_RULE: '自定义规则', FULL_REVIEW: '全量审查',
};

const currentModeLabel = computed(() => modeLabels[props.selectedMode] || props.selectedMode);
const modeTagType = computed(() => ({
  LIBRARY_REVIEW: 'primary', DOC_REVIEW: 'success', CONSISTENCY: 'warning',
  TYPO_GRAMMAR: '', MULTIMODAL: 'danger', CUSTOM_RULE: 'info', FULL_REVIEW: 'warning',
}[props.selectedMode] ?? ''));

const showStandardSelect = computed(() => ['LIBRARY_REVIEW', 'FULL_REVIEW'].includes(props.selectedMode));

const allowedExtensions = ['.dwg', '.doc', '.docx', '.xls', '.xlsx', '.pdf', '.ppt', '.pptx'];
const maxFileCount = 50;
const totalFileSize = computed(() => props.fileList.reduce((s, f) => s + (f.size || 0), 0));

const handleFileChange = (uploadFile: UploadFile, uploadFiles: UploadFiles) => {
  const fileName = uploadFile.name.toLowerCase();
  if (!allowedExtensions.some(ext => fileName.endsWith(ext))) {
    ElMessage.error(`文件 ${uploadFile.name} 格式不正确，仅支持: ${allowedExtensions.join(', ')}`);
    const idx = uploadFiles.indexOf(uploadFile);
    if (idx !== -1) uploadFiles.splice(idx, 1);
    return;
  }
  if (uploadFiles.length > maxFileCount) { ElMessage.warning(`最多支持上传 ${maxFileCount} 个文件`); uploadFiles.pop(); return; }
  emit('update:fileList', [...uploadFiles]);
};

const handleFileRemove = (_u: UploadFile, files: UploadFiles) => { emit('update:fileList', [...files]); };

const handleRefFileChange = (uploadFile: UploadFile, uploadFiles: UploadFiles) => {
  if (!['.doc','.docx','.xls','.xlsx','.pdf','.ppt','.pptx'].some(ext => uploadFile.name.toLowerCase().endsWith(ext))) {
    ElMessage.error('参照文件仅支持 Word, Excel, PDF, PPT 格式');
    const idx = uploadFiles.indexOf(uploadFile); if (idx !== -1) uploadFiles.splice(idx, 1); return;
  }
  emit('update:refFileList', [...uploadFiles]);
};

const handleRefFileRemove = (_u: UploadFile, files: UploadFiles) => { emit('update:refFileList', [...files]); };

// ==================== DWG WASM 预览数据收集 ====================

/** DWG 文件名 → 解析数据 */
const dwgParsedDataMap = ref<Record<string, DwgParsedData>>({});

/** 筛选出 DWG 文件用于预览 */
const dwgPreviewFiles = computed(() =>
  props.fileList.filter(f => f.name.toLowerCase().endsWith('.dwg') && f.raw)
);

/** DWG WASM 解析成功回调 */
const onDwgParsed = (fileName: string, data: DwgParsedData) => {
  // 必须重新赋值整个对象以触发 Vue 响应式更新
  dwgParsedDataMap.value = { ...dwgParsedDataMap.value, [fileName]: data };
};

/** DWG WASM 解析失败回调 */
const onDwgParseError = (fileName: string, _err: Error) => {
  const newMap = { ...dwgParsedDataMap.value };
  delete newMap[fileName];
  dwgParsedDataMap.value = newMap;
};

/** 获取所有 DWG 解析数据（按文件名映射，供父组件提交时使用） */
const getDwgParsedDataMap = (): Record<string, DwgParsedData | null> => dwgParsedDataMap.value;

/** 暴露 formRef 供父组件调用 validate */
defineExpose({ formRef, getDwgParsedDataMap });
</script>

<style scoped>
/* ===== 内容卡片容器 ===== */
.step-content-card {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-lg);
  box-shadow: var(--corp-shadow-sm);
  padding: 24px 28px;
}

.form-nav {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--corp-border-light);
}

.form-nav-center {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.form-nav-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--corp-text-primary);
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: 8px;
  border: 1.5px solid var(--corp-border-light);
  background: var(--bg-surface);
  color: var(--corp-text-secondary);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.2s ease;
}

.back-btn:hover {
  border-color: var(--corp-primary);
  color: var(--corp-primary);
  background: var(--color-primary-50);
}

.back-btn .el-icon {
  font-size: 14px;
}

.form-block { margin-bottom: 22px; }

.block-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-gray-700);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: var(--space-3);
}

/* ===== 上传区域 ===== */
.up-area { width: 100%; }

.up-area :deep(.el-upload-dragger.el-upload-dragger) {
  width: 100%;
  min-height: 180px;
  border-radius: var(--radius-md);
  border: 2px dashed var(--color-gray-300);
  background: var(--color-gray-50);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 28px 20px;
  transition: all 0.2s ease;
}

.up-area :deep(.el-upload-dragger.el-upload-dragger:hover) {
  border-color: var(--corp-primary);
  background: var(--color-primary-50);
}

.up-text {
  font-size: var(--text-base);
  color: var(--corp-text-secondary);
  margin-top: var(--space-3);
  margin-bottom: 4px;
}
.up-text strong { color: var(--corp-text-primary); font-weight: 600; }
.up-text em { color: var(--corp-primary); font-style: normal; font-weight: 500; }

.up-hints {
  margin-top: var(--space-3);
  font-size: var(--text-xs);
  color: var(--color-gray-400);
}
.up-hints-sm { font-size: 11.5px; }

.up-ok {
  margin-top: var(--space-3);
  padding: 10px 16px;
  background: var(--corp-success-light);
  border-radius: var(--radius-md);
  border: 1px solid #bbf7d0;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--corp-success);
}
.up-ok strong { color: var(--corp-success); font-weight: 600; opacity: 0.85; }

.up-ref :deep(.el-upload-dragger.el-upload-dragger) { min-height: 140px; }

/* ===== 参照文件上传卡片 ===== */
.ref-upload-card {
  border-radius: 10px;
  border: 1.5px solid var(--corp-border-light);
  overflow: hidden;
  background: linear-gradient(135deg, #f0fdf4 0%, #f8fafc 100%);
}

.ref-upload-inner {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 0 8px;
}

.ref-upload-icon {
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background: rgba(22,163,74,0.08);
  color: #16a34a;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ref-upload-text {
  text-align: left;
}

.ref-upload-text .up-text {
  margin-top: 0;
}

.ref-upload-hint {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  display: block;
  margin-top: 2px;
}

/* ===== 知识库内联区域 ===== */
.kb-block .block-label {
  display: flex;
  align-items: center;
  gap: 6px;
}

.kb-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  color: #dc2626;
  font-size: var(--text-sm);
}

.ref-block { margin-top: var(--space-4); }
.ref-block .block-label { display: flex; align-items: center; gap: 6px; }
.ref-block .block-label .el-icon { color: #16a34a; }

.dialog-field { padding: var(--space-2) 0; }

/* ===== 底部操作栏 ===== */
.card-foot-form {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  padding-top: var(--space-6);
  margin-top: var(--space-4);
}

.btn-primary {
  background: var(--corp-primary);
  color: var(--corp-text-inverse);
  border: none;
  border-radius: var(--radius-sm);
  padding: 10px 28px;
  font-size: var(--text-base);
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
  font-family: inherit;
}
.btn-primary:hover:not(:disabled) { background: var(--corp-primary-dark); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

.btn-default {
  background: var(--bg-surface);
  color: var(--color-gray-700);
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-sm);
  padding: 10px 24px;
  font-size: var(--text-base);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: inherit;
}
.btn-default:hover { border-color: var(--color-gray-300); color: var(--corp-text-primary); }
</style>
