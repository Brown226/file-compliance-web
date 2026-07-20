<template>
  <div class="memory-page">
    <div class="memory-container">
      <div class="section-header">
        <h2>记忆管理</h2>
        <p class="section-desc">查看和管理系统从您的编写要求中学习到的偏好记忆</p>
      </div>

      <div class="memory-content">
        <!-- 搜索框 -->
        <div class="memory-search">
          <el-input
            v-model="memorySearchQuery"
            placeholder="输入关键词进行语义搜索..."
            clearable
            @clear="loadMemories"
          >
            <template #append>
              <el-button @click="searchMemories" :loading="memorySearching">
                搜索
              </el-button>
            </template>
          </el-input>
        </div>

        <!-- 记忆列表 -->
        <div class="memory-table">
          <el-table :data="memoryList" stripe v-loading="memoryLoading">
            <el-table-column prop="content" label="记忆内容" min-width="300">
              <template #default="{ row }">
                <div class="memory-content-cell">{{ row.content }}</div>
              </template>
            </el-table-column>
            <el-table-column prop="chapter_name" label="章节" width="150">
              <template #default="{ row }">
                <span v-if="row.chapter_name">{{ row.chapter_name }}</span>
                <span v-else class="text-muted">-</span>
              </template>
            </el-table-column>
            <el-table-column prop="category" label="分类" width="120">
              <template #default="{ row }">
                <el-tag size="small" :type="getCategoryTagType(row.category)">
                  {{ getCategoryLabel(row.category) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="source_type" label="来源" width="100">
              <template #default="{ row }">
                <el-tag size="small" type="info">{{ row.source_type || 'requirement' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="created_at" label="创建时间" width="170">
              <template #default="{ row }">
                {{ formatDateTime(row.created_at) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" fixed="right">
              <template #default="{ row }">
                <el-button
                  size="small"
                  type="danger"
                  circle
                  @click="handleDeleteMemory(row.id)"
                  title="删除"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>

        <!-- 分页 -->
        <div class="memory-pagination">
          <el-pagination
            v-model:current-page="memoryPage"
            :page-size="memoryPageSize"
            :total="memoryTotal"
            layout="total, prev, pager, next"
            @current-change="handleMemoryPageChange"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete } from '@element-plus/icons-vue'
import { listMemories, recallMemories, deleteMemory, CATEGORY_LABELS, type Memory } from '@openspec/service/memory'

const memoryList = ref<Memory[]>([])
const memoryLoading = ref(false)
const memorySearching = ref(false)
const memorySearchQuery = ref('')
const memoryPage = ref(1)
const memoryPageSize = 20
const memoryTotal = ref(0)

async function loadMemories() {
  memoryLoading.value = true
  try {
    const offset = (memoryPage.value - 1) * memoryPageSize
    const data = await listMemories(memoryPageSize, offset)
    memoryList.value = data
    // 简单估算总数：如果返回满页则可能有更多
    if (data.length === memoryPageSize) {
      memoryTotal.value = Math.max(memoryTotal.value, memoryPage.value * memoryPageSize + 1)
    } else {
      memoryTotal.value = (memoryPage.value - 1) * memoryPageSize + data.length
    }
  } catch (e) {
    console.error('加载记忆失败:', e)
  } finally {
    memoryLoading.value = false
  }
}

async function searchMemories() {
  if (!memorySearchQuery.value.trim()) {
    loadMemories()
    return
  }
  memorySearching.value = true
  memoryLoading.value = true
  try {
    const data = await recallMemories(memorySearchQuery.value, 20)
    memoryList.value = data
    memoryTotal.value = data.length
    memoryPage.value = 1
  } catch (e) {
    console.error('搜索记忆失败:', e)
  } finally {
    memorySearching.value = false
    memoryLoading.value = false
  }
}

async function handleDeleteMemory(id: number) {
  try {
    await ElMessageBox.confirm('确定要删除这条记忆吗？', '提示', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
    })
    const ok = await deleteMemory(id)
    if (ok) {
      ElMessage.success('删除成功')
      loadMemories()
    } else {
      ElMessage.error('删除失败')
    }
  } catch {
    // 用户取消
  }
}

function handleMemoryPageChange(page: number) {
  memoryPage.value = page
  loadMemories()
}

function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] || category || '其他'
}

function getCategoryTagType(category: string): '' | 'success' | 'warning' | 'info' | 'danger' {
  const map: Record<string, '' | 'success' | 'warning' | 'info' | 'danger'> = {
    material_preference: 'success',
    design_parameter: '',
    standard_reference: 'warning',
    style_preference: 'danger',
    other: 'info',
  }
  return map[category] || 'info'
}

function formatDateTime(iso: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  loadMemories()
})
</script>

<style scoped>
.memory-page {
  height: 100%;
  overflow-y: auto;
  padding: 24px;
}

.memory-container {
  max-width: 1200px;
  margin: 0 auto;
}

.section-header {
  margin-bottom: 24px;
}

.section-header h2 {
  font-size: 24px;
  font-weight: 600;
  color: var(--gray-900);
  margin: 0 0 8px 0;
}

.section-desc {
  font-size: 14px;
  color: var(--gray-600);
  margin: 0;
}

.memory-search {
  margin-bottom: 16px;
}

.memory-content-cell {
  max-height: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.5;
  font-size: 13px;
}

.text-muted {
  color: var(--gray-400);
}

.memory-pagination {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}
</style>