<template>
  <aside class="document-outline" :class="{ 'collapsed': isCollapsed }">
    <div class="outline-header">
      <h3 v-show="!isCollapsed">目录</h3>
      <el-button 
        :icon="isCollapsed ? ArrowRight : ArrowLeft"
        size="small"
        text
        class="collapse-btn"
        @click="toggleOutline"
        :title="isCollapsed ? '展开大纲' : '收起大纲'"
      />
    </div>
    
    <!-- 折叠状态下显示简化的指示器 -->
    <div v-if="isCollapsed" class="collapsed-indicator">
      <div class="indicator-dots">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    </div>
    
    <div v-show="!isCollapsed" class="chapter-list">
      <div 
        v-for="chapter in chapters" 
        :key="chapter.id"
        class="chapter-wrapper"
      >
        <div 
          class="chapter-item"
          :class="{ active: chapter.active }"
          @click="handleChapterClick(chapter.id)"
        >
          <span class="chapter-number">{{ chapter.id }}</span>
           <span 
            class="chapter-title"
          >{{ chapter.title }}</span>
          <el-tooltip v-if="shouldShowStatus(chapter.id)" placement="top" :content="statusTooltip(chapter.id)" effect="dark">
            <span class="chapter-status" :class="statusClass(chapter.id)"></span>
          </el-tooltip>
          <!-- 折叠/展开按钮 -->
          <span 
            v-if="chapter.children && chapter.children.length > 0"
            class="collapse-toggle"
            @click.stop="toggleChapterCollapse(chapter.id)"
          >
            <el-icon :class="{ 'rotated': !chapter.collapsed }">
              <ArrowRight />
            </el-icon>
          </span>
        </div>
        <!-- 子章节移到章节项外部，在下方显示 -->
        <div v-if="chapter.children && chapter.children.length > 0 && !chapter.collapsed" class="sub-chapters">
          <div 
            v-for="subChapter in chapter.children"
            :key="subChapter.id"
            class="sub-chapter-item"
            :class="{ active: subChapter.active }"
            @click.stop="handleChapterClick(subChapter.id)"
          >
            <span class="sub-chapter-number">{{ subChapter.id }}</span>
            <span 
              class="sub-chapter-title"
            >{{ titleWithoutNumber(subChapter.title, subChapter.id) }}</span>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { ArrowRight, ArrowLeft } from '@element-plus/icons-vue'

// 定义章节数据类型
interface SubChapter {
  id: string
  title: string
  active?: boolean
}

interface Chapter {
  id: string
  title: string
  active?: boolean
  collapsed?: boolean
  children?: SubChapter[]
}

// Props
interface Props {
  chapters: Chapter[]
  chapterStatus?: Record<string, { status: 'pending' | 'generating' | 'done' | 'error'; progress: number; message?: string; updatedAt?: number }>
}

const props = withDefaults(defineProps<Props>(), {
  chapters: () => [],
  chapterStatus: () => ({})
})

// Emits
const emit = defineEmits<{
  chapterClick: [chapterId: string]
  chapterCollapse: [chapterId: string, collapsed: boolean]
  outlineToggle: [collapsed: boolean]
}>()

// 大纲折叠状态
const isCollapsed = ref(false)

// 本地章节数据，支持折叠状态
const chapters = ref<Chapter[]>([])

// 监听props变化，初始化本地数据
watch(() => props.chapters, (newChapters) => {
  chapters.value = newChapters.map(chapter => ({
    ...chapter,
    collapsed: chapter.collapsed ?? false // 默认展开状态
  }))
}, { immediate: true, deep: true })

// 切换大纲显示/隐藏
const toggleOutline = () => {
  isCollapsed.value = !isCollapsed.value
  emit('outlineToggle', isCollapsed.value)
}

// 切换章节折叠状态
const toggleChapterCollapse = (chapterId: string) => {
  const chapter = chapters.value.find(ch => ch.id === chapterId)
  if (chapter) {
    chapter.collapsed = !chapter.collapsed
    emit('chapterCollapse', chapterId, chapter.collapsed)
  }
}

// 处理章节点击
const handleChapterClick = (chapterId: string) => {
  // 确定要激活的章节ID
  let activeChapterId = chapterId
  if (chapterId.includes('.')) {
    // 如果点击的是子章节，激活其父章节
    activeChapterId = chapterId.split('.')[0]!
  }

  //  console.log('======= 点击章节', chapterId,activeChapterId, chapters.value)
  
  // 更新激活状态
  chapters.value.forEach(chapter => {
    chapter.active = chapter.id === activeChapterId
    if (chapter.children) {
      chapter.children.forEach(subChapter => {
        // 子章节的激活状态：如果点击的是子章节，则激活被点击的子章节；否则不激活任何子章节
        subChapter.active = chapterId.includes('.') && subChapter.id === chapterId
      })
    }
  })
  
  emit('chapterClick', activeChapterId)
}

const statusClass = (chapterId: string) => {
  const s = props.chapterStatus?.[chapterId]?.status || 'pending'
  if (s === 'generating') return 'status-generating'
  if (s === 'done') return 'status-done'
  if (s === 'error') return 'status-error'
  return 'status-pending'
}

const statusTooltip = (chapterId: string) => {
  const info = props.chapterStatus?.[chapterId]
  const s = info?.status || 'pending'
  if (s === 'pending') return '未开始'
  if (s === 'generating') {
    const p = typeof info?.progress === 'number' ? `（${info.progress}%）` : ''
    // return `生成中${p}`
    return `生成中`
  }
  if (s === 'done') return '已完成'
  if (s === 'error') return `生成失败${info?.message ? `：${info.message}` : ''}`
  return ''
}

const nowTick = ref(Date.now())
let tickTimer: any
onMounted(() => {
  tickTimer = setInterval(() => { nowTick.value = Date.now() }, 1000)
})
onUnmounted(() => {
  if (tickTimer) clearInterval(tickTimer)
})

const shouldShowStatus = (chapterId: string) => {
  const anyGenerating = Object.values(props.chapterStatus || {}).some((it: any) => it?.status === 'generating')
  if (anyGenerating) return true
  return false
}

// 去除标题前置编号（如与 id 重复）
const titleWithoutNumber = (title: string, id: string) => {
  return title.replace(id, '')
}

</script>

<style scoped>
.document-outline {
  background: white;
  border-right: 1px solid var(--gray-200);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;            /* 允许容器在固定高度内收缩 */
  overflow: hidden;         /* 防止子元素溢出影响整体高度 */
  transition: width 0.3s ease;
  width: 280px;
}

.document-outline.collapsed {
  width: 48px;
  overflow: hidden;
}

.outline-header {
  padding:12px;
  padding-left: 24px;
  border-bottom: 1px solid var(--gray-200);
  background: var(--gray-50);
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 56px;
}

.outline-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--gray-800);
}

.collapse-btn {
  padding: 8px !important;
  min-width: 32px !important;
  height: 32px !important;
  border-radius: 6px !important;
  color: var(--gray-600) !important;
  transition: all 0.2s ease !important;
  flex-shrink: 0;
}

.collapse-btn:hover {
  background: var(--gray-200) !important;
  color: var(--primary-color) !important;
}

.document-outline.collapsed .outline-header {
  padding: 12px 8px;
  justify-content: center;
  border-bottom: 1px solid var(--gray-200);
}

.document-outline.collapsed .collapse-btn {
  margin: 0;
}

.chapter-list {
  flex: 1;
  overflow-y: auto;         /* 目录内部独立滚动 */
  padding: var(--spacing-md);
  min-height: 0;            /* 允许在 flex 容器内收缩以启用滚动 */
}

/* 章节包装器 */
.chapter-wrapper {
  margin-bottom: var(--spacing-xs);
}

.chapter-item {
  padding: 10px 12px;
  font-size: 14px;
  color: var(--gray-700);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: var(--transition);
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  position: relative;
}

.chapter-item:hover {
  background: var(--gray-100);
  color: var(--primary-color);
}

.chapter-item.active {
  background: var(--primary-light);
  color: var(--primary-color);
  font-weight: 600;
}

.chapter-number {
  font-weight: 600;
  color: var(--primary-color);
  flex-shrink: 0;
}

.chapter-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  cursor: text;
}

/* 折叠/展开按钮样式 */
.collapse-toggle {
  margin-left: auto;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  color: var(--gray-500);
  cursor: pointer;
}

.collapse-toggle:hover {
  background: var(--gray-200);
  color: var(--primary-color);
}

.collapse-toggle .el-icon {
  font-size: 14px;
  transition: transform 0.2s ease;
}

.collapse-toggle .el-icon.rotated {
  transform: rotate(90deg);
}

.sub-chapters {
  margin-left: 0;
  margin-top: 0;
  overflow: hidden;
  transition: all 0.3s ease;
  background: var(--gray-50);
  border-radius: var(--radius-sm);
  border-left: 3px solid var(--primary-color);
}

.sub-chapter-item {
  padding: 8px 16px;
  font-size: 13px;
  color: var(--gray-600);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: var(--transition);
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin: 2px 0;
}

.sub-chapter-number {
  font-weight: 600;
  color: var(--primary-color);
  flex-shrink: 0;
  font-size: 12px;
}

.sub-chapter-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.sub-chapter-item:hover {
  background: var(--gray-200);
  color: var(--primary-color);
}

.sub-chapter-item.active {
  background: var(--primary-light);
  color: var(--primary-color);
  font-weight: 600;
}

/* 折叠状态指示器 */
.collapsed-indicator {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
  padding: 20px 0;
}

.indicator-dots {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}

.dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--gray-400);
  transition: background 0.2s ease;
}

.document-outline.collapsed:hover .dot {
  background: var(--primary-color);
}

/* 折叠状态下的整体样式优化 */
.document-outline.collapsed {
  border-right: 1px solid var(--gray-200);
  background: var(--gray-50);
}

.document-outline.collapsed .outline-header {
  background: var(--gray-100);
}
.chapter-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-left: 4px;
}
.status-pending { background: var(--gray-300); }
.status-generating { background: #f59e0b; }
.status-done { background: #10b981; }
.status-error { background: #ef4444; }
</style>

