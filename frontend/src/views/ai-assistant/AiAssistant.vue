<template>
  <div class="ai-assistant-page">
    <!-- 智能体选择页面 -->
    <div v-if="!selectedAgent" class="agent-selection">
      <div class="agent-selection__header">
        <div>
          <h3>AI 智能问答</h3>
          <p>选择一个智能体开始对话</p>
        </div>
        <el-button v-if="isAdmin" @click="showSettings = true">
          <el-icon><Setting /></el-icon> 管理智能体
        </el-button>
      </div>

      <div v-if="agents.length === 0" class="agent-empty">
        <div class="agent-empty__icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"></path>
            <path d="M9 22h6"></path>
            <path d="M12 17v5"></path>
          </svg>
        </div>
        <p class="agent-empty__title">暂无可用智能体</p>
        <p v-if="isAdmin" class="agent-empty__hint">请点击右上角"管理智能体"添加</p>
      </div>

      <div v-else class="agent-grid">
        <div
          v-for="agent in agents"
          :key="agent.id"
          class="agent-card"
          @click="selectAgent(agent)"
        >
          <div class="agent-card__icon" :style="{ background: agent.color || colorOptions[0] }">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"></path>
              <path d="M9 22h6"></path>
              <path d="M12 17v5"></path>
            </svg>
          </div>
          <div class="agent-card__info">
            <div class="agent-card__name">{{ agent.name }}</div>
            <div class="agent-card__desc">{{ agent.description || '点击开始对话' }}</div>
          </div>
          <svg class="agent-card__arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      </div>
    </div>

    <!-- iframe 嵌入 MaxKB -->
    <div v-else class="embed-layout">
      <div class="embed-header">
        <button class="header-btn" @click="exitChat" title="返回选择">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <div class="header-title">{{ selectedAgent.name }}</div>
        <div class="header-spacer"></div>
      </div>

      <div class="embed-container" v-loading="iframeLoading">
        <iframe
          ref="iframeRef"
          :src="embedUrl"
          class="maxkb-iframe"
          allow="microphone"
          @load="iframeLoading = false"
        ></iframe>
      </div>
    </div>

    <!-- 管理员设置弹窗 -->
    <el-dialog
      v-model="showSettings"
      title="管理智能体"
      width="650px"
      :close-on-click-modal="false"
    >
      <div class="settings-header">
        <span>已配置 {{ agents.length }} 个智能体</span>
        <el-button type="primary" size="small" @click="openAddDialog">
          <el-icon><Plus /></el-icon> 添加
        </el-button>
      </div>

      <el-table :data="agents" style="width: 100%" v-if="agents.length > 0">
        <el-table-column prop="name" label="名称" width="120" />
        <el-table-column prop="description" label="描述" show-overflow-tooltip />
        <el-table-column prop="applicationId" label="应用 ID" show-overflow-tooltip>
          <template #default="{ row }">
            <code class="id-code">{{ row.applicationId }}</code>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="center">
          <template #default="{ $index }">
            <el-button type="primary" link size="small" @click="openEditDialog($index)">编辑</el-button>
            <el-button type="danger" link size="small" @click="deleteAgent($index)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-else description="暂无智能体" />
    </el-dialog>

    <!-- 添加/编辑弹窗 -->
    <el-dialog
      v-model="showEditDialog"
      :title="editingIndex === -1 ? '添加智能体' : '编辑智能体'"
      width="500px"
      :close-on-click-modal="false"
    >
      <el-form :model="editForm" label-width="100px">
        <el-form-item label="名称" required>
          <el-input v-model="editForm.name" placeholder="例如：知识库问答" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="editForm.description" type="textarea" :rows="2" placeholder="可选描述" />
        </el-form-item>
        <el-form-item label="应用 ID" required>
          <el-input v-model="editForm.applicationId" placeholder="MaxKB 中的应用 UUID" />
          <div class="form-hint">在 MaxKB 应用设置中查看，36 位 UUID 格式</div>
        </el-form-item>
        <el-form-item label="图标颜色">
          <el-color-picker v-model="editForm.color" :predefine="colorOptions" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showEditDialog = false">取消</el-button>
        <el-button type="primary" @click="saveAgent">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Setting, Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { getEmbedUrlApi, clearEmbedSessionApi } from '@/api/maxkb'

interface Agent {
  id: string
  name: string
  description: string
  applicationId: string
  color: string
}

const userStore = useUserStore()
const isAdmin = computed(() => userStore.isAdmin?.() || false)

const agents = ref<Agent[]>([])
const selectedAgent = ref<Agent | null>(null)
const embedUrl = ref('')
const iframeLoading = ref(false)
const iframeRef = ref<HTMLIFrameElement>()

const showSettings = ref(false)
const showEditDialog = ref(false)
const editingIndex = ref(-1)
const editForm = ref<Partial<Agent>>({})

const STORAGE_KEY = 'maxkb-ai-assistant-agents'

const colorOptions = [
  'linear-gradient(135deg, #3b82f6, #6366f1)',
  'linear-gradient(135deg, #10b981, #059669)',
  'linear-gradient(135deg, #f59e0b, #d97706)',
  'linear-gradient(135deg, #ef4444, #dc2626)',
  'linear-gradient(135deg, #8b5cf6, #7c3aed)',
  'linear-gradient(135deg, #06b6d4, #0891b2)',
]

// ==================== 智能体管理 ====================

const loadAgents = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEY)
    if (data) {
      const parsed = JSON.parse(data)
      const valid: Agent[] = []
      for (const a of parsed) {
        const appId = a.applicationId || ''
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId)) {
          valid.push({
            id: a.id || Date.now().toString(),
            name: a.name || '未命名',
            description: a.description || '',
            applicationId: appId,
            color: a.color || colorOptions[0],
          })
        }
      }
      agents.value = valid
      if (valid.length !== parsed.length) saveAgents()
    } else {
      agents.value = []
    }
  } catch {
    agents.value = []
  }
}

const saveAgents = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(agents.value))
}

const openAddDialog = () => {
  editingIndex.value = -1
  editForm.value = { name: '', description: '', applicationId: '', color: colorOptions[0] }
  showEditDialog.value = true
}

const openEditDialog = (index: number) => {
  editingIndex.value = index
  editForm.value = { ...agents.value[index] }
  showEditDialog.value = true
}

const saveAgent = () => {
  if (!editForm.value.name?.trim()) {
    ElMessage.warning('请输入名称')
    return
  }
  if (!editForm.value.applicationId?.trim()) {
    ElMessage.warning('请输入应用 ID')
    return
  }

  if (editingIndex.value === -1) {
    agents.value.push({
      id: Date.now().toString(),
      name: editForm.value.name!.trim(),
      description: editForm.value.description?.trim() || '',
      applicationId: editForm.value.applicationId!.trim(),
      color: editForm.value.color || colorOptions[0],
    })
    ElMessage.success('添加成功')
  } else {
    agents.value[editingIndex.value] = {
      ...agents.value[editingIndex.value],
      name: editForm.value.name!.trim(),
      description: editForm.value.description?.trim() || '',
      applicationId: editForm.value.applicationId!.trim(),
      color: editForm.value.color || colorOptions[0],
    }
    ElMessage.success('保存成功')
  }

  saveAgents()
  showEditDialog.value = false
}

const deleteAgent = async (index: number) => {
  const agent = agents.value[index]
  try {
    await ElMessageBox.confirm(`确定要删除智能体"${agent.name}"吗？`, '确认删除', { type: 'warning' })
    // 清除 DB 中的 session
    try { await clearEmbedSessionApi(agent.applicationId) } catch {}
    agents.value.splice(index, 1)
    saveAgents()
    ElMessage.success('删除成功')
  } catch {}
}

// ==================== 对话逻辑 ====================

const selectAgent = async (agent: Agent) => {
  selectedAgent.value = agent
  iframeLoading.value = true
  embedUrl.value = ''

  try {
    const { data } = await getEmbedUrlApi(agent.applicationId)
    embedUrl.value = data.embedUrl
  } catch (e: any) {
    ElMessage.error('获取嵌入地址失败: ' + (e.message || '未知错误'))
    selectedAgent.value = null
  }
}

const exitChat = () => {
  selectedAgent.value = null
  embedUrl.value = ''
  iframeRef.value = null as any
}

onMounted(() => {
  loadAgents()
})
</script>

<style scoped>
.ai-assistant-page {
  height: calc(100vh - 60px);
  background: #f8fafc;
  overflow: hidden;
}

/* ==================== 智能体选择 ==================== */
.agent-selection {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 32px;
  overflow-y: auto;
}

.agent-selection__header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
  max-width: 900px;
  margin-left: auto;
  margin-right: auto;
  width: 100%;
}

.agent-selection__header h3 {
  margin: 0 0 4px;
  font-size: 24px;
  font-weight: 700;
  color: #0f172a;
}

.agent-selection__header p {
  margin: 0;
  font-size: 14px;
  color: #64748b;
}

.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
  max-width: 900px;
  margin: 0 auto;
  width: 100%;
}

.agent-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.25s ease;
}

.agent-card:hover {
  border-color: #3b82f6;
  box-shadow: 0 4px 16px rgba(59, 130, 246, 0.12);
  transform: translateY(-2px);
}

.agent-card__icon {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.agent-card__info { flex: 1; min-width: 0; }
.agent-card__name { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 4px; }
.agent-card__desc { font-size: 13px; color: #64748b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-card__arrow { color: #cbd5e1; flex-shrink: 0; transition: transform 0.2s; }
.agent-card:hover .agent-card__arrow { transform: translateX(4px); color: #3b82f6; }

.agent-empty {
  text-align: center;
  padding: 64px 24px;
  color: #94a3b8;
  max-width: 400px;
  margin: 0 auto;
}

.agent-empty__icon { margin-bottom: 16px; opacity: 0.4; }
.agent-empty__title { font-size: 16px; font-weight: 500; color: #64748b; margin: 0 0 8px; }
.agent-empty__hint { font-size: 13px; color: #3b82f6; margin: 0; }

/* ==================== iframe 嵌入 ==================== */
.embed-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.embed-header {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 16px;
  border-bottom: 1px solid #f1f5f9;
  background: #fff;
  flex-shrink: 0;
}

.header-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.header-btn:hover {
  background: #f1f5f9;
  color: #1e293b;
}

.header-title {
  flex: 1;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
}

.header-spacer {
  width: 36px;
}

.embed-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.maxkb-iframe {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

/* ==================== 设置弹窗 ==================== */
.settings-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.id-code {
  font-size: 12px;
  color: #64748b;
  background: #f1f5f9;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'SF Mono', 'Monaco', monospace;
}

.form-hint {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 4px;
}
</style>
