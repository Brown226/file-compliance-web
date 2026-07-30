<template>
  <div class="memory-panel">
    <div class="panel-header">
      <span class="panel-title">长期记忆</span>
      <div class="panel-filters">
        <el-select
          v-model="filterType"
          placeholder="类型"
          clearable
          size="small"
          style="width: 100px"
          @change="loadMemories"
        >
          <el-option label="偏好" value="preference" />
          <el-option label="例行" value="routine" />
          <el-option label="反馈" value="feedback" />
        </el-select>
        <el-select
          v-model="filterScope"
          placeholder="作用域"
          clearable
          size="small"
          style="width: 100px"
          @change="loadMemories"
        >
          <el-option label="全局" value="global" />
          <el-option label="项目" value="project" />
          <el-option label="会话" value="session" />
        </el-select>
        <el-button size="small" plain @click="loadMemories" :icon="Refresh">
          刷新
        </el-button>
      </div>
    </div>

    <div class="panel-body">
      <div v-if="loading" class="loading-state">
        <el-icon class="is-loading" :size="24"><Loading /></el-icon>
        <span>加载中…</span>
      </div>

      <div v-else-if="memories.length === 0" class="empty-state">
        <el-icon :size="32" color="#9ca3af"><Collection /></el-icon>
        <p>暂无记忆</p>
        <p class="empty-hint">Agent 会在对话中自动保存您的偏好</p>
      </div>

      <div v-else class="memory-list">
        <div
          v-for="memory in memories"
          :key="memory.id"
          class="memory-item"
        >
          <div class="memory-header">
            <el-tag size="small" :type="typeTagType(memory.type)" effect="plain">
              {{ typeLabel(memory.type) }}
            </el-tag>
            <span class="memory-key">{{ memory.key }}</span>
            <el-tag size="small" :type="scopeTagType(memory.scope)" effect="plain">
              {{ scopeLabel(memory.scope) }}
            </el-tag>
            <span class="memory-confidence">
              置信度 {{ (memory.confidence * 100).toFixed(0) }}%
            </span>
            <div class="memory-actions">
              <el-icon class="action-icon" @click="startEdit(memory)"><Edit /></el-icon>
              <el-icon class="action-icon danger" @click="handleDelete(memory)"><Delete /></el-icon>
            </div>
          </div>
          <div class="memory-value">{{ memory.value }}</div>
          <div v-if="memory.source" class="memory-source">
            来源：{{ memory.source }}
          </div>
        </div>
      </div>
    </div>

    <!-- 编辑对话框 -->
    <el-dialog v-model="editDialogVisible" title="编辑记忆" width="500px">
      <el-form v-if="editingMemory" label-width="80px">
        <el-form-item label="键">
          <span class="edit-key">{{ editingMemory.key }}</span>
        </el-form-item>
        <el-form-item label="值">
          <el-input
            v-model="editingMemory.value"
            type="textarea"
            :rows="4"
            placeholder="记忆值"
          />
        </el-form-item>
        <el-form-item label="置信度">
          <el-slider
            v-model="editingMemory.confidence"
            :min="0.5"
            :max="1"
            :step="0.05"
            show-input
            :format-tooltip="(val: number) => `${(val * 100).toFixed(0)}%`"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Loading, Collection, Edit, Delete, Refresh } from '@element-plus/icons-vue'
import {
  listMemoriesApi,
  updateMemoryApi,
  deleteMemoryApi,
  type MemoryItem,
} from '@/api/agent'

/**
 * 记忆管理面板（Task 18.3）
 *
 * - 列表展示：类型标签 + key + 作用域 + 置信度 + 值 + 来源
 * - 筛选：type / scope 下拉
 * - 编辑：弹窗修改 value 和 confidence（key 不可改）
 * - 删除：确认后调用 deleteMemoryApi
 */

const memories = ref<MemoryItem[]>([])
const loading = ref(false)
const filterType = ref('')
const filterScope = ref('')

const editDialogVisible = ref(false)
const editingMemory = ref<MemoryItem | null>(null)
const saving = ref(false)

async function loadMemories() {
  loading.value = true
  try {
    const params: { type?: string; scope?: string } = {}
    if (filterType.value) params.type = filterType.value
    if (filterScope.value) params.scope = filterScope.value
    const res = await listMemoriesApi(params)
    memories.value = res.data
  } catch (e: any) {
    ElMessage.error(`加载记忆失败: ${e?.message || e}`)
  } finally {
    loading.value = false
  }
}

function startEdit(memory: MemoryItem) {
  // 深拷贝避免直接修改原对象
  editingMemory.value = { ...memory }
  editDialogVisible.value = true
}

async function handleSave() {
  if (!editingMemory.value) return
  if (!editingMemory.value.value.trim()) {
    ElMessage.warning('记忆值不能为空')
    return
  }
  saving.value = true
  try {
    await updateMemoryApi(editingMemory.value.id, {
      value: editingMemory.value.value.trim(),
      confidence: editingMemory.value.confidence,
    })
    ElMessage.success('记忆已更新')
    editDialogVisible.value = false
    await loadMemories()
  } catch (e: any) {
    ElMessage.error(`更新失败: ${e?.message || e}`)
  } finally {
    saving.value = false
  }
}

async function handleDelete(memory: MemoryItem) {
  try {
    await ElMessageBox.confirm(
      `确定删除记忆「${memory.key}」？删除后 Agent 将不再记得此偏好。`,
      '删除记忆',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    )
    await deleteMemoryApi(memory.id)
    memories.value = memories.value.filter(m => m.id !== memory.id)
    ElMessage.success('记忆已删除')
  } catch (e: any) {
    if (e !== 'cancel' && e?.message !== 'cancel') {
      ElMessage.error(`删除失败: ${e?.message || e}`)
    }
  }
}

// ===== 标签映射 =====

function typeLabel(t: string): string {
  if (t === 'preference') return '偏好'
  if (t === 'routine') return '例行'
  if (t === 'feedback') return '反馈'
  return t
}

function typeTagType(t: string): 'primary' | 'success' | 'warning' {
  if (t === 'preference') return 'primary'
  if (t === 'routine') return 'success'
  return 'warning'
}

function scopeLabel(s: string): string {
  if (s === 'global') return '全局'
  if (s === 'project') return '项目'
  if (s === 'session') return '会话'
  return s
}

function scopeTagType(s: string): 'info' | 'warning' | 'danger' {
  if (s === 'global') return 'info'
  if (s === 'project') return 'warning'
  return 'danger'
}

onMounted(loadMemories)
defineExpose({ refresh: loadMemories })
</script>

<style scoped>
.memory-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
  flex-wrap: wrap;
  gap: 4px;
}

.panel-title {
  font-weight: 600;
  font-size: 13px;
  color: #1f2937;
}

.panel-filters {
  display: flex;
  gap: 4px;
  align-items: center;
}

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  color: #9ca3af;
  gap: 6px;
  font-size: 12px;
}

.empty-hint {
  font-size: 11px;
  color: #d1d5db;
  margin-top: 4px;
}

.memory-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.memory-item {
  padding: 8px;
  background: #f9fafb;
  border-radius: 6px;
  border: 1px solid #f3f4f6;
  transition: border-color 0.15s;
}

.memory-item:hover {
  border-color: #e5e7eb;
}

.memory-header {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 4px;
}

.memory-key {
  font-size: 12px;
  font-weight: 600;
  color: #1f2937;
  font-family: monospace;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.memory-confidence {
  font-size: 10px;
  color: #6b7280;
}

.memory-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

.memory-item:hover .memory-actions {
  opacity: 1;
}

.action-icon {
  cursor: pointer;
  color: #6b7280;
  font-size: 14px;
}

.action-icon:hover {
  color: #3b82f6;
}

.action-icon.danger:hover {
  color: #ef4444;
}

.memory-value {
  font-size: 12px;
  color: #374151;
  line-height: 1.5;
  word-break: break-all;
}

.memory-source {
  margin-top: 4px;
  font-size: 10px;
  color: #9ca3af;
}

.edit-key {
  font-family: monospace;
  font-size: 13px;
  color: #6b7280;
}
</style>
