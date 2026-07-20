<template>
  <div class="template-detail-page">
    <!-- 顶部导航栏 -->
    <header class="header">
      <div class="header-content">
        <div class="header-left">
          <HeaderLogo />
          <nav class="nav-menu">
            <span class="nav-item active">{{ templateInfo?.name || '模板详情' }}</span>
          </nav>
        </div>
        <div class="user-info">
          <el-dropdown trigger="click" @command="handleUserCommand">
            <div class="user-avatar">
              {{ userInfo?.nickname?.charAt(0) || userInfo?.name?.charAt(0) || '用' }}
            </div>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>
                  <div class="user-dropdown-info">
                    <div class="user-dropdown-name">{{ userInfo?.nickname || userInfo?.name || '用户' }}</div>
                    <div class="user-dropdown-email">{{ userInfo?.email || '' }}</div>
                  </div>
                </el-dropdown-item>
                <el-dropdown-item divided command="logout">
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </header>

    <!-- 主体容器：左侧目录 + 右侧内容 -->
    <div class="detail-container">
      <!-- 左侧目录 -->
      <aside class="detail-sidebar">
        <div class="sidebar-title">文档目录</div>
        <el-scrollbar class="sidebar-scrollbar" ref="sidebarScrollbar">
          <div class="catalog-list">
            <div 
              v-for="item in catalog" 
              :key="item.id"
              :ref="el => setCatalogItemRef(item.id, el)"
              class="catalog-item"
              :class="{ 
                active: currentSection === item.id,
                [`level-${item.level}`]: true 
              }"
              @click="scrollToSection(item.id)"
            >
              <span class="catalog-label">{{ item.title }}</span>
            </div>
          </div>
          <el-empty v-if="!catalog.length" description="暂无目录" />
        </el-scrollbar>
      </aside>

      <!-- 右侧内容区 -->
      <main class="detail-main">
        <el-scrollbar class="main-scrollbar" ref="mainScrollbar">
          <div class="detail-content" v-if="templateInfo">
            <!-- 模板基本信息 -->
            <div class="info-section">
              <h1 class="template-title">{{ templateInfo.name }}</h1>
              <div class="template-meta">
                <el-tag 
                  v-for="tag in templateInfo.tags" 
                  :key="tag.id" 
                  size="small" 
                  class="meta-tag"
                >
                  {{ tag.name }}
                </el-tag>
                <span class="meta-item">
                  <el-icon><Clock /></el-icon>
                  {{ formatDate(templateInfo.createdAt) }}
                </span>
              </div>
              <div class="template-description" v-if="templateInfo.description">
                {{ templateInfo.description }}
              </div>
            </div>

            <!-- 文档内容章节 -->
            <div 
              v-for="section in sections" 
              :key="section.id"
              :id="section.id"
              class="content-section"
              :data-section-id="section.id"
            >
              <h2 :class="`section-title level-${section.level}`">
                {{ section.title }}
              </h2>
              <div class="section-content" v-html="section.content"></div>
            </div>

            <!-- 如果没有解析内容 -->
            <el-empty 
              v-if="sections.length === 0" 
              description="暂无解析内容"
              class="empty-content"
            />
          </div>

          <!-- 加载中 -->
          <div v-else-if="loading" class="loading-container">
            <el-icon class="is-loading"><Loading /></el-icon>
            <span>加载中...</span>
          </div>

          <!-- 加载失败 -->
          <el-empty 
            v-else 
            description="加载失败，请返回重试" 
            class="empty-content"
          />
        </el-scrollbar>
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Clock,
  Loading
} from '@element-plus/icons-vue'
import { authStorage, authFetch } from '../utils/auth'
import HeaderLogo from '../components/HeaderLogo.vue'
import { useLogout } from '../composables/useLogout'
import type { DocumentTemplate, TemplateTag } from '../service/template'

// 路由和用户信息
const route = useRoute()
const router = useRouter()
const { logout } = useLogout()
const userInfo = computed(() => authStorage.getUserInfo())

// 处理用户下拉菜单命令
const handleUserCommand = async (command: string) => {
  if (command === 'logout') {
    await logout()
  }
}

// 模板信息
const templateInfo = ref<DocumentTemplate | null>(null)
const loading = ref(true)

// 目录和章节数据
interface CatalogItem {
  id: string
  title: string
  level: number
}

interface Section {
  id: string
  title: string
  level: number
  content: string
}

const catalog = ref<CatalogItem[]>([])
const sections = ref<Section[]>([])
const currentSection = ref<string>('')

// 主内容滚动容器
const mainScrollbar = ref<any>(null)
const sidebarScrollbar = ref<any>(null)

// 目录项元素引用
const catalogItemRefs = ref<Map<string, HTMLElement>>(new Map())

// 设置目录项引用
const setCatalogItemRef = (id: string, el: any) => {
  if (el) {
    catalogItemRefs.value.set(id, el)
  }
}

// 加载模板详情
const loadTemplateDetail = async () => {
  const templateId = route.params.id
  if (!templateId) {
    ElMessage.error('模板ID不存在')
    router.push('/settings')
    return
  }

  try {
    loading.value = true

    // 获取模板基本信息（包含content和chapters）
    const infoResponse = await authFetch(`/api/v1/document-templates/${templateId}`)
    if (!infoResponse.ok) {
      throw new Error('获取模板信息失败')
    }

    const infoResult = await infoResponse.json()
    if (infoResult.code !== 200 || !infoResult.data) {
      throw new Error(infoResult.message || '获取模板信息失败')
    }

    templateInfo.value = infoResult.data

    // 如果数据库中有保存的内容，直接使用
    if (templateInfo.value.content) {
      try {
        // content是直接合并的文本，不是JSON
        const content = templateInfo.value.content
        const chaptersData = templateInfo.value.chapters ? JSON.parse(templateInfo.value.chapters) : []
        
        // 从内容中解析章节
        parseChunksContent(content, chaptersData)
      } catch (e) {
        console.error('解析保存的内容失败:', e)
        // 降级：从agent服务获取
        await loadFromAgent(templateInfo.value.filePath)
      }
    } else {
      // 如果数据库中没有内容，从agent服务获取（兼容旧数据）
      console.log('数据库中无内容，尝试从agent服务获取...')
      await loadFromAgent(templateInfo.value.filePath)
    }

  } catch (error) {
    console.error('加载模板详情失败:', error)
    ElMessage.error(error instanceof Error ? error.message : '加载失败')
  } finally {
    loading.value = false
  }
}

// ========== 内容解析辅助函数 ==========

// 在合并文本中定位章节标题所在行的起始位置
const findTitleInContent = (content: string, title: string, startFrom: number = 0): number => {
  const searchArea = content.substring(startFrom)
  // 去掉标题中可能带有的 markdown 前缀
  const cleanTitle = title.replace(/^#{1,6}\s+/, '').trim()

  // 策略1：直接搜索标题文字
  let pos = searchArea.indexOf(cleanTitle)
  if (pos >= 0) {
    pos += startFrom
    const lineStart = content.lastIndexOf('\n', pos - 1)
    return lineStart >= 0 ? lineStart + 1 : 0
  }

  // 策略2：去掉编号前缀后搜索描述文字
  const textPart = cleanTitle
    .replace(/^(?:二十|十[一二三四五六七八九]?|[一二三四五六七八九])[、.．]\s*/, '')
    .replace(/^\d+(?:\.\d+)*[\.、\s]+/, '')
    .trim()

  if (textPart.length >= 3) {
    pos = searchArea.indexOf(textPart)
    if (pos >= 0) {
      pos += startFrom
      const lineStart = content.lastIndexOf('\n', pos - 1)
      return lineStart >= 0 ? lineStart + 1 : 0
    }
  }

  return -1
}

// 去掉第一行（标题行），避免与 h2 标题重复
const stripFirstLine = (text: string): string => {
  const idx = text.indexOf('\n')
  return idx >= 0 ? text.substring(idx + 1).trim() : ''
}

// 从内容中自动检测章节标题
const detectHeadingsFromContent = (content: string): Array<{
  id: string; title: string; level: number; position: number
}> => {
  const headings: Array<{id: string; title: string; level: number; position: number}> = []
  const lines = content.split('\n')
  let pos = 0
  let idx = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed) {
      let matched = false

      // Markdown heading（排除 "## Chunk N" 人工标记）
      const mdMatch = trimmed.match(/^(#{1,3})\s+(.+)$/)
      if (mdMatch && !/^#{1,6}\s+Chunk \d+$/.test(trimmed)) {
        headings.push({
          id: `heading-${idx++}`,
          title: mdMatch[2].trim(),
          level: Math.min(mdMatch[1].length, 3),
          position: pos
        })
        matched = true
      }

      // 中文数字标题: 一、xxx
      if (!matched && /^(?:二十|十[一二三四五六七八九]?|[一二三四五六七八九])[、.．]\s*.+/.test(trimmed)) {
        headings.push({
          id: `heading-${idx++}`,
          title: trimmed,
          level: 1,
          position: pos
        })
      }
    }
    pos += line.length + 1
  }

  return headings
}

// 从 chunk 内容中提取更好的标题
const extractChunkTitle = (chunk: any, index: number): string => {
  const content = chunk.content || ''
  const lines = content.split('\n')

  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const trimmed = lines[i].trim()
    if (!trimmed) continue

    // Markdown heading
    const mdMatch = trimmed.match(/^#{1,6}\s+(.+)$/)
    if (mdMatch && !/Chunk \d+/.test(trimmed)) return mdMatch[1].trim()

    // 中文数字标题
    if (/^(?:二十|十[一二三四五六七八九]?|[一二三四五六七八九])[、.．]\s*.+/.test(trimmed)) {
      return trimmed
    }

    // 阿拉伯数字标题
    const numMatch = trimmed.match(/^(\d+(?:\.\d+)*)[\.、\s]\s*(.+)$/)
    if (numMatch && numMatch[2].length > 1) return trimmed
  }

  if (chunk.important_keywords && chunk.important_keywords.length > 0) {
    return chunk.important_keywords[0]
  }

  return `章节 ${index + 1}`
}

// ========== 加载与解析 ==========

// 从agent服务加载内容（降级方案）
const loadFromAgent = async (fileId: string) => {
  try {
    const chunksResponse = await authFetch('/agent/file/get_chunks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileId, datasetName: 'personal-template' })
    })

    if (!chunksResponse.ok) {
      throw new Error('获取文档内容失败')
    }

    const chunksResult = await chunksResponse.json()
    console.log('从agent获取的chunks:', chunksResult)

    if (chunksResult.code === 200 && chunksResult.data && Array.isArray(chunksResult.data)) {
      const chunks = chunksResult.data
      if (chunks.length === 0) return

      // 合并所有 chunk 内容
      const mergedContent = chunks.map((c: any) => c.content || '').join('\n')

      // 尝试从内容中检测章节标题
      const headings = detectHeadingsFromContent(mergedContent)
      const mainHeadings = headings.filter(h => h.level === 1)

      if (mainHeadings.length > 0) {
        // 检测到标题 → 按章节构建目录和内容
        const catalogList: CatalogItem[] = []
        const sectionList: Section[] = []

        headings.forEach(h => {
          catalogList.push({ id: h.id, title: h.title, level: h.level })
        })

        // 首个章节之前的内容
        if (mainHeadings[0].position > 0) {
          const pre = mergedContent.substring(0, mainHeadings[0].position).trim()
          if (pre) {
            catalogList.unshift({ id: 'section-preamble', title: '前言', level: 1 })
            sectionList.push({
              id: 'section-preamble',
              title: '前言',
              level: 1,
              content: pre.replace(/\n/g, '<br>')
            })
          }
        }

        for (let i = 0; i < mainHeadings.length; i++) {
          const h = mainHeadings[i]
          const endPos = i + 1 < mainHeadings.length ? mainHeadings[i + 1].position : mergedContent.length
          const raw = mergedContent.substring(h.position, endPos).trim()
          const body = stripFirstLine(raw)

          sectionList.push({
            id: h.id,
            title: h.title,
            level: h.level,
            content: body.replace(/\n/g, '<br>')
          })
        }

        catalog.value = catalogList
        sections.value = sectionList
      } else {
        // 未检测到标题 → 降级为按 chunk 显示
        const catalogList: CatalogItem[] = []
        const sectionList: Section[] = []

        chunks.forEach((chunk: any, index: number) => {
          const id = `chunk-${index}`
          const title = extractChunkTitle(chunk, index)

          catalogList.push({ id, title, level: 1 })
          sectionList.push({
            id,
            title,
            level: 1,
            content: (chunk.content || '').replace(/\n/g, '<br>')
          })
        })

        catalog.value = catalogList
        sections.value = sectionList
      }

      if (catalog.value.length > 0) {
        currentSection.value = catalog.value[0].id
      }
    }
  } catch (error) {
    console.error('从agent加载内容失败:', error)
    ElMessage.warning('无法加载文档内容，请确保文档已解析')
  }
}

// 解析文档内容，生成目录和章节
const parseDocumentContent = (extracted: any) => {
  if (!extracted || typeof extracted !== 'object') {
    return
  }

  const catalogList: CatalogItem[] = []
  const sectionList: Section[] = []

  // 遍历提取的内容
  Object.keys(extracted).forEach((key, index) => {
    const value = extracted[key]
    const sectionId = `section-${index}`

    // 判断层级（根据key的格式或内容判断）
    let level = 1
    if (key.includes('.')) {
      level = key.split('.').length
    }

    // 添加到目录
    catalogList.push({
      id: sectionId,
      title: key,
      level: Math.min(level, 3) // 最多3级
    })

    // 添加到章节
    sectionList.push({
      id: sectionId,
      title: key,
      level: Math.min(level, 3),
      content: formatContent(value)
    })
  })

  catalog.value = catalogList
  sections.value = sectionList

  // 默认选中第一个章节
  if (catalogList.length > 0) {
    currentSection.value = catalogList[0].id
  }
}

// 解析chunks内容（数据库保存格式：content + chapters JSON）
const parseChunksContent = (content: string, chaptersData: any[]) => {
  const catalogList: CatalogItem[] = []
  const sectionList: Section[] = []

  // 1. 从 chaptersData 构建左侧目录（保留完整层级）
  if (chaptersData && Array.isArray(chaptersData)) {
    chaptersData.forEach((chapter) => {
      catalogList.push({
        id: chapter.id,
        title: chapter.title,
        level: chapter.level
      })
    })
  }

  // 2. 去掉保存时注入的 "## Chunk N" 标记，合并所有 chunk 为连续文本
  const chunkParts = content.split('\n---\n\n')
  const cleanedParts = chunkParts.map(part => part.replace(/^## Chunk \d+\n/, ''))
  const mergedContent = cleanedParts.join('\n')

  // 3. 获取一级章节，用于将内容分割成 section
  const mainChapters = (chaptersData || []).filter(ch => ch.level === 1)

  if (mainChapters.length === 0) {
    // 没有一级章节 → 整段显示
    if (mergedContent.trim()) {
      sectionList.push({
        id: 'section-all',
        title: '全文内容',
        level: 1,
        content: mergedContent.trim().replace(/\n/g, '<br>')
      })
    }
  } else {
    // 4. 在合并文本中按顺序定位每个一级章节的位置
    const positions: Array<{ chapter: any; pos: number }> = []
    let searchFrom = 0

    for (const chapter of mainChapters) {
      const pos = findTitleInContent(mergedContent, chapter.title, searchFrom)
      if (pos >= 0) {
        positions.push({ chapter, pos })
        searchFrom = pos + 1
      }
    }

    if (positions.length === 0) {
      // 没有匹配到任何章节标题 → 整段显示
      sectionList.push({
        id: 'section-all',
        title: templateInfo.value?.name || '全文内容',
        level: 1,
        content: mergedContent.trim().replace(/\n/g, '<br>')
      })
    } else {
      // 5. 处理首个章节之前的内容（如有）
      if (positions[0].pos > 0) {
        const preContent = mergedContent.substring(0, positions[0].pos).trim()
        if (preContent) {
          const preId = 'section-preamble'
          catalogList.unshift({ id: preId, title: '前言', level: 1 })
          sectionList.push({
            id: preId,
            title: '前言',
            level: 1,
            content: preContent.replace(/\n/g, '<br>')
          })
        }
      }

      // 6. 按一级章节边界切分内容
      for (let i = 0; i < positions.length; i++) {
        const { chapter, pos } = positions[i]
        const endPos = i + 1 < positions.length ? positions[i + 1].pos : mergedContent.length
        const rawSection = mergedContent.substring(pos, endPos).trim()

        // 去掉标题行，避免与 section h2 重复
        const bodyContent = stripFirstLine(rawSection)

        sectionList.push({
          id: chapter.id,
          title: chapter.title,
          level: chapter.level,
          content: bodyContent.replace(/\n/g, '<br>')
        })
      }
    }
  }

  catalog.value = catalogList
  sections.value = sectionList

  if (catalogList.length > 0) {
    currentSection.value = catalogList[0].id
  }
}

// 格式化内容
const formatContent = (value: any): string => {
  if (typeof value === 'string') {
    return value.replace(/\n/g, '<br>')
  } else if (Array.isArray(value)) {
    return value.map(item => `• ${item}`).join('<br>')
  } else if (typeof value === 'object') {
    return JSON.stringify(value, null, 2).replace(/\n/g, '<br>')
  }
  return String(value)
}

// 滚动到指定章节
const scrollToSection = (sectionId: string) => {
  // 如果点击的是子章节（level > 1），则找到其所属的主章节并滚动
  let targetId = sectionId
  const clickedChapter = catalog.value.find(c => c.id === sectionId)

  if (clickedChapter && clickedChapter.level > 1) {
    // 查找这个子章节所属的主章节
    const clickedIndex = catalog.value.indexOf(clickedChapter)
    for (let i = clickedIndex - 1; i >= 0; i--) {
      if (catalog.value[i].level === 1) {
        targetId = catalog.value[i].id
        break
      }
    }
  }

  currentSection.value = targetId

  nextTick(() => {
    const element = document.getElementById(targetId)
    if (element && mainScrollbar.value) {
      const container = mainScrollbar.value.$el.querySelector('.el-scrollbar__wrap')
      if (container) {
        const offsetTop = element.offsetTop - 100 // 减去一些偏移量，让标题显示在顶部
        container.scrollTo({
          top: offsetTop,
          behavior: 'smooth'
        })
      }
    }
  })
}

// 监听内容滚动，自动高亮对应的目录项
const handleScroll = () => {
  if (!mainScrollbar.value || sections.value.length === 0) return
  
  const container = mainScrollbar.value.$el.querySelector('.el-scrollbar__wrap')
  if (!container) return
  
  const scrollTop = container.scrollTop
  const headerOffset = 120 // header高度 + 一些偏移
  
  // 找到当前滚动位置对应的章节
  let activeSectionId = sections.value[0].id
  
  for (let i = sections.value.length - 1; i >= 0; i--) {
    const section = sections.value[i]
    const element = document.getElementById(section.id)
    if (element) {
      const offsetTop = element.offsetTop
      if (scrollTop + headerOffset >= offsetTop) {
        activeSectionId = section.id
        break
      }
    }
  }
  
  if (currentSection.value !== activeSectionId) {
    currentSection.value = activeSectionId
    // 自动滚动目录到可见区域
    scrollCatalogIntoView(activeSectionId)
  }
}

// 滚动目录项到可见区域
const scrollCatalogIntoView = (sectionId: string) => {
  if (!sidebarScrollbar.value) return
  
  const catalogItem = catalogItemRefs.value.get(sectionId)
  if (!catalogItem) return
  
  const sidebarContainer = sidebarScrollbar.value.$el.querySelector('.el-scrollbar__wrap')
  if (!sidebarContainer) return
  
  // 计算目录项相对于容器的位置
  const itemTop = catalogItem.offsetTop
  const itemHeight = catalogItem.offsetHeight
  const containerHeight = sidebarContainer.clientHeight
  const scrollTop = sidebarContainer.scrollTop
  
  // 如果目录项不在可见范围内，就滚动到中间位置
  if (itemTop < scrollTop || itemTop + itemHeight > scrollTop + containerHeight) {
    sidebarContainer.scrollTo({
      top: itemTop - containerHeight / 2 + itemHeight / 2,
      behavior: 'smooth'
    })
  }
}

// 格式化日期
const formatDate = (dateString: string | number | undefined) => {
  if (!dateString) {
    return '-'
  }
  
  try {
    // 处理各种日期格式
    let date: Date
    
    if (typeof dateString === 'number') {
      // 如果是数字时间戳
      date = new Date(dateString)
    } else if (typeof dateString === 'string') {
      // 尝试解析字符串日期
      // 处理ISO 8601格式：2024-01-12T10:30:00 或 2024-01-12T10:30:00Z
      if (dateString.includes('T') || dateString.includes('-')) {
        date = new Date(dateString)
      } else {
        // 尝试作为数字时间戳解析
        const timestamp = parseInt(dateString)
        date = isNaN(timestamp) ? new Date(dateString) : new Date(timestamp)
      }
    } else {
      return '-'
    }
    
    // 检查日期是否有效
    if (isNaN(date.getTime())) {
      console.warn('无效的日期格式:', dateString)
      return '-'
    }
    
    // 返回格式化的日期
    return date.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
  } catch (error) {
    console.error('日期格式化失败:', error, '原始值:', dateString)
    return '-'
  }
}

// 组件挂载
const scrollContainer = ref<HTMLElement | null>(null)

onMounted(async () => {
  await loadTemplateDetail()
  
  // 添加滚动监听
  nextTick(() => {
    if (mainScrollbar.value) {
      scrollContainer.value = mainScrollbar.value.$el.querySelector('.el-scrollbar__wrap')
      if (scrollContainer.value) {
        scrollContainer.value.addEventListener('scroll', handleScroll, { passive: true })
      }
    }
  })
})

// 组件卸载
onUnmounted(() => {
  // 移除滚动监听
  if (scrollContainer.value) {
    scrollContainer.value.removeEventListener('scroll', handleScroll)
  }
})
</script>

<style scoped>
/* 模板详情页样式 */
.template-detail-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--gray-50);
}

/* Header样式 */
.header {
  background: linear-gradient(135deg, #ffffff 0%, #fafbfc 100%);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  position: sticky;
  top: 0;
  z-index: 1000;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  backdrop-filter: blur(10px);
}

.header-content {
  max-width: 100%;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
}

.nav-menu {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.nav-item {
  text-decoration: none;
  color: var(--gray-600);
  font-size: 14px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  transition: all 0.2s ease;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav-item:hover {
  color: var(--primary-color);
  background: var(--gray-100);
}

.nav-item.active {
  color: var(--gray-900);
  font-weight: 600;
  cursor: default;
}

.nav-separator {
  color: var(--gray-400);
  font-size: 14px;
}

.user-info {
  display: flex;
  align-items: center;
  gap: var(--spacing-lg);
}

.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
  border: 2px solid rgba(255, 255, 255, 0.9);
}

.user-avatar:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.35);
}

.user-dropdown-info {
  padding: 4px 0;
  min-width: 150px;
}

.user-dropdown-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  margin-bottom: 4px;
}

.user-dropdown-email {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* 详情容器 */
.detail-container {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 左侧目录 */
.detail-sidebar {
  width: 280px;
  background: white;
  border-right: 1px solid var(--gray-200);
  display: flex;
  flex-direction: column;
}

.sidebar-title {
  padding: 16px 20px;
  font-size: 16px;
  font-weight: 600;
  color: var(--gray-900);
  border-bottom: 1px solid var(--gray-200);
}

.sidebar-scrollbar {
  flex: 1;
  height: calc(100vh - 120px);
}

.catalog-list {
  padding: 8px;
}

.catalog-item {
  padding: 10px 16px;
  margin-bottom: 4px;
  cursor: pointer;
  border-radius: var(--radius-md);
  font-size: 14px;
  color: var(--gray-700);
  transition: all 0.2s ease;
  border-left: 3px solid transparent;
}

.catalog-item:hover {
  background: var(--gray-50);
  color: var(--primary-color);
}

.catalog-item.active {
  background: var(--primary-light);
  color: var(--primary-color);
  border-left-color: var(--primary-color);
  font-weight: 600;
}

.catalog-item.level-1 {
  padding-left: 16px;
}

.catalog-item.level-2 {
  padding-left: 32px;
  font-size: 13px;
}

.catalog-item.level-3 {
  padding-left: 48px;
  font-size: 13px;
}

/* 右侧内容区 */
.detail-main {
  flex: 1;
  background: var(--gray-50);
  overflow: hidden;
}

.main-scrollbar {
  height: calc(100vh - 60px);
}

.detail-content {
  max-width: 900px;
  margin: 0 auto;
  padding: 32px;
}

/* 模板信息区 */
.info-section {
  background: white;
  border-radius: var(--radius-lg);
  padding: 32px;
  margin-bottom: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.template-title {
  font-size: 28px;
  font-weight: 700;
  color: var(--gray-900);
  margin: 0 0 16px 0;
}

.template-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  margin-bottom: 16px;
}

.meta-tag {
  font-size: 13px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--gray-600);
}

.template-description {
  padding: 16px;
  background: var(--gray-50);
  border-radius: var(--radius-md);
  font-size: 14px;
  color: var(--gray-700);
  line-height: 1.6;
}

/* 内容章节 */
.content-section {
  background: white;
  border-radius: var(--radius-lg);
  padding: 32px;
  margin-bottom: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.section-title {
  font-weight: 600;
  color: var(--gray-900);
  margin: 0 0 20px 0;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--gray-200);
}

.section-title.level-1 {
  font-size: 22px;
}

.section-title.level-2 {
  font-size: 18px;
}

.section-title.level-3 {
  font-size: 16px;
}

.section-content {
  font-size: 14px;
  color: var(--gray-700);
  line-height: 1.8;
}

/* 加载和空状态 */
.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  height: 400px;
  font-size: 16px;
  color: var(--gray-600);
}

.loading-container .el-icon {
  font-size: 32px;
  color: var(--primary-color);
}

.empty-content {
  margin-top: 100px;
}
</style>
