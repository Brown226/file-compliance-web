<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="$emit('update:visible', $event)"
    title="选择规则库"
    width="600px"
    :close-on-click-modal="false"
    class="selection-dialog"
  >
    <div class="dialog-search">
      <el-input
        v-model="searchQuery"
        placeholder="搜索规则库名称..."
        clearable
        prefix-icon="Search"
      />
    </div>
    <div class="dialog-list">
      <div
        v-for="library in filteredList"
        :key="library.id"
        class="dialog-list-item rule-library-item"
        :class="{ 'is-selected': tempSelectedId === library.id, 'status-draft': library.status === 'draft' }"
        @click="tempSelectedId = library.id"
      >
        <div class="list-item-icon rule-icon">
          <el-icon><Files /></el-icon>
        </div>
        <div class="list-item-content">
          <div class="list-item-name-row">
            <span class="list-item-name">{{ library.name }}</span>
            <el-tag
              :type="getStatusTagType(library.status)"
              size="small"
              class="status-tag"
            >
              {{ getStatusLabel(library.status) }}
            </el-tag>
          </div>
          <div class="list-item-meta">
            <span class="meta-item" :class="{ 'meta-item--empty': library.ruleCount === 0 }">
              <el-icon><Document /></el-icon>
              {{ library.ruleCount }} 条规则
            </span>
            <span class="meta-item" v-if="library.executableCount > 0">
              <el-icon><Check /></el-icon>
              {{ library.executableCount }} 可执行
            </span>
          </div>
        </div>
        <div class="list-item-check" v-if="tempSelectedId === library.id">
          <el-icon><Check /></el-icon>
        </div>
      </div>
      <div v-if="filteredList.length === 0" class="empty-state">
        <el-empty description="未找到匹配的规则库" :image-size="80" />
      </div>
    </div>
    <template #footer>
      <div class="dialog-footer">
        <span class="dialog-footer-info">{{ tempSelectedId ? '已选择 1 个规则库' : '未选择' }}</span>
        <div class="dialog-footer-actions">
          <el-button @click="$emit('update:visible', false)">取消</el-button>
          <el-button type="primary" :disabled="!tempSelectedId" @click="handleConfirm">确认选择</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Search, Document, Check, Files } from '@element-plus/icons-vue'
import { useEnterToConfirm } from '@/composables/useEnterToConfirm'

export interface RuleLibraryItem {
  id: string
  name: string
  status: string
  ruleCount: number
  executableCount: number
}

const props = defineProps<{
  visible: boolean
  ruleLibraries: RuleLibraryItem[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'confirm', libraryId: string | null): void
}>()

const searchQuery = ref('')
const tempSelectedId = ref<string | null>(null)

watch(() => props.visible, (val) => {
  if (val) {
    searchQuery.value = ''
    tempSelectedId.value = null
  }
})

const filteredList = computed(() => {
  const list = props.ruleLibraries || []
  if (!searchQuery.value.trim()) return list
  const query = searchQuery.value.toLowerCase()
  return list.filter(lib =>
    lib.name.toLowerCase().includes(query) || lib.id.toLowerCase().includes(query)
  )
})

const getStatusTagType = (status: string): '' | 'success' | 'warning' | 'info' | 'danger' => {
  const typeMap: Record<string, '' | 'success' | 'warning' | 'info' | 'danger'> = {
    draft: 'warning',
    published: 'success',
    archived: 'info',
  }
  return typeMap[status] || 'info'
}

const getStatusLabel = (status: string) => {
  const statusMap: Record<string, string> = {
    draft: '草稿',
    published: '已发布',
    archived: '已归档',
  }
  return statusMap[status] || status || '未知'
}

const handleConfirm = () => {
  emit('confirm', tempSelectedId.value)
}

useEnterToConfirm(computed(() => props.visible), handleConfirm)
</script>

<style scoped>
.selection-dialog :deep(.el-dialog) {
  border-radius: 16px;
  overflow: hidden;
}

.selection-dialog :deep(.el-dialog__header) {
  padding: 20px 24px 16px;
  background: linear-gradient(135deg, #F0F5FF 0%, #EFF6FF 100%);
  border-bottom: 1px solid #E0E7FF;
}

.selection-dialog :deep(.el-dialog__title) {
  font-size: 18px;
  font-weight: 700;
  color: #1E293B;
}

.selection-dialog :deep(.el-dialog__body) {
  padding: 20px 24px;
}

.selection-dialog :deep(.el-dialog__footer) {
  padding: 16px 24px 20px;
  border-top: 1px solid #E5E7EB;
}

.dialog-search {
  margin-bottom: 16px;
}

.dialog-search :deep(.el-input__wrapper) {
  border-radius: 10px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  transition: all 0.25s ease;
}

.dialog-search :deep(.el-input__wrapper:hover) {
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.12);
}

.dialog-list {
  max-height: 360px;
  overflow-y: auto;
  border-radius: 12px;
  border: 1px solid #E2E8F0;
  background: #FAFBFC;
}

.dialog-list::-webkit-scrollbar {
  width: 6px;
}

.dialog-list::-webkit-scrollbar-thumb {
  background: #CBD5E1;
  border-radius: 3px;
}

.dialog-list::-webkit-scrollbar-track {
  background: transparent;
}

.dialog-list-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-bottom: 1px solid #F1F5F9;
}

.dialog-list-item:last-child {
  border-bottom: none;
}

.dialog-list-item:hover {
  background: white;
}

.dialog-list-item.is-selected {
  background: linear-gradient(135deg, #EFF6FF 0%, #F0F4FF 100%);
}

.list-item-icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #DBEAFE, #BFDBFE);
  color: #3B82F6;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 18px;
}

.list-item-icon.rule-icon {
  background: linear-gradient(135deg, #EDE9FE, #DDD6FE);
  color: #7C3AED;
}

.dialog-list-item.is-selected .list-item-icon {
  background: linear-gradient(135deg, #3B82F6, #6366F1);
  color: white;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.dialog-list-item.is-selected .list-item-icon.rule-icon {
  background: linear-gradient(135deg, #7C3AED, #A855F7);
}

.list-item-content {
  flex: 1;
  min-width: 0;
}

.list-item-name {
  font-size: 14px;
  font-weight: 600;
  color: #1E293B;
  margin-bottom: 2px;
}

.list-item-check {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3B82F6, #6366F1);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  animation: checkPop 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  flex-shrink: 0;
}

.empty-state {
  padding: 40px 20px;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.dialog-footer-info {
  font-size: 13px;
  color: #64748B;
  font-weight: 500;
}

.dialog-footer-actions {
  display: flex;
  gap: 10px;
}

.rule-library-item.status-draft {
  opacity: 0.85;
  border-left: 3px solid #F59E0B;
}

.rule-library-item.status-draft:hover {
  opacity: 1;
}

.list-item-name-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.list-item-name-row .list-item-name {
  margin-bottom: 0;
}

.status-tag {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.list-item-meta {
  display: flex;
  gap: 16px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #94A3B8;
}

.meta-item .el-icon {
  font-size: 13px;
}

.meta-item--empty {
  color: #F59E0B;
  font-weight: 600;
}

.meta-item--empty .el-icon {
  color: #F59E0B;
}

@keyframes checkPop {
  0% { transform: scale(0); }
  50% { transform: scale(1.2); }
  100% { transform: scale(1); }
}
</style>