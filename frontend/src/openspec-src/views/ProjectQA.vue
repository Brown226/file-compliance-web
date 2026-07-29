<template>
  <div class="qa-page">
    <div class="qa-container">
      <ProjectList
        :projects="projects"
        :activeId="selectedProjectId"
        @select="handleSelectProject"
        @create="createProject"
        @delete="handleDeleteProject"
        @select-session="handleSelectSession"
        @create-session="handleCreateSession"
      />
      <main class="qa-main">
        <!-- 顶部标题栏 -->
        <div class="qa-header">
          <h3 class="qa-session-title">{{ currentSessionName }}</h3>
          <div class="qa-header-actions">
            <el-button size="small" @click="refreshSession">
              <el-icon><Refresh /></el-icon> 刷新会话
            </el-button>
          </div>
        </div>

        <!-- 对话式问答线程 -->
        <div class="qa-thread" ref="threadRef">
          <template v-for="msg in chatMessages" :key="msg.id">
            <!-- 用户提问气泡 -->
            <div v-if="msg.role === 'user'" class="chat-bubble-row user">
              <div class="chat-bubble user-bubble">
                {{ msg.content }}
              </div>
            </div>

            <!-- AI 回答 -->
            <div v-else class="chat-bubble-row assistant">
              <div class="ai-response">
                <!-- 流式 Markdown 正文 -->
                <MarkdownRenderer v-if="msg.content" :content="msg.content" :streaming="!!msg.loading" />

                <!-- loading 指示器 -->
                <div v-if="msg.loading" class="qa-loading">
                  <el-icon class="is-loading"><Loading /></el-icon>
                  <span>{{ msg.content ? '生成中...' : '正在分析中...' }}</span>
                </div>

                <!-- 错误提示 -->
                <div v-if="msg.error" class="qa-error">
                  <span>{{ msg.error }}</span>
                </div>

                <!-- 引用卡片（流结束后显示） -->
                <div v-if="!msg.loading && msg.chunkReferences?.length" class="ref-section">
                  <div class="ref-section-header">
                    <el-icon><Document /></el-icon>
                    <span>引用来源</span>
                  </div>
                  <div class="ref-list">
                    <div
                      v-for="(ref, idx) in msg.chunkReferences"
                      :key="idx"
                      class="ref-card"
                    >
                      <div class="ref-header">
                        <h5 class="ref-title">{{ ref.doc_name }}</h5>
                      </div>
                      <p v-if="ref.content || ref.chunk_content" class="ref-snippet">
                        "{{ ref.content || ref.chunk_content }}"
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- 底部输入栏 -->
        <div class="qa-input-bar">
          <el-input
            v-model="newQuestion"
            placeholder="请输入您的问题"
            clearable
            :disabled="isGenerating"
            @keyup.enter="addQuestion"
          >
            <template #prefix>
              <el-icon><ChatDotRound /></el-icon>
            </template>
            <template #append>
              <el-button v-if="!isGenerating" type="primary" @click="addQuestion">发送</el-button>
              <el-button v-else type="danger" @click="stopGeneration">停止</el-button>
            </template>
          </el-input>
        </div>
      </main>

      <!-- 右侧：引用来源面板（展示本轮问答检索到的真实 chunks） -->
      <aside class="qa-sidebar">
        <div class="sidebar-title">
          <el-icon><Search /></el-icon>
          <span>引用来源</span>
          <el-tag v-if="knowledgeItems.length" size="small" type="info" round class="sidebar-count">
            {{ knowledgeItems.length }}
          </el-tag>
        </div>

        <!-- 搜索输入框（仅在有条目时显示） -->
        <div v-if="knowledgeItems.length" class="knowledge-search">
          <el-input
            v-model="knowledgeSearch"
            placeholder="按文档名过滤"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>

        <!-- 引用条目列表 -->
        <div class="knowledge-list">
          <div
            v-for="(item, idx) in filteredKnowledgeItems"
            :key="(item.doc_id || '') + idx"
            class="knowledge-item"
            :class="{ active: activeKnowledgeId === (item.doc_id || '') + idx }"
            @click="activeKnowledgeId = (item.doc_id || '') + idx"
          >
            <div class="knowledge-header">
              <h4>{{ item.doc_name || '未命名文档' }}</h4>
            </div>
            <p v-if="item.content || item.chunk_content" class="knowledge-snippet">
              "{{ item.content || item.chunk_content }}"
            </p>
          </div>

          <!-- 空状态：无引用时显示提示 -->
          <div v-if="knowledgeItems.length === 0" class="knowledge-empty">
            <el-icon class="empty-icon"><Document /></el-icon>
            <p class="empty-text">发起问答后，此处展示检索到的引用来源</p>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ChatDotRound, Refresh, Search, Document, Loading } from '@element-plus/icons-vue'
import ProjectList from '@openspec/components/ProjectList.vue'
import MarkdownRenderer from '@openspec/components/MarkdownRenderer.vue'
import type { ProjectItem } from '@openspec/data/mockData'
import type { ChunkReference } from '@openspec/service/qa'
import { useQAChat } from '@openspec/composables/useQAChat'

// ===== 问答交互（对接 Agent /agent/workflow/chat/stream） =====

const { chatMessages, isGenerating, askQuestion, stopGeneration, clearMessages } = useQAChat()

const newQuestion = ref('')

const addQuestion = () => {
  const q = newQuestion.value.trim()
  if (!q) return
  // 传 projectId 作为会话隔离，agent 用 documentId 作 LangGraph thread_id
  askQuestion(q, selectedProjectId.value, currentSessionId.value || selectedProjectId.value)
  newQuestion.value = ''
}

// ===== 会话操作 =====

const currentSessionName = ref('选择会话开始对话')
const currentSessionId = ref<string>('')

const refreshSession = () => {
  clearMessages()
  ElMessage.success('会话已刷新')
}

// ===== 自动滚动到底部 =====

const threadRef = ref<HTMLElement | null>(null)

watch(
  () => chatMessages.value[chatMessages.value.length - 1]?.content,
  async () => {
    await nextTick()
    if (threadRef.value) {
      threadRef.value.scrollTop = threadRef.value.scrollHeight
    }
  }
)

// ===== 右侧引用来源面板（取最近一条 AI 回答检索到的 chunks） =====

const knowledgeSearch = ref('')
const activeKnowledgeId = ref<string>('')

// 从 chatMessages 末尾向前找最近一条 AI 消息的 chunkReferences
const knowledgeItems = computed<ChunkReference[]>(() => {
  for (let i = chatMessages.value.length - 1; i >= 0; i--) {
    const msg = chatMessages.value[i]
    if (msg.role === 'assistant' && msg.chunkReferences?.length) {
      return msg.chunkReferences
    }
  }
  return []
})

const filteredKnowledgeItems = computed(() => {
  const keyword = knowledgeSearch.value.trim().toLowerCase()
  if (!keyword) return knowledgeItems.value
  return knowledgeItems.value.filter(it =>
    (it.doc_name || '').toLowerCase().includes(keyword),
  )
})

// ===== 左侧项目列表（本地持久化，不走后端） =====
//
// 原版调 /agent/rag/ragflow/chat_assistant/* 系列接口，这些接口在
// Python Agent 中不存在（仅在参考项目远端 cm.aizzyun.com 可用）。
// 现改为 localStorage 持久化项目/会话列表，问答走 workflow/chat/stream。
//
const projects = ref<ProjectItem[]>([])
const selectedProjectId = ref<string>('')
const projectLoading = ref(false)

const STORAGE_KEY = 'openspec-qa-projects'
const ELECTRIC_QA_PREFIX = 'elec_qa_'

function loadProjectsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        projects.value = parsed
        // 自动选中第一个
        if (projects.value.length > 0 && !selectedProjectId.value) {
          handleSelectProject(projects.value[0].id)
        }
        return
      }
    }
  } catch {
    // 解析失败忽略
  }
  // 首次访问，创建一个默认项目
  if (projects.value.length === 0) {
    const defaultProject: ProjectItem = {
      id: `qa_${Date.now()}`,
      name: '默认问答项目',
      lastUpdated: new Date().toLocaleString('zh-CN'),
      isActive: true,
      sessionList: [],
    }
    projects.value = [defaultProject]
    saveProjectsToStorage()
    handleSelectProject(defaultProject.id)
  }
}

function saveProjectsToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects.value))
  } catch {
    // 存储失败忽略
  }
}

// 选中项目 → 切换会话上下文
async function handleSelectProject(projectId: string) {
  selectedProjectId.value = projectId
  projects.value.forEach(p => p.isActive = p.id === projectId)
  // 清空当前对话
  clearMessages()
  currentSessionId.value = ''
  currentSessionName.value = '选择会话开始对话'
  saveProjectsToStorage()
}

// 新建项目
async function createProject() {
  try {
    const { value: name } = await ElMessageBox.prompt('请输入项目名称', '新建项目', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    })
    if (!name) return
    const newProject: ProjectItem = {
      id: `qa_${Date.now()}`,
      name,
      lastUpdated: new Date().toLocaleString('zh-CN'),
      isActive: false,
      sessionList: [],
    }
    projects.value.push(newProject)
    saveProjectsToStorage()
    ElMessage.success('创建成功')
    handleSelectProject(newProject.id)
  } catch {
    // 用户取消
  }
}

// 删除项目
async function handleDeleteProject(projectId: string) {
  const project = projects.value.find(p => p.id === projectId)
  try {
    await ElMessageBox.confirm(
      `确定删除「${project?.name || '该项目'}」？删除后不可恢复。`,
      '删除项目',
      { confirmButtonText: '删除', cancelButtonText: '取消', type: 'warning' }
    )
    const idx = projects.value.findIndex(p => p.id === projectId)
    if (idx >= 0) projects.value.splice(idx, 1)
    saveProjectsToStorage()
    if (selectedProjectId.value === projectId) {
      selectedProjectId.value = ''
      currentSessionId.value = ''
      currentSessionName.value = '选择会话开始对话'
      clearMessages()
      // 自动选中第一个
      if (projects.value.length > 0) {
        handleSelectProject(projects.value[0].id)
      }
    }
    ElMessage.success('删除成功')
  } catch {
    // 用户取消
  }
}

// 新建 session（本地）
async function handleCreateSession(projectId: string) {
  const project = projects.value.find(p => p.id === projectId)
  if (!project) return
  try {
    const { value: name } = await ElMessageBox.prompt('请输入会话名称', '新建会话', {
      confirmButtonText: '创建',
      cancelButtonText: '取消',
      inputPattern: /\S+/,
      inputErrorMessage: '名称不能为空',
    })
    if (!name) return
    const newSession = {
      id: `sess_${Date.now()}`,
      name,
    }
    if (!project.sessionList) project.sessionList = []
    project.sessionList.push(newSession)
    saveProjectsToStorage()
    // 自动切换到新 session
    currentSessionId.value = newSession.id
    currentSessionName.value = newSession.name
    clearMessages()
    ElMessage.success('会话创建成功')
  } catch {
    // 用户取消
  }
}

// 选中 session
function handleSelectSession(_projectId: string, session: any) {
  currentSessionId.value = session.id
  currentSessionName.value = session.name || '未命名会话'
  clearMessages()
}

// 页面加载时加载项目列表
onMounted(() => {
  projectLoading.value = true
  loadProjectsFromStorage()
  projectLoading.value = false
})
</script>

<style scoped>
.qa-page {
  height: 100%;
  background: var(--gray-50);
  display: flex;
  flex-direction: column;
}

.qa-container {
  display: grid;
  grid-template-columns: 280px 1fr 300px;
  gap: 16px;
  padding: 16px;
  height: 100%;
  min-height: 0;
}

/* ===== 中栏主体 ===== */

.qa-main {
  background: white;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.qa-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--gray-200);
  flex-shrink: 0;
}

.qa-session-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--gray-900);
  margin: 0;
}

.qa-header-actions {
  display: flex;
  gap: 8px;
}

.qa-thread {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

/* 对话气泡行 */
.chat-bubble-row {
  display: flex;
  width: 100%;
}

.chat-bubble-row.user {
  justify-content: flex-end;
}

.chat-bubble-row.assistant {
  justify-content: flex-start;
}

/* 用户气泡 */
.chat-bubble.user-bubble {
  max-width: 70%;
  padding: 10px 14px;
  background: var(--el-color-primary);
  color: #fff;
  border-radius: 12px 12px 2px 12px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
}

/* AI 回答区块 */
.ai-response {
  width: 100%;
  background: var(--gray-50);
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-md);
  padding: 16px;
}

.qa-message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.qa-source {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--gray-600);
}

.qa-source-text {
  font-weight: 500;
}

.qa-time {
  font-size: 12px;
  color: var(--gray-500);
}

/* 结论区块 */
.qa-conclusion {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px;
  background: #f0fdf4;
  border-radius: var(--radius-md);
  margin-bottom: 12px;
}

.qa-conclusion-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  flex-shrink: 0;
  margin-top: 5px;
}

.qa-conclusion-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--gray-900);
  line-height: 1.6;
}

/* 推理过程 */
.qa-section {
  margin-top: 12px;
}

.qa-section-header {
  cursor: pointer;
  user-select: none;
}

.qa-section-header h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--gray-900);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 4px;
}

.expand-icon {
  transition: transform 0.2s;
  font-size: 12px;
  margin-left: 4px;
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.qa-reasoning-list {
  padding-left: 8px;
}

.qa-reasoning-step {
  font-size: 13px;
  color: var(--gray-700);
  line-height: 1.8;
  margin-bottom: 4px;
}

.step-order {
  font-weight: 600;
  color: var(--gray-900);
  margin-right: 4px;
}

.step-norm-ref {
  color: var(--el-color-primary);
  font-size: 12px;
}

/* 规范依据卡片 */
.ref-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ref-card {
  background: white;
  border: 1px solid var(--gray-200);
  border-left: 3px solid var(--el-color-primary);
  border-radius: var(--radius-md);
  padding: 12px;
  position: relative;
}

.ref-card.mandatory {
  border-left-color: var(--el-color-danger);
}

.ref-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.ref-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-color-primary);
  margin: 0;
}

.ref-snippet {
  font-size: 13px;
  color: var(--gray-700);
  line-height: 1.6;
  margin-bottom: 8px;
  font-style: italic;
}

.ref-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: var(--gray-600);
}

.ref-actions {
  display: flex;
  gap: 4px;
}

.ref-mandatory-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--el-color-danger);
  font-size: 12px;
  font-weight: 500;
  margin-top: 8px;
}

/* loading 和 error 状态 */
.qa-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 0 4px;
  color: var(--gray-500);
  font-size: 13px;
}

.qa-error {
  padding: 8px 12px;
  margin-top: 8px;
  background: var(--el-color-danger-light-9);
  border-radius: var(--radius-md);
  color: var(--el-color-danger);
  font-size: 13px;
}

/* 引用来源区块 */
.ref-section {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--gray-200);
}

.ref-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--gray-700);
  margin-bottom: 8px;
}

/* 底部输入栏 */
.qa-input-bar {
  padding: 12px 16px;
  border-top: 1px solid var(--gray-200);
  flex-shrink: 0;
}

.qa-input-bar :deep(.el-input-group__append) {
  padding: 0;
  width: 60px;
}

/* ===== 右侧知识库面板 ===== */

.qa-sidebar {
  background: white;
  border: 1px solid var(--gray-200);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.sidebar-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 14px 16px;
  font-size: 14px;
  font-weight: 600;
  color: var(--gray-900);
  border-bottom: 1px solid var(--gray-200);
  flex-shrink: 0;
}

.sidebar-count {
  margin-left: auto;
}

.knowledge-search {
  padding: 10px 12px;
  flex-shrink: 0;
}

.knowledge-list {
  flex: 1;
  overflow-y: auto;
  padding: 0 12px 12px;
}

.knowledge-item {
  padding: 10px 12px;
  border-left: 3px solid transparent;
  border-bottom: 1px solid var(--gray-100);
  cursor: pointer;
  transition: all 0.15s;
}

.knowledge-item:hover {
  background: var(--gray-50);
}

.knowledge-item.active {
  border-left-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.knowledge-header h4 {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-color-primary);
  margin-bottom: 6px;
  line-height: 1.4;
}

.knowledge-snippet {
  font-size: 12px;
  color: var(--gray-600);
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-style: italic;
}

.knowledge-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 16px;
  color: var(--gray-400);
  text-align: center;
  gap: 8px;
}

.knowledge-empty .empty-icon {
  font-size: 32px;
  color: var(--gray-300);
}

.knowledge-empty .empty-text {
  font-size: 12px;
  margin: 0;
  line-height: 1.5;
}
</style>
