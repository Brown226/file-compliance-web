<template>
  <aside class="sidebar-document-manager">
    <div class="document-manager-header">
      <h3>施工设计说明列表</h3>
      <el-button 
        type="primary" 
        :icon="Plus" 
        size="small"
        @click="$emit('createNewDocument')"
        class="new-document-btn"
      >
        新建
      </el-button>
    </div>
    
    <div class="document-list">
      <div 
        v-for="doc in documents" 
        :key="doc.id"
        class="document-item"
        :class="{ active: doc.isActive }"
      >
        <div 
          class="document-info"
          @click="$emit('switchDocument', doc.id)"
        >
          <div class="document-name">{{ doc.name }}</div>
          <div class="document-meta">
            <span class="last-modified">最后修改 {{ doc.lastModified }}</span>
          </div>
        </div>
        
        <div class="document-actions">
          <el-button
            :icon="Monitor"
            size="small"
            link
            class="export-action-btn"
            title="同步到桌面 AutoCAD"
            @click.stop="$emit('exportDocument', 'cad', doc.id)"
          />
          <el-dropdown 
            trigger="click" 
            @command="(command: string) => $emit('handleDocumentAction', command, doc.id)"
          >
            <el-button 
              :icon="MoreFilled" 
              size="small" 
              link
              class="action-btn"
            />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="export_md">导出</el-dropdown-item>
                <el-dropdown-item command="rename">重命名</el-dropdown-item>
                <el-dropdown-item command="delete" class="danger-item">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { Download, Plus, MoreFilled, Monitor } from '@element-plus/icons-vue'
import type { DocumentItem } from '../data/mockData'

// Props
interface Props {
  documents: DocumentItem[]
}

defineProps<Props>()

// Emits
defineEmits<{
  createNewDocument: []
  switchDocument: [docId: string]
  exportDocument: [format: string, docId: string]
  handleDocumentAction: [command: string, docId: string]
}>()
</script>

<style scoped>
/* 文档管理栏 */
.sidebar-document-manager {
  background: #fafbfc;
  border-right: 1px solid rgba(0, 0, 0, 0.06);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.document-manager-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.document-manager-header h3 {
  font-size: 13px;
  font-weight: 600;
  color: #374151;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin: 0;
}

.new-document-btn {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 6px;
  font-weight: 500;
  transition: all 0.2s ease;
}

.new-document-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
}

.document-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}

.document-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: 6px;
  border: 1px solid transparent;
  background: white;
}

.document-item:hover {
  background: #f8fafc;
  border-color: rgba(59, 130, 246, 0.2);
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.document-item.active {
  background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
  border-color: #3b82f6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.15);
}

.document-info {
  flex: 1;
  min-width: 0;
}

.document-name {
  font-weight: 500;
  color: #1f2937;
  font-size: 14px;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
}

.document-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.last-modified {
  font-size: 11px;
  color: #6b7280;
  font-weight: 400;
}

.document-actions {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.document-item:hover .document-actions {
  opacity: 1;
}

.action-btn {
  padding: 6px;
  color: #6b7280;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.action-btn:hover {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
}

.export-action-btn {
  padding: 6px;
  color: #6b7280;
  margin-right: 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
}

.export-action-btn:hover {
  color: #059669;
  background: rgba(5, 150, 105, 0.1);
}

.danger-item {
  color: var(--error-color);
}
</style>
