<template>
  <div class="task-details">
    <div class="header">
      <el-page-header @back="goBack" :content="`任务详情 - ${taskId}`">
      </el-page-header>
    </div>

    <div class="content-layout">
      <!-- 左侧：文件列表 -->
      <div class="left-panel">
        <div class="panel-header">
          <span>审查文件列表</span>
        </div>
        <el-menu
          :default-active="activeFileId"
          class="file-menu"
          @select="handleSelectFile"
        >
          <el-menu-item
            v-for="file in files"
            :key="file.id"
            :index="file.id"
            class="file-menu-item"
          >
            <el-icon><Document /></el-icon>
            <span class="file-name" :title="file.name">{{ file.name }}</span>
            <el-badge
              v-if="file.errorCount > 0"
              :value="file.errorCount"
              class="error-badge"
              type="danger"
            />
            <el-badge
              v-else
              value="通过"
              class="error-badge"
              type="success"
            />
          </el-menu-item>
        </el-menu>
      </div>

      <!-- 右侧：错误明细 -->
      <div class="right-panel">
        <div class="panel-header">
          <span>错误明细 {{ activeFile ? `- ${activeFile.name}` : '' }}</span>
        </div>
        
        <div class="error-content" v-if="activeFile">
          <template v-if="activeErrors.length > 0">
            <el-card
              v-for="error in activeErrors"
              :key="error.id"
              class="error-card"
              shadow="hover"
            >
              <template #header>
                <div class="card-header">
                  <div class="error-title">
                    <el-tag type="danger" size="small" class="error-type">{{ error.type }}</el-tag>
                    <span>{{ error.ruleName }}</span>
                  </div>
                  <el-button
                    v-if="error.cadHandleId"
                    type="primary"
                    size="small"
                    plain
                    @click="locateInCAD(error.cadHandleId)"
                  >
                    <el-icon><Position /></el-icon> 在 CAD 中定位
                  </el-button>
                </div>
              </template>
              <div class="error-body">
                <div class="error-row">
                  <span class="label">原文本：</span>
                  <span class="value original-text">{{ error.originalText }}</span>
                </div>
                <div class="error-row">
                  <span class="label">违反规范：</span>
                  <span class="value">{{ error.description }}</span>
                </div>
              </div>
            </el-card>
          </template>
          <el-empty v-else description="该文件未发现错误，符合规范" />
        </div>
        <div class="error-content empty-state" v-else>
          <el-empty description="请在左侧选择文件查看详情" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Document, Position } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()

const taskId = computed(() => route.params.id as string)

const goBack = () => {
  router.push('/tasks/history')
}

// Mock 数据结构
interface ErrorDetail {
  id: string
  type: string
  ruleName: string
  originalText: string
  description: string
  cadHandleId: string
}

interface FileItem {
  id: string
  name: string
  errorCount: number
  errors: ErrorDetail[]
}

const files = ref<FileItem[]>([
  {
    id: 'f1',
    name: '1层建筑平面图.dwg',
    errorCount: 2,
    errors: [
      {
        id: 'e1',
        type: '文字错误',
        ruleName: '错别字检查',
        originalText: '消防通道（消仿通道）',
        description: '存在错别字“消仿”，应改为“消防”。',
        cadHandleId: '2F4A'
      },
      {
        id: 'e2',
        type: '规范违规',
        ruleName: '门窗标注规范',
        originalText: 'M-1',
        description: '防火门应标注耐火等级，例如FM甲-1。',
        cadHandleId: '3B1C'
      }
    ]
  },
  {
    id: 'f2',
    name: '2层建筑平面图.dwg',
    errorCount: 1,
    errors: [
      {
        id: 'e3',
        type: '图层错误',
        ruleName: '图层命名规范',
        originalText: 'Layer1',
        description: '墙体图层未按照标准命名，应为 A-WALL。',
        cadHandleId: '1A9F'
      }
    ]
  },
  {
    id: 'f3',
    name: '屋顶平面图.dwg',
    errorCount: 0,
    errors: []
  },
  {
    id: 'f4',
    name: '总平面图.dwg',
    errorCount: 3,
    errors: [
      {
        id: 'e4',
        type: '规范违规',
        ruleName: '退界距离',
        originalText: '3.5m',
        description: '建筑退道路红线距离不足，要求至少5m。',
        cadHandleId: '5C22'
      },
      {
        id: 'e5',
        type: '缺失标注',
        ruleName: '坐标标注',
        originalText: '无',
        description: '建筑主要转角处缺失坐标标注。',
        cadHandleId: '8D11'
      },
      {
        id: 'e6',
        type: '文字错误',
        ruleName: '错别字检查',
        originalText: '停泊车位',
        description: '用词不规范，建议修改为“机动车停车位”。',
        cadHandleId: '9E33'
      }
    ]
  }
])

const activeFileId = ref<string>('')

onMounted(() => {
  if (files.value.length > 0) {
    activeFileId.value = files.value[0].id
  }
})

const activeFile = computed(() => {
  return files.value.find(f => f.id === activeFileId.value)
})

const activeErrors = computed(() => {
  return activeFile.value?.errors || []
})

const handleSelectFile = (index: string) => {
  activeFileId.value = index
}

const locateInCAD = async (handleId: string) => {
  try {
    await navigator.clipboard.writeText(handleId)
    ElMessage({
      message: `已复制 CAD Handle ID: ${handleId}，请在 CAD 中使用对应插件进行定位。`,
      type: 'success',
      duration: 3000
    })
  } catch (err) {
    ElMessage.error('复制失败，请重试或手动复制。')
  }
}
</script>

<style scoped>
.task-details {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #f0f2f5;
}

.header {
  padding: 16px 24px;
  background-color: #fff;
  border-bottom: 1px solid #e4e7ed;
}

.content-layout {
  flex: 1;
  display: flex;
  padding: 24px;
  gap: 24px;
  overflow: hidden;
}

.left-panel {
  width: 320px;
  background-color: #fff;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}

.right-panel {
  flex: 1;
  background-color: #fff;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  overflow: hidden;
}

.panel-header {
  padding: 16px 20px;
  font-weight: 500;
  font-size: 16px;
  color: #303133;
  border-bottom: 1px solid #ebeef5;
}

.file-menu {
  flex: 1;
  overflow-y: auto;
  border-right: none;
}

.file-menu-item {
  display: flex;
  align-items: center;
}

.file-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 12px;
}

.error-badge {
  margin-left: auto;
}

:deep(.el-badge__content) {
  border: none;
}

.error-content {
  flex: 1;
  padding: 20px;
  overflow-y: auto;
}

.error-content.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
}

.error-card {
  margin-bottom: 16px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.error-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-weight: 500;
  font-size: 15px;
}

.error-type {
  font-weight: normal;
}

.error-body {
  font-size: 14px;
  color: #606266;
  line-height: 1.6;
}

.error-row {
  display: flex;
  margin-bottom: 8px;
}

.error-row:last-child {
  margin-bottom: 0;
}

.error-row .label {
  width: 80px;
  flex-shrink: 0;
  color: #909399;
}

.error-row .value {
  flex: 1;
}

.original-text {
  color: #f56c6c;
  background-color: #fef0f0;
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
