<template>
  <div class="prompt-config-container">
    <el-card shadow="never">
      <template #header>
        <div class="panel-header">
          <span>提示词模板管理</span>
          <div class="header-actions">
            <el-button size="small" @click="handleResetAll" :loading="resetAllLoading">
              <el-icon><Refresh /></el-icon>
              全部重置
            </el-button>
            <el-button size="small" type="primary" @click="handleSeed" :loading="seedLoading">
              <el-icon><MagicStick /></el-icon>
              初始化模板
            </el-button>
          </div>
        </div>
      </template>

      <!-- 说明横幅 -->
      <div class="info-banner">
        <div class="banner-icon">💡</div>
        <div class="banner-content">
          <div class="banner-title">提示词模板管理</div>
          <div class="banner-desc">
            <span>占位符说明：</span>
            <el-tag size="small" type="info">${text}</el-tag> 待审查文本
            <el-tag size="small" type="info">${standardContext}</el-tag> 标准上下文
            <el-tag size="small" type="info">${chunk}</el-tag> 分片文本
            <el-tag size="small" type="info">{data}</el-tag> RAG检索结果
          </div>
        </div>
        <div class="banner-tip">
          修改提示词后立即生效
        </div>
      </div>

      <!-- 模块选择 Cards -->
      <div class="module-cards">
        <div
          v-for="mod in modules"
          :key="mod.key"
          class="module-card"
          :class="{ active: activeModule === mod.key }"
          @click="activeModule = mod.key"
        >
          <div class="module-icon">{{ getModuleIcon(mod.key) }}</div>
          <div class="module-info">
            <div class="module-name">{{ mod.label }}</div>
            <div class="module-count">{{ mod.count }} 个模板</div>
          </div>
          <div class="module-active-indicator" v-if="activeModule === mod.key"></div>
        </div>
      </div>

      <!-- 模板列表 -->
      <div class="template-list" v-loading="loading">
        <el-empty v-if="!loading && filteredTemplates.length === 0" description="该模块暂无提示词模板" />

        <div
          v-for="tpl in filteredTemplates"
          :key="tpl.key"
          class="template-item"
          :class="{ 'disabled-item': !tpl.enabled }"
        >
          <!-- 左侧：基本信息 -->
          <div class="template-main">
            <div class="template-header">
              <div class="template-badges">
                <el-tag :type="roleTagType(tpl.role)" size="default" effect="dark">
                  {{ roleLabel(tpl.role) }}
                </el-tag>
                <el-tag v-if="tpl.isBuiltin" type="info" size="default" effect="plain">
                  <el-icon><Lock /></el-icon> 系统内置
                </el-tag>
                <el-tag v-if="hasCustomContent(tpl)" type="warning" size="default" effect="plain">
                  <el-icon><Edit /></el-icon> 已自定义
                </el-tag>
                <el-tag v-if="!tpl.enabled" type="danger" size="default" effect="plain">已禁用</el-tag>
              </div>
              <h3 class="template-name">{{ tpl.name }}</h3>
            </div>

            <p class="template-desc" v-if="tpl.description">{{ tpl.description }}</p>

            <div class="template-meta">
              <span class="template-key">
                <el-icon><Key /></el-icon> {{ tpl.key }}
              </span>
              <span class="template-module">
                <el-icon><Folder /></el-icon> {{ moduleLabel(tpl.module) }}
              </span>
            </div>

            <!-- 占位符 -->
            <div class="template-placeholders" v-if="parsePlaceholders(tpl.placeholders).length > 0">
              <span class="placeholder-label">可用变量：</span>
              <el-tag
                v-for="p in parsePlaceholders(tpl.placeholders)"
                :key="p"
                size="small"
                effect="plain"
                class="placeholder-tag"
              >{{ p }}</el-tag>
            </div>
          </div>

          <!-- 右侧：操作 -->
          <div class="template-actions">
            <el-switch
              :model-value="tpl.enabled"
              size="large"
              @change="(val: boolean) => handleToggle(tpl.key, val)"
            />
            <el-button type="primary" @click="handleEdit(tpl)" size="large">
              <el-icon><Edit /></el-icon>
              编辑
            </el-button>
            <el-button @click="handleReset(tpl.key)" size="large" plain class="reset-btn">
              <el-icon><RefreshRight /></el-icon>
              重置
            </el-button>
          </div>

          <!-- 内容预览 -->
          <div class="template-preview">
            <div class="preview-label">
              <el-icon><View /></el-icon> 内容预览
            </div>
            <pre class="content-preview">{{ tpl.content?.slice(0, 300) }}{{ (tpl.content?.length || 0) > 300 ? '...' : '' }}</pre>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 编辑对话框 -->
    <el-dialog
      v-model="editDialogVisible"
      :title="`编辑提示词模板 — ${editingTemplate?.name || ''}`"
      width="1100px"
      :close-on-click-modal="false"
      top="5vh"
      :lock-scroll="false"
      class="prompt-edit-dialog"
    >
      <div v-if="editingTemplate" class="edit-container">
        <!-- 模板信息卡片 -->
        <div class="template-info-card">
          <div class="info-row">
            <el-tag :type="roleTagType(editingTemplate.role)" size="large" effect="dark">
              {{ roleLabel(editingTemplate.role) }}
            </el-tag>
            <span class="info-separator">|</span>
            <span class="info-module">{{ moduleLabel(editingTemplate.module) }}</span>
            <span class="info-separator">|</span>
            <code class="info-key">{{ editingTemplate.key }}</code>
          </div>
          <p class="info-desc" v-if="editingTemplate.description">{{ editingTemplate.description }}</p>
          <div class="info-builtin" v-if="editingTemplate.isBuiltin">
            <el-icon><Lock /></el-icon> 系统内置模板，修改后将创建自定义副本
          </div>
        </div>

        <!-- 占位符工具 -->
        <div class="placeholder-toolbar">
          <span class="toolbar-label">快速插入变量：</span>
          <div class="placeholder-buttons">
            <el-tag
              v-for="p in parsePlaceholders(editingTemplate.placeholders)"
              :key="p"
              class="placeholder-btn"
              @click="insertPlaceholder(p)"
              effect="plain"
              type="info"
            >
              {{ p }}
            </el-tag>
          </div>
        </div>

        <!-- 编辑 / 测试 / 历史 Tabs -->
        <el-tabs v-model="editTab" class="edit-tabs-large">
          <el-tab-pane label="📝 编辑模板" name="edit">
            <div class="edit-content">
              <!-- 分栏编辑/预览 -->
              <div class="edit-panel">
                <!-- Markdown 工具栏 -->
                <div class="markdown-toolbar">
                  <el-button-group size="default">
                    <el-button @click="wrapText('**', '**')" title="粗体"><strong>B</strong></el-button>
                    <el-button @click="wrapText('*', '*')" title="斜体"><em>I</em></el-button>
                    <el-button @click="wrapText('# ', '')" title="标题1">H1</el-button>
                    <el-button @click="wrapText('## ', '')" title="标题2">H2</el-button>
                  </el-button-group>
                  <el-button-group size="default">
                    <el-button @click="wrapText('\n- ', '')" title="列表">☰</el-button>
                    <el-button @click="wrapText('\n1. ', '')" title="编号列表">1.</el-button>
                    <el-button @click="wrapText('> ', '')" title="引用">❝</el-button>
                  </el-button-group>
                  <el-button-group size="default">
                    <el-button @click="wrapText('`', '`')" title="行内代码">`code`</el-button>
                    <el-button @click="wrapText('\n```\n', '\n```')" title="代码块">{ }</el-button>
                  </el-button-group>
                  <el-button @click="wrapText('\n---\n', '')" size="default">
                    <el-icon><Minus /></el-icon> 分隔线
                  </el-button>
                  <div class="toolbar-spacer"></div>
                  <el-button size="default" type="info" plain @click="editContent = editingTemplate.defaultValue || ''">
                    <el-icon><RefreshLeft /></el-icon>
                    恢复默认
                  </el-button>
                </div>

                <!-- 编辑器和预览 -->
                <div class="split-editor">
                  <div class="editor-pane">
                    <div class="pane-header">
                      <span><el-icon><Edit /></el-icon> 编辑</span>
                      <span class="char-count">{{ editContent.length }} 字符</span>
                    </div>
                    <div class="editor-wrapper">
                      <textarea
                        v-model="editContent"
                        class="raw-textarea"
                        placeholder="请输入提示词内容（支持 Markdown 格式）"
                        @input="updatePreview"
                      ></textarea>
                    </div>
                  </div>
                  <div class="preview-pane">
                    <div class="pane-header">
                      <span><el-icon><View /></el-icon> 预览</span>
                    </div>
                    <div class="preview-content" v-html="renderedPreview"></div>
                  </div>
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane label="🧪 测试运行" name="test">
            <div class="test-content">
              <el-alert
                title="使用当前提示词调用 LLM 进行实际测试"
                description="输入测试文本，系统将替换占位符后调用 LLM 并返回结果"
                type="info" :closable="false" show-icon
              />

              <el-form label-width="100px" class="test-form">
                <el-form-item label="测试文本">
                  <el-input
                    v-model="testInput"
                    type="textarea"
                    :rows="8"
                    placeholder="输入一段模拟的文档内容用于测试..."
                  />
                </el-form-item>

                <el-form-item label="标准上下文">
                  <el-input
                    v-model="testStandardContext"
                    type="textarea"
                    :rows="5"
                    placeholder="输入模拟的标准上下文内容（可选）..."
                  />
                </el-form-item>

                <el-form-item>
                  <el-button type="primary" :loading="testRunning" size="large" @click="runTest">
                    <el-icon><VideoPlay /></el-icon>
                    运行测试
                  </el-button>
                  <el-button size="large" @click="clearTest">
                    <el-icon><Delete /></el-icon>
                    清空
                  </el-button>
                </el-form-item>
              </el-form>

              <div v-if="testResult" class="test-result-card">
                <div class="result-header">
                  <span class="result-title">测试结果</span>
                  <div class="result-meta">
                    <el-tag v-if="testModel" type="info">模型: {{ testModel }}</el-tag>
                    <el-tag v-if="testDuration" type="success">耗时: {{ testDuration }}ms</el-tag>
                    <el-tag v-if="testTokens" type="warning">Token: {{ testTokens }}</el-tag>
                  </div>
                </div>
                <div class="test-output">
                  <pre>{{ testResult }}</pre>
                </div>
              </div>

              <el-empty v-if="!testRunning && !testResult" description="输入测试文本后点击运行" :image-size="80" />
            </div>
          </el-tab-pane>

          <el-tab-pane label="📜 版本对比" name="history">
            <div class="history-content">
              <el-alert
                v-if="hasCustomContent(editingTemplate!)"
                title="以下对比默认值与当前自定义值的差异"
                type="success" :closable="false" show-icon
              />
              <el-alert
                v-else
                title="该模板暂无自定义修改，无需对比"
                type="info" :closable="false" show-icon
              />

              <div class="diff-view" v-if="hasCustomContent(editingTemplate!)">
                <div class="diff-pane default">
                  <div class="diff-header">
                    <el-icon><Document /></el-icon> 默认模板
                  </div>
                  <pre>{{ editingTemplate.defaultValue || '(无默认值)' }}</pre>
                </div>
                <div class="diff-pane current">
                  <div class="diff-header">
                    <el-icon><Edit /></el-icon> 当前自定义
                  </div>
                  <pre>{{ editingTemplate.content }}</pre>
                </div>
              </div>
            </div>
          </el-tab-pane>
        </el-tabs>
      </div>

      <template #footer>
        <el-button size="large" @click="editDialogVisible = false">取消</el-button>
        <el-button type="primary" size="large" :loading="saveLoading" @click="handleSave">
          <el-icon><Check /></el-icon>
          保存修改
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Edit, View, Lock, Key, Folder, Refresh, RefreshRight, Delete, Minus,
  MagicStick, VideoPlay, RefreshLeft, Document
} from '@element-plus/icons-vue'
import {
  getPromptTemplatesApi,
  getPromptModulesApi,
  updatePromptTemplateApi,
  resetPromptTemplateApi,
  resetAllPromptTemplatesApi,
  togglePromptTemplateApi,
  seedPromptTemplatesApi,
} from '@/api/promptTemplate'
import MarkdownIt from 'markdown-it'

const md = new MarkdownIt({ html: true, breaks: true, linkify: true })

interface PromptTemplate {
  id: string
  key: string
  module: string
  role: string
  name: string
  description?: string
  content: string
  placeholders?: string
  defaultValue?: string
  isBuiltin: boolean
  enabled: boolean
}

interface ModuleInfo {
  key: string
  label: string
  count: number
}

const loading = ref(false)
const saveLoading = ref(false)
const resetAllLoading = ref(false)
const seedLoading = ref(false)
const templates = ref<PromptTemplate[]>([])
const modules = ref<ModuleInfo[]>([])
const activeModule = ref('')

const editDialogVisible = ref(false)
const editingTemplate = ref<PromptTemplate | null>(null)
const editContent = ref('')
const editTab = ref('edit')

// 预览
const renderedPreview = ref('')
const updatePreview = () => {
  renderedPreview.value = md.render(editContent.value)
}

// 工具栏
const wrapText = (before: string, after: string) => {
  const textarea = document.querySelector('.edit-textarea textarea') as HTMLTextAreaElement
  if (!textarea) return
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const selected = editContent.value.substring(start, end)
  const newText = editContent.value.substring(0, start) + before + selected + after + editContent.value.substring(end)
  editContent.value = newText
  setTimeout(() => {
    textarea.focus()
    textarea.setSelectionRange(start + before.length, start + before.length + selected.length)
  }, 0)
}

const insertPlaceholder = (p: string) => {
  const textarea = document.querySelector('.edit-textarea textarea') as HTMLTextAreaElement
  if (!textarea) return
  const pos = textarea.selectionStart
  editContent.value = editContent.value.substring(0, pos) + p + editContent.value.substring(pos)
  setTimeout(() => {
    textarea.focus()
    textarea.setSelectionRange(pos + p.length, pos + p.length)
  }, 0)
}

// 测试
const testRunning = ref(false)
const testInput = ref('')
const testStandardContext = ref('')
const testResult = ref('')
const testDuration = ref(0)
const testModel = ref('')
const testTokens = ref('')

const runTest = async () => {
  if (!editingTemplate.value || !testInput.value.trim()) return
  testRunning.value = true
  testResult.value = ''
  testModel.value = ''
  testTokens.value = ''
  const startTime = Date.now()
  try {
    let prompt = editContent.value
    prompt = prompt.replace(/\$\{text\}/g, testInput.value)
    prompt = prompt.replace(/\$\{standardContext\}/g, testStandardContext.value || '')
    prompt = prompt.replace(/\$\{chunk\}/g, testInput.value.slice(0, 200))
    prompt = prompt.replace(/\$\{refTexts\}/g, '')
    prompt = prompt.replace(/\{data\}/g, '')
    prompt = prompt.replace(/\{question\}/g, '')
    testDuration.value = Date.now() - startTime
    testResult.value = `⚠️ LLM 测试接口未配置，显示变量替换后的完整提示词：\n\n${prompt}`
    testModel.value = '本地预览'
    testTokens.value = '-'
    ElMessage.success('测试完成')
  } catch (e: any) {
    testDuration.value = Date.now() - startTime
    testResult.value = `❌ 测试失败: ${e?.message || '未知错误'}`
    ElMessage.error('测试失败')
  } finally {
    testRunning.value = false
  }
}

const clearTest = () => {
  testInput.value = ''
  testStandardContext.value = ''
  testResult.value = ''
  testDuration.value = 0
  testModel.value = ''
  testTokens.value = ''
}

watch(editContent, () => {
  updatePreview()
})

const filteredTemplates = computed(() => {
  if (!activeModule.value) return templates.value
  return templates.value.filter(t => t.module === activeModule.value)
})

const hasCustomContent = (tpl: PromptTemplate) => {
  return tpl.defaultValue && tpl.content !== tpl.defaultValue
}

const parsePlaceholders = (placeholders?: string): string[] => {
  if (!placeholders) return []
  try {
    return JSON.parse(placeholders)
  } catch {
    return []
  }
}

const getModuleIcon = (key: string): string => {
  const icons: Record<string, string> = {
    library_review: '📋',
    consistency: '🔄',
    typo_grammar: '✏️',
    doc_review: '📄',
    multimodal: '🖼️',
    ocr: '🔤',
  }
  return icons[key] || '📝'
}

const roleLabel = (role: string): string => {
  const map: Record<string, string> = {
    system: '系统提示词',
    user: '用户提示词',
    rag_prompt: 'RAG检索词',
    fallback: '降级提示词',
    optimization: '优化提示词',
    greeting: '欢迎语',
  }
  return map[role] || role
}

const roleTagType = (role: string): string => {
  const map: Record<string, string> = {
    system: 'danger',
    user: 'primary',
    rag_prompt: 'success',
    fallback: 'warning',
    optimization: 'info',
    greeting: '',
  }
  return map[role] || 'info'
}

const moduleLabel = (mod: string): string => {
  const map: Record<string, string> = {
    library_review: '合规审查',
    consistency: '一致性审查',
    typo_grammar: '错别字/语法',
    doc_review: '以文审文',
    multimodal: '多模态审查',
    ocr: 'OCR文字识别',
  }
  return map[mod] || mod
}

const loadData = async () => {
  loading.value = true
  try {
    const [tplRes, modRes] = await Promise.all([
      getPromptTemplatesApi(),
      getPromptModulesApi(),
    ])
    templates.value = tplRes.data || []
    modules.value = modRes.data || []

    if (modules.value.length > 0 && !activeModule.value) {
      activeModule.value = modules.value[0].key
    }
  } catch (e) {
    console.error('加载提示词模板失败', e)
  } finally {
    loading.value = false
  }
}

const handleEdit = (tpl: PromptTemplate) => {
  editingTemplate.value = { ...tpl }
  editContent.value = tpl.content
  editDialogVisible.value = true
  editTab.value = 'edit'
  updatePreview()
}

const handleSave = async () => {
  if (!editingTemplate.value) return
  saveLoading.value = true
  try {
    await updatePromptTemplateApi(editingTemplate.value.key, editContent.value)
    ElMessage.success('提示词已保存，立即生效')
    editDialogVisible.value = false
    await loadData()
  } catch (e) {
    console.error('保存失败', e)
  } finally {
    saveLoading.value = false
  }
}

const handleReset = async (key: string) => {
  try {
    await ElMessageBox.confirm('确定要重置该模板为默认值吗？自定义内容将丢失。', '确认重置', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    })
    await resetPromptTemplateApi(key)
    ElMessage.success('已重置为默认值')
    await loadData()
  } catch (e) {
    // cancelled or error
  }
}

const handleResetAll = async () => {
  try {
    await ElMessageBox.confirm('确定要重置所有模板为默认值吗？所有自定义内容将丢失！', '确认全部重置', {
      confirmButtonText: '确定重置',
      cancelButtonText: '取消',
      type: 'warning',
    })
    resetAllLoading.value = true
    await resetAllPromptTemplatesApi()
    ElMessage.success('所有模板已重置为默认值')
    await loadData()
  } catch (e) {
    // cancelled or error
  } finally {
    resetAllLoading.value = false
  }
}

const handleToggle = async (key: string, enabled: boolean) => {
  try {
    await togglePromptTemplateApi(key, enabled)
    ElMessage.success(enabled ? '已启用' : '已禁用')
    await loadData()
  } catch (e) {
    console.error('切换状态失败', e)
  }
}

const handleSeed = async () => {
  seedLoading.value = true
  try {
    await seedPromptTemplatesApi()
    ElMessage.success('内置模板初始化完成')
    await loadData()
  } catch (e) {
    console.error('初始化失败', e)
  } finally {
    seedLoading.value = false
  }
}

onMounted(() => {
  loadData()
})
</script>

<style scoped>
.prompt-config-container {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  font-size: 16px;
  color: var(--corp-text-primary);
}

.header-actions {
  display: flex;
  gap: 12px;
}

/* 信息横幅 */
.info-banner {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 12px;
  color: #fff;
  margin-bottom: 20px;
}

.banner-icon {
  font-size: 32px;
}

.banner-content {
  flex: 1;
}

.banner-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 6px;
}

.banner-desc {
  font-size: 13px;
  opacity: 0.9;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.banner-tip {
  font-size: 12px;
  background: rgba(255,255,255,0.2);
  padding: 6px 12px;
  border-radius: 20px;
}

/* 模块选择卡片 */
.module-cards {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.module-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 20px;
  background: var(--bg-surface);
  border: 2px solid var(--corp-border-light);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  min-width: 160px;
}

.module-card:hover {
  border-color: var(--corp-primary);
  background: var(--corp-primary-lighter);
}

.module-card.active {
  border-color: var(--corp-primary);
  background: var(--corp-primary-lighter);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
}

.module-icon {
  font-size: 28px;
}

.module-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.module-count {
  font-size: 12px;
  color: var(--corp-text-secondary);
}

.module-active-indicator {
  position: absolute;
  bottom: -2px;
  left: 50%;
  transform: translateX(-50%);
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 6px solid var(--corp-primary);
}

/* 模板列表 */
.template-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.template-item {
  background: var(--bg-surface);
  border: 1px solid var(--corp-border-light);
  border-radius: 12px;
  padding: 20px;
  transition: all 0.2s;
}

.template-item:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}

.disabled-item {
  opacity: 0.6;
  background: var(--color-gray-50);
}

.template-header {
  margin-bottom: 12px;
}

.template-badges {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.template-name {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.template-desc {
  font-size: 14px;
  color: var(--corp-text-secondary);
  margin: 0 0 12px 0;
  line-height: 1.6;
}

.template-meta {
  display: flex;
  gap: 20px;
  font-size: 13px;
  color: var(--corp-text-secondary);
  margin-bottom: 12px;
}

.template-key,
.template-module {
  display: flex;
  align-items: center;
  gap: 4px;
}

.template-key code {
  font-family: 'Courier New', monospace;
  background: var(--el-fill-color-light);
  padding: 2px 8px;
  border-radius: 4px;
}

.template-placeholders {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}

.placeholder-label {
  color: var(--corp-text-secondary);
  font-weight: 500;
}

.placeholder-tag {
  cursor: pointer;
  font-family: 'Courier New', monospace;
}

.template-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px dashed var(--corp-border-light);
}

.reset-btn {
  border-color: #e4e7ed;
  color: #909399;
}

.reset-btn:hover {
  border-color: var(--corp-primary);
  color: var(--corp-primary);
}

.template-preview {
  margin-top: 16px;
}

.preview-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--corp-text-secondary);
  margin-bottom: 8px;
  font-weight: 500;
}

.content-preview {
  background: var(--el-fill-color-light);
  border: 1px solid var(--corp-border-light);
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 13px;
  color: var(--corp-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 100px;
  overflow: hidden;
  font-family: 'Courier New', Consolas, monospace;
  margin: 0;
}

/* 编辑对话框 */
.prompt-edit-dialog :deep(.el-dialog__body) {
  padding: 0;
}

.edit-container {
  padding: 20px;
  max-height: calc(90vh - 140px);
  overflow-y: auto;
}

.template-info-card {
  background: var(--el-fill-color-light);
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 16px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.info-separator {
  color: var(--el-text-color-disabled);
}

.info-module {
  font-size: 14px;
  color: var(--corp-text-primary);
  font-weight: 500;
}

.info-key {
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  background: #fff;
  padding: 3px 10px;
  border-radius: 4px;
}

.info-desc {
  font-size: 14px;
  color: var(--corp-text-secondary);
  margin: 8px 0 0 0;
  line-height: 1.5;
}

.info-builtin {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--el-color-warning);
  margin-top: 8px;
}

.placeholder-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.toolbar-label {
  font-size: 13px;
  color: var(--corp-text-secondary);
  font-weight: 500;
}

.placeholder-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.placeholder-btn {
  cursor: pointer;
  font-family: 'Courier New', monospace;
  font-size: 12px;
}

.edit-tabs-large :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.edit-content {
  padding: 0;
}

.edit-panel {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  overflow: hidden;
}

.markdown-toolbar {
  display: flex;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--el-border-color-light);
  flex-wrap: wrap;
  background: #fafafa;
}

.toolbar-spacer {
  flex: 1;
}

.split-editor {
  display: flex;
  overflow: hidden;
  height: 450px;
  background: #fff;
}

.editor-pane,
.preview-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  height: 100%;
}

.editor-pane {
  border-right: 1px solid var(--el-border-color-light);
}

.editor-wrapper {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.raw-textarea {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 12px 14px;
  font-family: 'Courier New', Consolas, monospace;
  font-size: 14px;
  line-height: 1.7;
  background: #fff;
  color: var(--el-text-color-regular);
}

.pane-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: #f5f5f5;
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  border-bottom: 1px solid var(--el-border-color-light);
}

.pane-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: var(--el-fill-color-light);
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.char-count {
  font-weight: normal;
  font-size: 12px;
  color: var(--el-text-color-disabled);
}

.preview-content {
  padding: 16px;
  font-size: 14px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  background: #fafbfc;
}

.preview-content :deep(h1),
.preview-content :deep(h2),
.preview-content :deep(h3) {
  margin-top: 16px;
  margin-bottom: 8px;
  color: var(--el-text-color-primary);
}

.preview-content :deep(code) {
  background: var(--el-fill-color-light);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 13px;
}

.preview-content :deep(pre) {
  background: #282c34;
  color: #abb2bf;
  padding: 14px;
  border-radius: 6px;
  overflow-x: auto;
}

.preview-content :deep(blockquote) {
  border-left: 4px solid var(--corp-primary);
  padding-left: 14px;
  color: var(--el-text-color-secondary);
  margin: 10px 0;
}

/* 测试面板 */
.test-content {
  padding: 20px 0;
}

.test-form {
  margin-top: 16px;
}

.test-result-card {
  margin-top: 20px;
  border: 1px solid var(--el-border-color-light);
  border-radius: 10px;
  overflow: hidden;
}

.result-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: var(--el-fill-color-light);
  border-bottom: 1px solid var(--el-border-color-light);
}

.result-title {
  font-weight: 600;
  font-size: 14px;
  color: var(--corp-text-primary);
}

.result-meta {
  display: flex;
  gap: 8px;
}

.test-output {
  background: #1e1e1e;
  color: #d4d4d4;
  padding: 16px;
  max-height: 300px;
  overflow-y: auto;
}

.test-output pre {
  margin: 0;
  font-family: 'Courier New', Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 历史版本 */
.history-content {
  padding: 20px 0;
}

.diff-view {
  display: flex;
  gap: 16px;
  margin-top: 16px;
}

.diff-pane {
  flex: 1;
  min-width: 0;
}

.diff-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
  padding: 10px 0;
  border-bottom: 2px solid var(--corp-primary);
  margin-bottom: 12px;
}

.diff-pane.default .diff-header {
  border-bottom-color: var(--el-color-info);
}

.diff-pane pre {
  background: var(--el-fill-color-light);
  padding: 14px;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 350px;
  overflow-y: auto;
  font-family: 'Courier New', Consolas, monospace;
  margin: 0;
}
</style>
