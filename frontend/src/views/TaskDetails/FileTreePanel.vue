<template>
  <div class="file-tree-panel">
    <!-- 面板头部 -->
    <div class="panel-header">
      <div class="header-left">
        <div class="header-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <polyline points="14 2 14 8 20 8"></polyline>
          </svg>
        </div>
        <span class="panel-title">审查文件</span>
      </div>
      <div class="header-right">
        <span class="file-count">
          <span class="count-num">{{ files.length }}</span>
          <span class="count-label">个文件</span>
        </span>
      </div>
    </div>

    <!-- 文件列表 -->
    <div class="file-list" v-loading="loading">
      <TransitionGroup name="file-card" tag="div" class="file-cards-container">
        <div
          v-for="(file, index) in files"
          :key="file.id"
          :class="['file-card', { 
            active: modelValue === file.id,
            'has-error': file.error_count > 0,
            'is-processing': file.status === 'PROCESSING'
          }]"
          :style="{ '--accent-color': getFileTypeColor(file.file_type), '--card-index': index }"
          @click="handleSelectFile(file)"
        >
          <!-- 文件图标 -->
          <div class="file-icon-wrap" :style="{ '--icon-bg': getFileTypeColor(file.file_type), '--icon-color': '#fff' }">
            <el-icon><component :is="getFileTypeIcon(file.file_type)" /></el-icon>
            <!-- 文件类型角标 -->
            <span class="file-type-badge">{{ (file.file_type || '').toUpperCase().slice(0, 3) }}</span>
          </div>

          <!-- 文件信息 -->
          <div class="file-info">
            <div class="file-name-row">
              <span class="file-name" :title="file.file_name">{{ file.file_name }}</span>
              <span v-if="getStatusIcon(file)" :class="['status-dot', getStatusClass(file)]" :title="getStatusTooltip(file)">
                {{ getStatusIcon(file) }}
              </span>
            </div>
            
            <!-- 文件元信息 -->
            <div class="file-meta-row">
              <span class="meta-tag ext-tag">{{ (file.file_type || '').toUpperCase() }}</span>
              <span class="meta-separator">·</span>
              <span class="meta-text size-text">{{ formatFileSize(file.file_size) }}</span>
              
              <!-- DWG 专属元数据 -->
              <template v-if="(file.file_type || '').toLowerCase() === 'dwg' && getDwgMeta(file)">
                <span class="meta-separator">·</span>
                <span class="meta-tag dwg-layer-tag" v-if="getDwgMeta(file).layerCount">
                  {{ getDwgMeta(file).layerCount }} 层
                </span>
                <span class="meta-tag dwg-entity-tag" v-if="getDwgMeta(file).textCount || getDwgMeta(file).dimCount">
                  {{ getDwgMeta(file).textCount || 0 }} 文本 / {{ getDwgMeta(file).dimCount || 0 }} 标注
                </span>
                <span class="meta-tag dwg-convert-tag" :class="{ 'is-converted': getDwgMeta(file).converted }">
                  {{ getDwgMeta(file).converted ? 'WASM 解析 ✓' : '待解析' }}
                </span>
              </template>
              
              <!-- 错误计数徽章 -->
              <span v-if="file.error_count > 0" class="error-count-pill">
                <span class="pill-dot"></span>
                {{ file.error_count }} 问题
              </span>
              
              <!-- 通过标记 -->
              <span v-if="file.status === 'COMPLETED' && file.error_count === 0" class="pass-pill">
                ✓ 通过
              </span>
            </div>
          </div>

          <!-- 选中指示器 -->
          <div v-if="modelValue === file.id" class="active-indicator">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          </div>
        </div>
      </TransitionGroup>

      <!-- 空状态 -->
      <EmptyState 
        v-if="files.length === 0 && !loading" 
        icon="📁" 
        title="暂无文件" 
        description="请先上传待审查的文件"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Document, PictureFilled, Grid, Files } from '@element-plus/icons-vue'
import { useFormatFileSize } from '@/composables/useFormatFileSize'
import { type Component } from 'vue'
import EmptyState from '@/components/common/EmptyState.vue'

const props = defineProps<{
  files: any[]
  loading: boolean
  modelValue: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string | null]
}>()

const { formatFileSize } = useFormatFileSize()

const handleSelectFile = (file: any) => {
  if (props.modelValue === file.id) {
    emit('update:modelValue', null)
  } else {
    emit('update:modelValue', file.id)
  }
}

const getFileTypeColor = (type: string) => {
  const map: Record<string, string> = {
    dwg: '#E67E22',
    docx: '#3498DB',
    doc: '#2980B9',
    xlsx: '#27AE60',
    xls: '#229954',
    pdf: '#E74C3C',
    pptx: '#F39C12',
    ppt: '#D68910',
  }
  return map[type] || '#95A5A6'
}

const getFileTypeIcon = (type: string): Component => {
  const map: Record<string, Component> = {
    pdf: PictureFilled,
    docx: Document,
    doc: Document,
    xlsx: Grid,
    xls: Grid,
    dwg: Files,
  }
  return map[type] || Document
}

const getStatusIcon = (file: any): string => {
  if (file.status === 'PROCESSING') return '⟳'
  if (file.error_count > 0) return '!'
  if (file.status === 'COMPLETED' && file.error_count === 0) return '✓'
  return ''
}

const getStatusClass = (file: any): string => {
  if (file.status === 'PROCESSING') return 'is-processing'
  if (file.error_count > 0) return 'has-warning'
  if (file.status === 'COMPLETED' && file.error_count === 0) return 'has-pass'
  return ''
}

const getStatusTooltip = (file: any): string => {
  if (file.status === 'PROCESSING') return '审查中...'
  if (file.error_count > 0) return `发现 ${file.error_count} 个问题`
  if (file.status === 'COMPLETED' && file.error_count === 0) return '审查通过，无问题'
  return ''
}

/** 提取 DWG 文件的元数据信息 */
const getDwgMeta = (file: any): { layerCount?: number; textCount?: number; dimCount?: number; converted?: boolean; wasmParsed?: boolean } | null => {
  const meta = file.dwgMetadata || file.dwg_metadata
  if (!meta) return null
  return {
    layerCount: meta.layers?.length || meta.dwg_layers?.length || meta.layerCount,
    textCount: meta.textCount || meta.dwg_text_count,
    dimCount: meta.dimensionCount || meta.dwg_dimension_count,
    converted: meta.converted || meta.dwg_converted || meta.dwg_wasm_parsed,
    wasmParsed: meta.dwg_wasm_parsed,
  }
}
</script>

<style scoped>
/* ===== 主容器 ===== */
.file-tree-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: linear-gradient(180deg, #fafbfc 0%, #f5f7fa 100%);
  border-radius: 16px;
  overflow: hidden;
}

/* ===== 面板头部 ===== */
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 18px 12px;
  flex-shrink: 0;
  background: transparent;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.35);
}

.header-icon svg {
  opacity: 0.95;
}

.panel-title {
  font-size: 15px;
  font-weight: 700;
  color: #1a1a2e;
  letter-spacing: -0.01em;
}

.header-right {
  display: flex;
  align-items: center;
}

.file-count {
  display: flex;
  align-items: baseline;
  gap: 3px;
  padding: 4px 10px;
  background: rgba(102, 126, 234, 0.1);
  border-radius: 20px;
}

.count-num {
  font-size: 13px;
  font-weight: 700;
  color: #667eea;
}

.count-label {
  font-size: 11px;
  color: #6b7280;
}

/* ===== 文件列表区域 ===== */
.file-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 10px 10px;
  
  /* 自定义滚动条 */
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}

.file-list::-webkit-scrollbar {
  width: 4px;
}

.file-list::-webkit-scrollbar-track {
  background: transparent;
}

.file-list::-webkit-scrollbar-thumb {
  background: #d1d5db;
  border-radius: 4px;
}

.file-cards-container {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* ===== 文件卡片 ===== */
.file-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 14px;
  border-radius: 12px;
  cursor: pointer;
  position: relative;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1.5px solid transparent;
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  animation: cardSlideIn 0.35s ease-out backwards;
  animation-delay: calc(var(--card-index, 0) * 50ms);
}

@keyframes cardSlideIn {
  from {
    opacity: 0;
    transform: translateX(-12px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

/* 悬停效果 */
.file-card:hover {
  background: #f8faff;
  border-color: rgba(102, 126, 234, 0.25);
  box-shadow: 0 4px 16px rgba(102, 126, 234, 0.08), 0 1px 4px rgba(0, 0, 0, 0.04);
  transform: translateX(3px);
}

/* 选中状态 */
.file-card.active {
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.06) 0%, rgba(118, 75, 162, 0.04) 100%);
  border-color: var(--accent-color, #667eea);
  box-shadow: 
    0 0 0 3px rgba(102, 126, 234, 0.08),
    0 4px 20px rgba(102, 126, 234, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

/* 有问题的文件 - 左侧边框提示 */
.file-card.has-error:hover:not(.active) {
  border-left-color: #ef4444;
}

/* 审查中的文件 */
.file-card.is-processing .file-icon-wrap {
  animation: pulse-glow 2s ease-in-out infinite;
}

@keyframes pulse-glow {
  0%, 100% { box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.4); }
  50% { box-shadow: 0 0 0 8px rgba(102, 126, 234, 0); }
}

/* ===== 文件图标 ===== */
.file-icon-wrap {
  position: relative;
  width: 42px;
  height: 42px;
  min-width: 42px;
  border-radius: 11px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--icon-bg);
  color: var(--icon-color);
  font-size: 19px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  transition: all 0.25s ease;
}

.file-card:hover .file-icon-wrap {
  transform: scale(1.05);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.15);
}

.file-card.active .file-icon-wrap {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

/* 文件类型角标 */
.file-type-badge {
  position: absolute;
  bottom: -4px;
  right: -4px;
  padding: 1px 5px;
  background: rgba(255, 255, 255, 0.95);
  border-radius: 4px;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: var(--icon-bg, #666);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
  text-transform: uppercase;
  line-height: 1.4;
}

/* ===== 文件信息 ===== */
.file-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.file-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.file-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #1a1a2e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
  flex: 1;
  min-width: 0;
  letter-spacing: -0.01em;
}

/* 状态圆点 */
.status-dot {
  flex-shrink: 0;
  width: 19px;
  height: 19px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}

.status-dot.is-processing {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  animation: spin 1.5s linear infinite;
}

.status-dot.has-warning {
  background: #fef2f2;
  color: #dc2626;
  border: 1px solid #fecaca;
}

.status-dot.has-pass {
  background: #f0fdf4;
  color: #16a34a;
  border: 1px solid #bbf7d0;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* ===== 文件元信息行 ===== */
.file-meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.meta-tag {
  padding: 2px 7px;
  border-radius: 5px;
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.ext-tag {
  background: rgba(107, 114, 128, 0.08);
  color: #4b5563;
}

/* DWG 元数据标签 */
.dwg-layer-tag {
  background: rgba(230, 126, 34, 0.1);
  color: #e67e22;
}

.dwg-entity-tag {
  background: rgba(52, 152, 219, 0.1);
  color: #3498db;
}

.dwg-convert-tag {
  background: rgba(107, 114, 128, 0.08);
  color: #9ca3af;
}

.dwg-convert-tag.is-converted {
  background: rgba(39, 174, 96, 0.1);
  color: #27ae60;
}

.meta-separator {
  color: #d1d5db;
  font-size: 10px;
}

.meta-text {
  font-size: 11px;
  color: #9ca3af;
  font-weight: 500;
}

.size-text {
  letter-spacing: 0.01em;
}

/* 错误计数药丸 */
.error-count-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%);
  border-radius: 10px;
  font-size: 10px;
  font-weight: 650;
  color: #dc2626;
  margin-left: auto;
  letter-spacing: 0.02em;
}

.pill-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #ef4444;
  animation: dot-pulse 1.5s ease-in-out infinite;
}

@keyframes dot-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

/* 通过标记药丸 */
.pass-pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
  border-radius: 10px;
  font-size: 10px;
  font-weight: 650;
  color: #16a34a;
  margin-left: auto;
  letter-spacing: 0.02em;
}

/* ===== 选中指示器 ===== */
.active-indicator {
  position: absolute;
  top: 50%;
  right: 10px;
  transform: translateY(-50%);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
  animation: checkPopIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
}

@keyframes checkPopIn {
  from { transform: translateY(-50%) scale(0); opacity: 0; }
  to { transform: translateY(-50%) scale(1); opacity: 1; }
}

/* ===== 过渡动画 ===== */
.file-card-enter-active {
  transition: all 0.35s ease-out;
}

.file-card-leave-active {
  transition: all 0.2s ease-in;
}

.file-card-enter-from {
  opacity: 0;
  transform: translateX(-20px);
}

.file-card-leave-to {
  opacity: 0;
  transform: translateX(20px);
}

/* ===== 响应式适配 ===== */
@media (max-width: 1100px) {
  .file-tree-panel { max-width: 220px; }
  .panel-header { padding: 12px 14px 10px; }
  .file-icon-wrap { width: 36px; height: 36px; min-width: 36px; font-size: 17px; }
  .file-type-badge { display: none; }
  .file-card { padding: 9px 11px; gap: 10px; }
  .error-count-pill, .pass-pill { font-size: 9px; padding: 2px 6px; }
}

@media (max-width: 900px) {
  .file-tree-panel { max-width: none; width: 100%; }
  .file-cards-container { flex-direction: row; flex-wrap: wrap; }
  .file-card { flex: 0 0 calc(50% - 3px); }
}
</style>
