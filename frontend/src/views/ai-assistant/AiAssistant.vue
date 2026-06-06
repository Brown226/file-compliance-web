<template>
  <div class="ai-assistant-page">
    <!-- 智能体选择页面 -->
    <div v-if="!selectedAgent" class="agent-selection">
      <div class="selection-container">
        <!-- 顶部管理按钮 -->
        <div class="top-bar" v-if="isAdmin">
          <button class="settings-btn" @click="showSettings = true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"></circle>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
            <span>管理</span>
          </button>
        </div>

        <!-- 欢迎区域 -->
        <div class="welcome-section">
          <div class="welcome-logo">
            <div class="logo-glow"></div>
            <div class="logo-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"></path>
                <path d="M9 22h6"></path>
                <path d="M12 17v5"></path>
              </svg>
            </div>
          </div>
          <h1 class="welcome-title">AI 智能问答</h1>
          <p class="welcome-desc">选择一个智能体，开始你的对话</p>
        </div>

        <!-- 智能体列表 -->
        <div v-if="agents.length === 0" class="empty-state">
          <div class="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="12" y1="8" x2="12" y2="16"></line>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
          </div>
          <p class="empty-title">暂无可用智能体</p>
          <p v-if="isAdmin" class="empty-hint">点击右上角「管理」添加智能体</p>
        </div>

        <div v-else class="agent-grid">
          <div
            v-for="(agent, index) in agents"
            :key="agent.id"
            class="agent-card"
            :style="{ animationDelay: `${index * 0.08}s` }"
            @click="selectAgent(agent)"
          >
            <div class="card-glow" :style="{ background: agent.color || colorOptions[0] }"></div>
            <div class="card-content">
              <div class="card-icon" :style="{ background: agent.color || colorOptions[0] }">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                  <path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"></path>
                  <path d="M9 22h6"></path>
                  <path d="M12 17v5"></path>
                </svg>
              </div>
              <h3 class="card-name">{{ agent.name }}</h3>
              <p class="card-desc">{{ agent.description || '点击开始对话' }}</p>
              <div class="card-tags">
                <span v-if="agent.category" class="tag">{{ agent.category }}</span>
                <span v-if="agent.model" class="tag tag-model">{{ agent.model }}</span>
              </div>
              <div class="card-action">
                <span>开始对话</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                  <polyline points="12 5 19 12 12 19"></polyline>
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- iframe 嵌入 MaxKB -->
    <div v-else class="embed-layout">
      <div class="embed-header">
        <button class="back-btn" @click="exitChat" title="返回选择">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="19" y1="12" x2="5" y2="12"></line>
            <polyline points="12 19 5 12 12 5"></polyline>
          </svg>
        </button>
        <div class="header-center">
          <div class="header-dot" :style="{ background: selectedAgent.color || colorOptions[0] }"></div>
          <span class="header-title">{{ selectedAgent.name }}</span>
        </div>
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
        <el-form-item label="分类">
          <el-input v-model="editForm.category" placeholder="例如：制度检索、数据查询" />
        </el-form-item>
        <el-form-item label="模型">
          <el-input v-model="editForm.model" placeholder="例如：DeepSeek-V3" />
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
import { Plus } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import { getEmbedUrlApi, clearEmbedSessionApi } from '@/api/maxkb'

interface Agent {
  id: string
  name: string
  description: string
  applicationId: string
  color: string
  category?: string
  model?: string
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
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #a18cd1 0%, #fbc2eb 100%)',
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
            category: a.category || '',
            model: a.model || '',
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
  editForm.value = { name: '', description: '', applicationId: '', color: colorOptions[0], category: '', model: '' }
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
      category: editForm.value.category?.trim() || '',
      model: editForm.value.model?.trim() || '',
    })
    ElMessage.success('添加成功')
  } else {
    agents.value[editingIndex.value] = {
      ...agents.value[editingIndex.value],
      name: editForm.value.name!.trim(),
      description: editForm.value.description?.trim() || '',
      applicationId: editForm.value.applicationId!.trim(),
      color: editForm.value.color || colorOptions[0],
      category: editForm.value.category?.trim() || '',
      model: editForm.value.model?.trim() || '',
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
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  overflow: hidden;
}

/* ==================== 智能体选择 ==================== */
.agent-selection {
  height: 100%;
  overflow-y: auto;
}

.selection-container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 24px 32px 48px;
  position: relative;
}

.top-bar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 24px;
}

.settings-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(8px);
  color: #64748b;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.settings-btn:hover {
  border-color: #cbd5e1;
  color: #334155;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

/* 欢迎区域 */
.welcome-section {
  text-align: center;
  padding: 48px 0 40px;
}

.welcome-logo {
  position: relative;
  width: 56px;
  height: 56px;
  margin: 0 auto 20px;
}

.logo-icon {
  width: 56px;
  height: 56px;
  background: #1e40af;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 2px 8px rgba(30, 64, 175, 0.15);
}

.welcome-title {
  margin: 0 0 8px;
  font-size: 28px;
  font-weight: 700;
  color: #0f172a;
  letter-spacing: -0.5px;
}

.welcome-desc {
  margin: 0;
  font-size: 15px;
  color: #64748b;
}

/* 智能体网格 */
.agent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 20px;
}

.agent-card {
  position: relative;
  background: #fff;
  border-radius: 20px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  animation: cardIn 0.4s ease-out backwards;
  border: 1px solid rgba(0, 0, 0, 0.04);
}

@keyframes cardIn {
  from {
    opacity: 0;
    transform: translateY(16px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.agent-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.1);
  border-color: transparent;
}

.agent-card:active {
  transform: translateY(-2px);
}

.card-glow {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  opacity: 0;
  transition: opacity 0.3s;
}

.agent-card:hover .card-glow {
  opacity: 1;
}

.card-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 32px 24px 28px;
}

.card-icon {
  width: 64px;
  height: 64px;
  border-radius: 18px;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  transition: transform 0.3s;
}

.agent-card:hover .card-icon {
  transform: scale(1.08);
}

.card-name {
  margin: 0 0 8px;
  font-size: 17px;
  font-weight: 600;
  color: #0f172a;
}

.card-desc {
  margin: 0 0 20px;
  font-size: 13px;
  color: #94a3b8;
  line-height: 1.5;
  min-height: 40px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-tags {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-bottom: 16px;
}

.tag {
  font-size: 12px;
  color: #64748b;
  background: #f1f5f9;
  padding: 2px 10px;
  border-radius: 4px;
  line-height: 18px;
}

.tag-model {
  background: #eff6ff;
  color: #1e40af;
}

.card-action {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #1e40af;
  transition: all 0.2s;
}

.agent-card:hover .card-action {
  color: #1e3a8a;
}

/* 空状态 */
.empty-state {
  text-align: center;
  padding: 64px 24px;
}

.empty-icon {
  width: 80px;
  height: 80px;
  margin: 0 auto 20px;
  background: #f1f5f9;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #cbd5e1;
}

.empty-title {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 500;
  color: #64748b;
}

.empty-hint {
  margin: 0;
  font-size: 13px;
  color: #94a3b8;
}

/* ==================== iframe 嵌入 ==================== */
.embed-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fff;
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

.back-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.back-btn:hover {
  background: #f1f5f9;
  color: #0f172a;
}

.header-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.header-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.header-title {
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
