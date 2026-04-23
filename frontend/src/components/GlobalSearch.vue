<template>
  <Teleport to="body">
    <Transition name="search-overlay">
      <div v-if="visible" class="global-search-overlay" @click.self="close">
        <div class="global-search-panel">
          <div class="search-input-wrap">
            <el-icon class="search-icon"><Search /></el-icon>
            <input
              ref="searchInputRef"
              v-model="query"
              type="text"
              class="search-input"
              placeholder="搜索任务、文件、标准、规则..."
              @input="handleSearch"
              @keydown="handleKeydown"
            />
            <kbd class="search-kbd">ESC</kbd>
          </div>

          <div class="search-results" v-if="results.length > 0">
            <div
              v-for="(item, index) in results"
              :key="item.id"
              class="search-item"
              :class="{ active: activeIndex === index }"
              @click="handleSelect(item)"
              @mouseenter="activeIndex = index"
            >
              <div class="item-icon" :style="{ color: categoryColor(item.category) }">
                <el-icon :size="18"><component :is="categoryIcon(item.category)" /></el-icon>
              </div>
              <div class="item-content">
                <div class="item-title">
                  <span v-html="highlightText(item.title)"></span>
                </div>
                <div class="item-desc">{{ item.description }}</div>
              </div>
              <div class="item-badge">
                <el-tag size="small" effect="plain">{{ categoryLabel(item.category) }}</el-tag>
              </div>
            </div>
          </div>

          <div v-else-if="query" class="search-empty">
            <el-icon :size="40" color="#d1d5db"><Search /></el-icon>
            <p>未找到匹配的结果</p>
          </div>

          <div v-else class="search-empty">
            <p>输入关键词开始搜索</p>
            <div class="search-hints">
              <span class="hint-label">快捷键</span>
              <kbd class="kbd">Ctrl+K</kbd> 打开搜索
            </div>
          </div>

          <div class="search-footer">
            <span class="footer-item">
              <kbd class="kbd">↑↓</kbd> 导航
            </span>
            <span class="footer-item">
              <kbd class="kbd">↵</kbd> 打开
            </span>
            <span class="footer-item">
              <kbd class="kbd">ESC</kbd> 关闭
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { Search, Document, List, Reading, Setting, DataBoard } from '@element-plus/icons-vue'

interface SearchResult {
  id: string
  category: string
  title: string
  description: string
  route: string
}

const visible = ref(false)
const query = ref('')
const results = ref<SearchResult[]>([])
const activeIndex = ref(0)
const searchInputRef = ref<HTMLInputElement | null>(null)
const router = useRouter()

const allItems = ref<SearchResult[]>([])

function loadAllItems() {
  allItems.value = [
    { id: '1', category: 'dashboard', title: '监控仪表盘', description: '系统概览与统计', route: '/dashboard' },
    { id: '2', category: 'task', title: '新建任务', description: '创建新的审查任务', route: '/tasks/new' },
    { id: '3', category: 'task', title: '任务历史', description: '查看任务历史记录', route: '/tasks/history' },
    { id: '4', category: 'standard', title: '企业标准规范库', description: '管理与查询标准文档', route: '/standards' },
    { id: '5', category: 'rule', title: '审查规则管理', description: '配置自动审查规则', route: '/review-rules' },
    { id: '6', category: 'config', title: '流水线配置', description: '审查流程管线设置', route: '/pipeline-config' },
    { id: '7', category: 'config', title: '提示词模板管理', description: 'LLM 提示词配置', route: '/llm-config' },
    { id: '8', category: 'config', title: 'LLM 配置', description: '大语言模型供应商设置', route: '/llm-config' },
    { id: '9', category: 'dashboard', title: '用户管理', description: '系统用户与权限管理', route: '/system' },
    { id: '10', category: 'rule', title: '正则表达式工具', description: 'AI 生成与测试正则表达式', route: '/regex-tool' },
    { id: '11', category: 'dashboard', title: '安全审计日志', description: '查看系统操作审计记录', route: '/audit-logs' },
  ]
}

function open() {
  loadAllItems()
  visible.value = true
  query.value = ''
  results.value = []
  activeIndex.value = 0
  nextTick(() => searchInputRef.value?.focus())
}

function close() {
  visible.value = false
}

function handleSearch() {
  if (!query.value.trim()) {
    results.value = []
    return
  }
  const q = query.value.toLowerCase()
  results.value = allItems.value.filter(item =>
    item.title.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    item.category.toLowerCase().includes(q)
  )
  activeIndex.value = 0
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close()
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    activeIndex.value = Math.min(activeIndex.value + 1, results.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    activeIndex.value = Math.max(activeIndex.value - 1, 0)
  } else if (e.key === 'Enter' && results.value.length > 0 && activeIndex.value >= 0) {
    e.preventDefault()
    handleSelect(results.value[activeIndex.value])
  }
}

function handleSelect(item: SearchResult) {
  close()
  router.push(item.route)
}

function highlightText(text: string) {
  if (!query.value.trim()) return text
  const q = query.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(`(${q})`, 'gi'), '<mark>$1</mark>')
}

const categoryLabel = (cat: string) => {
  const map: Record<string, string> = {
    task: '任务', standard: '标准', rule: '规则', config: '配置', dashboard: '系统',
  }
  return map[cat] || cat
}

const categoryColor = (cat: string) => {
  const map: Record<string, string> = {
    task: '#2563EB',
    standard: '#10B981',
    rule: '#F59E0B',
    config: '#6B7280',
    dashboard: '#2563EB',
  }
  return map[cat] || '#6B7280'
}

const categoryIcon = (cat: string) => {
  const map: Record<string, any> = {
    task: Document, standard: Reading, rule: List,
    config: Setting, dashboard: DataBoard,
  }
  return map[cat] || Document
}

defineExpose({ open, close, visible })
</script>

<style scoped>
.search-overlay-enter-active,
.search-overlay-leave-active {
  transition: opacity 0.15s ease;
}
.search-overlay-enter-from,
.search-overlay-leave-to {
  opacity: 0;
}

.global-search-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: var(--bg-overlay);
  display: flex;
  justify-content: center;
  padding-top: 15vh;
  backdrop-filter: blur(4px);
}

.global-search-panel {
  width: 560px;
  max-height: 480px;
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.search-input-wrap {
  display: flex;
  align-items: center;
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--corp-border-light);
  gap: var(--space-2);
}

.search-icon {
  color: var(--corp-text-tertiary);
  font-size: 18px;
}

.search-input {
  flex: 1;
  border: none;
  outline: none;
  font-size: 15px;
  color: var(--corp-text-primary);
  background: transparent;
}

.search-input::placeholder {
  color: var(--corp-text-tertiary);
}

.search-kbd {
  font-size: var(--text-xs);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--color-gray-100);
  color: var(--color-gray-500);
  border: 1px solid var(--corp-border-light);
  font-family: inherit;
}

.search-results {
  max-height: 320px;
  overflow-y: auto;
  padding: var(--space-1) 0;
}

.search-item {
  display: flex;
  align-items: center;
  padding: var(--space-2) var(--space-4);
  cursor: pointer;
  gap: var(--space-3);
  transition: background 0.1s;
}

.search-item:hover,
.search-item.active {
  background: var(--bg-surface-active);
}

.item-icon {
  flex-shrink: 0;
  display: flex;
}

.item-content {
  flex: 1;
  min-width: 0;
}

.item-title {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--corp-text-primary);
}

.item-title mark {
  background: #FEF08A;
  padding: 0 2px;
  border-radius: 2px;
}

.item-desc {
  font-size: var(--text-xs);
  color: var(--color-gray-500);
  margin-top: 2px;
}

.item-badge {
  flex-shrink: 0;
}

.search-empty {
  padding: var(--space-8) var(--space-4);
  text-align: center;
  color: var(--corp-text-tertiary);
}

.search-empty p {
  margin: var(--space-3) 0 0;
  font-size: var(--text-base);
}

.search-hints {
  margin-top: var(--space-4);
  font-size: var(--text-xs);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-1);
}

.hint-label {
  color: var(--color-gray-500);
}

.search-footer {
  display: flex;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-4);
  border-top: 1px solid var(--corp-border-light);
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
}

.footer-item {
  display: flex;
  align-items: center;
  gap: 4px;
}

.kbd {
  font-size: var(--text-xs);
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--color-gray-100);
  color: var(--color-gray-500);
  border: 1px solid var(--corp-border-light);
  font-family: inherit;
}
</style>
