<template>
  <div class="kd-page">
    <!-- 面包屑导航 -->
    <el-breadcrumb separator="/" class="kd-breadcrumb">
      <el-breadcrumb-item :to="{ path: '/admin/knowledge-categories' }">知识库管理</el-breadcrumb-item>
      <el-breadcrumb-item>{{ categoryInfo?.name || '文档管理' }}</el-breadcrumb-item>
    </el-breadcrumb>

    <!-- 分类信息 -->
    <div class="kd-header" v-if="categoryInfo">
      <div class="kd-header__title-row">
        <h2 class="kd-header__title">{{ categoryInfo.name }}</h2>
        <el-popover placement="bottom-start" :width="320" trigger="click">
          <template #reference>
            <el-button size="small" text>
              <el-icon><Setting /></el-icon> 分块设置
            </el-button>
          </template>
          <div class="chunk-settings">
            <div class="chunk-settings__title">分块配置</div>
            <el-form label-position="top" size="small">
              <el-form-item label="分块模式">
                <el-select v-model="chunkConfig.mode" style="width: 100%;">
                  <el-option label="自动（推荐，标题感知）" value="auto" />
                  <el-option label="固定长度（无标题结构时使用）" value="fixed" />
                  <el-option label="按段落（已分段文档使用）" value="paragraph" />
                </el-select>
              </el-form-item>
              <el-form-item label="最大字符数">
                <el-input-number v-model="chunkConfig.maxChars" :min="200" :max="4000" :step="100" style="width: 100%;" />
              </el-form-item>
              <el-form-item label="重叠字符数" v-if="chunkConfig.mode !== 'fixed'">
                <el-input-number v-model="chunkConfig.overlap" :min="0" :max="500" :step="50" style="width: 100%;" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveChunkConfig" :loading="chunkConfigSaving">
                  保存配置
                </el-button>
                <span class="chunk-settings__hint">配置影响后续上传文档的分块方式</span>
              </el-form-item>
            </el-form>
          </div>
        </el-popover>
      </div>
      <p v-if="categoryInfo.description" class="kd-header__desc">{{ categoryInfo.description }}</p>
    </div>

    <!-- 统计卡片 -->
    <div class="kd-stats">
      <StatsCard :value="pagination.total" label="文档总数" :icon="Document" variant="primary" />
      <StatsCard :value="totalParagraphs" label="向量片段" :icon="DataAnalysis" variant="success" />
      <StatsCard :value="totalChars" label="总字符数" :icon="Notebook" variant="warning" />
    </div>

    <!-- 工具栏 + 表格 -->
    <el-card class="kd-table-card" shadow="never">
      <!-- 上传进度条 -->
      <div v-if="activeTasks.length > 0" class="upload-progress-bar">
        <div v-for="task in activeTasks" :key="task.id" class="upload-progress-item">
          <div class="upload-progress-info">
            <el-icon class="is-loading" :size="14" v-if="task.status === 'processing'"><Loading /></el-icon>
            <el-icon :size="14" v-else-if="task.status === 'completed'"><CircleCheck /></el-icon>
            <el-icon :size="14" v-else-if="task.status === 'failed'"><CircleClose /></el-icon>
            <el-icon class="is-loading" :size="14" v-else><Loading /></el-icon>
            <span class="upload-progress-name">{{ task.fileName || '处理中...' }}</span>
            <span class="upload-progress-msg">{{ task.message }}</span>
          </div>
          <el-progress
            :percentage="task.progress"
            :status="task.status === 'completed' ? 'success' : task.status === 'failed' ? 'exception' : undefined"
            :stroke-width="4"
            :show-text="false"
          />
        </div>
      </div>

      <!-- 工具栏 -->
      <div class="kd-toolbar">
        <div class="kd-toolbar__left">
          <el-button type="primary" size="small" @click="uploadDialogVisible = true">
            <el-icon><Upload /></el-icon> 上传文档
          </el-button>
          <el-button size="small" @click="previewDialogVisible = true">
            <el-icon><View /></el-icon> 分段预览导入
          </el-button>
          <el-button
            size="small"
            @click="batchVectorize"
            :disabled="selectedDocs.length === 0"
          >
            <el-icon><RefreshRight /></el-icon> 批量向量化
          </el-button>
          <el-button size="small" @click="openHitTestDrawer">
            <el-icon><Aim /></el-icon> 检索测试
          </el-button>
          <el-dropdown v-if="selectedDocs.length > 0">
            <el-button size="small" :disabled="selectedDocs.length === 0">
              更多 <el-icon><ArrowDown /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="batchDelete">
                  <el-icon><Delete /></el-icon> 批量删除
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <span v-if="selectedDocs.length > 0" class="kd-toolbar__selected">
            已选 {{ selectedDocs.length }} 项
            <el-button type="primary" link size="small" @click="clearSelection">清除</el-button>
          </span>
        </div>
        <div class="kd-toolbar__right">
          <el-input
            v-model="searchQuery"
            placeholder="搜索文档名称..."
            clearable
            size="small"
            style="width: 220px;"
            :prefix-icon="Search"
            @change="handleSearch"
          />
          <el-select
            v-model="tagFilterValue"
            multiple
            collapse-tags
            collapse-tags-tooltip
            placeholder="按标签过滤"
            size="small"
            style="width: 180px;"
            clearable
          >
            <el-option
              v-for="tag in allTags"
              :key="tag.id"
              :label="`${tag.key}:${tag.value}`"
              :value="tag.id"
            />
          </el-select>
          <el-tooltip content="刷新" placement="top">
            <el-button size="small" @click="refreshData">
              <el-icon><Refresh /></el-icon>
            </el-button>
          </el-tooltip>
        </div>
      </div>

      <!-- 文档表格 -->
      <el-table
        ref="tableRef"
        :data="filteredDocumentList"
        v-loading="loading"
        empty-text="暂无文档，请点击「上传文档」添加"
        @selection-change="handleSelectionChange"
        row-key="title"
        @row-click="handleRowClick"
        style="width: 100%"
      >
        <el-table-column type="selection" width="48" />
        <el-table-column prop="title" label="文档名称" min-width="240">
          <template #default="{ row }">
            <div class="doc-name-cell">
              <el-icon class="doc-name-cell__icon" :size="16"><Document /></el-icon>
              <span
                class="doc-name-cell__text"
                :class="{ 'is-editing': editingDoc === row.title }"
                :contenteditable="editingDoc === row.title"
                @dblclick.stop="startEditDoc(row)"
                @blur="finishEditDoc(row, $event)"
                @keydown.enter.prevent="finishEditDoc(row, $event)"
                @keydown.escape.prevent="cancelEdit"
              >{{ row.title }}</span>
              <el-icon
                v-if="editingDoc !== row.title"
                class="doc-name-cell__edit-icon"
                :size="12"
                @click.stop="startEditDoc(row)"
              ><Edit /></el-icon>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="标签" min-width="180">
          <template #default="{ row }">
            <div class="doc-tags-cell">
              <el-tag
                v-for="tag in getDocTags(row.title)"
                :key="tag.id"
                size="small"
                type="info"
                effect="plain"
                closable
                class="doc-tags-cell__tag"
                @close.stop="toggleDocumentTag(row.title, tag)"
              >
                {{ tag.key }}:{{ tag.value }}
              </el-tag>
              <el-popover
                :visible="tagPopoverVisible[row.title]"
                placement="bottom-start"
                :width="280"
                trigger="click"
                @update:visible="(v: boolean) => tagPopoverVisible[row.title] = v"
              >
                <template #reference>
                  <el-button
                    size="small"
                    text
                    type="primary"
                    class="doc-tags-cell__add"
                    @click.stop="toggleTagPopover(row.title)"
                  >
                    <el-icon><Plus /></el-icon>
                  </el-button>
                </template>
                <div class="tag-popover">
                  <div class="tag-popover__list" v-if="allTags.length > 0">
                    <div
                      v-for="tag in allTags"
                      :key="tag.id"
                      class="tag-popover__item"
                      :class="{ 'is-active': isTagApplied(row.title, tag.id) }"
                      @click="toggleDocumentTag(row.title, tag)"
                    >
                      <span class="tag-popover__item-label">{{ tag.key }}:{{ tag.value }}</span>
                      <el-icon v-if="isTagApplied(row.title, tag.id)" :size="12"><CircleCheck /></el-icon>
                      <el-button
                        v-else
                        type="danger"
                        link
                        size="small"
                        @click.stop="handleDeleteTag(tag.id)"
                      >
                        <el-icon :size="10"><Delete /></el-icon>
                      </el-button>
                    </div>
                  </div>
                  <el-divider v-if="allTags.length > 0" style="margin: 8px 0;" />
                  <div class="tag-popover__create">
                    <el-input v-model="newTagKey" placeholder="标签名" size="small" style="width: 90px;" />
                    <el-input v-model="newTagValue" placeholder="标签值" size="small" style="width: 90px;" />
                    <el-button size="small" type="primary" @click="handleCreateTag(row.title)">
                      <el-icon><Plus /></el-icon>
                    </el-button>
                  </div>
                </div>
              </el-popover>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120" align="center">
          <template #default="{ row }">
            <div class="status-cell">
              <el-icon
                v-if="row.is_fully_embedded"
                class="status-cell__icon status-cell__icon--success"
                :size="14"
              ><CircleCheck /></el-icon>
              <el-icon
                v-else-if="row.embedded_count > 0"
                class="status-cell__icon status-cell__icon--warning"
                :size="14"
              ><Loading /></el-icon>
              <el-icon
                v-else
                class="status-cell__icon status-cell__icon--danger"
                :size="14"
              ><CircleClose /></el-icon>
              <span class="status-cell__text">
                {{ row.is_fully_embedded ? '已完成' : row.embedded_count > 0 ? '部分向量化' : '未向量化' }}
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="char_length" label="字符数" width="100" align="right" sortable>
          <template #default="{ row }">
            {{ formatNumber(row.char_length) }}
          </template>
        </el-table-column>
        <el-table-column prop="paragraph_count" label="段落数" width="80" align="right" sortable />
        <el-table-column prop="create_time" label="创建时间" width="170" sortable>
          <template #default="{ row }">
            {{ formatTime(row.create_time) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right" align="center">
          <template #default="{ row }">
            <el-tooltip content="向量化" placement="top">
              <el-button type="primary" link size="small" @click.stop="vectorizeDoc(row)">
                <el-icon><RefreshRight /></el-icon>
              </el-button>
            </el-tooltip>
            <el-tooltip content="查看段落" placement="top">
              <el-button type="primary" link size="small" @click.stop="openParagraphDrawer(row)">
                <el-icon><View /></el-icon>
              </el-button>
            </el-tooltip>
            <el-dropdown trigger="click" @command="(cmd: string) => handleRowCommand(cmd, row)">
              <el-button type="primary" link size="small" @click.stop>
                <el-icon><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="generate-questions">
                    <el-icon><ChatDotRound /></el-icon> 生成问题
                  </el-dropdown-item>
                  <el-dropdown-item command="delete" divided>
                    <el-icon><Delete /></el-icon> 删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页 -->
      <div class="kd-pagination" v-if="pagination.total > 0">
        <el-pagination
          v-model:current-page="pagination.current_page"
          v-model:page-size="pagination.page_size"
          :total="pagination.total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @change="fetchDocuments"
        />
      </div>
    </el-card>

    <!-- 上传对话框 -->
    <UploadDialog
      v-model="uploadDialogVisible"
      :target-id="categoryId"
      :target-name="categoryInfo?.name || ''"
      title="上传文档"
      :upload-fn="uploadKnowledgeDocumentApi"
      @uploaded="handleUploadComplete"
    />

    <!-- 分段预览确认对话框 -->
    <PreviewConfirmDialog
      v-model="previewDialogVisible"
      :category-id="categoryId"
      @imported="fetchDocuments"
    />

    <!-- 段落全屏浏览页 -->
    <div v-if="paragraphViewVisible" class="para-page">
      <div class="para-page__topbar">
        <el-button text @click="closeParagraphView">
          <el-icon :size="18"><ArrowLeft /></el-icon> 返回文档列表
        </el-button>
        <div class="para-page__topbar-title">
          <span class="para-page__doc-name">{{ currentParagraphTitle }}</span>
          <span class="para-page__stats" v-if="paragraphs.length > 0">
            {{ paragraphs.length }} 段 · {{ paragraphTotalChars.toLocaleString() }} 字符
            <span class="para-page__badge">
              <el-icon :size="12"><CircleCheck /></el-icon> 已向量化
            </span>
          </span>
        </div>
        <div class="para-page__topbar-actions">
          <el-input
            v-model="paragraphSearchQuery"
            placeholder="搜索段落..."
            clearable
            size="small"
            style="width: 200px;"
            :prefix-icon="Search"
          />
        </div>
      </div>

      <div class="para-page__body" v-loading="paragraphLoading">
        <template v-if="paragraphs.length > 0">
          <!-- 左侧导航 -->
          <aside class="para-page__nav">
            <div class="para-page__nav-header">段落导航</div>
            <el-scrollbar height="100%">
              <div class="para-page__nav-list">
                <a
                  v-for="(para, idx) in filteredParagraphs"
                  :key="para.id"
                  class="para-page__nav-item"
                  :class="{ 'is-active': activeParagraphId === para.id }"
                  @click.prevent="scrollToParagraph(para.id)"
                >
                  <span class="para-page__nav-index">#{{ idx + 1 }}</span>
                  <span class="para-page__nav-label">{{ para.clauseId || `段落 ${idx + 1}` }}</span>
                  <span v-if="isTableContent(para.content)" class="para-page__nav-tag">
                    <el-icon :size="10"><Grid /></el-icon>
                  </span>
                </a>
              </div>
            </el-scrollbar>
            <div class="para-page__nav-footer">
              <span>{{ filteredParagraphs.length }} / {{ paragraphs.length }} 段</span>
            </div>
          </aside>

          <!-- 右侧内容 -->
          <main class="para-page__content" ref="drawerContentRef">
            <div
              v-for="(para, idx) in filteredParagraphs"
              :key="para.id"
              :id="`para-${para.id}`"
              class="para-card"
              :class="{ 'is-editing': editingParagraphId === para.id }"
            >
              <div class="para-card__header">
                <div class="para-card__meta">
                  <el-tag size="small" type="info" effect="plain">#{{ idx + 1 }}</el-tag>
                  <el-tag v-if="para.clauseId" size="small" type="primary" effect="plain" class="para-card__clause-tag">
                    {{ para.clauseId }}
                  </el-tag>
                  <el-tag v-if="para.metadata?.heading" size="small" type="success" effect="plain" class="para-card__clause-tag">
                    {{ para.metadata.heading }}
                  </el-tag>
                  <span v-if="isTableContent(para.content)" class="para-card__type-badge">
                    <el-icon :size="12"><Grid /></el-icon> 表格
                  </span>
                </div>
                <div class="para-card__actions">
                  <span class="para-card__length">{{ para.content.length }} 字符</span>
                  <el-tooltip content="编辑" placement="top">
                    <el-button type="primary" link size="small" @click="startEditParagraph(para)">
                      <el-icon><Edit /></el-icon>
                    </el-button>
                  </el-tooltip>
                  <el-popconfirm title="确认删除此段落？" @confirm="handleDeleteParagraph(para.id)">
                    <template #reference>
                      <el-button type="danger" link size="small">
                        <el-icon><Delete /></el-icon>
                      </el-button>
                    </template>
                  </el-popconfirm>
                </div>
              </div>
              <div class="para-card__body" v-if="editingParagraphId !== para.id">
                <div v-if="isTableContent(para.content)" class="para-card__table-wrap" v-html="renderTableHtml(para.content)"></div>
                <template v-else>{{ para.content }}</template>
              </div>
              <div class="para-card__edit" v-else>
                <el-input
                  ref="paragraphEditRef"
                  v-model="editingParagraphContent"
                  type="textarea"
                  :rows="6"
                  @keydown.escape="cancelParagraphEdit"
                />
                <div class="para-card__edit-actions">
                  <el-button size="small" @click="cancelParagraphEdit">取消</el-button>
                  <el-button size="small" type="primary" @click="saveParagraphEdit(para.id)">保存</el-button>
                </div>
              </div>
            </div>
          </main>
        </template>
        <el-empty v-else-if="!paragraphLoading" description="暂无段落数据" />
      </div>
    </div>

    <!-- 向量化配置对话框 -->
    <VectorizeDialog
      v-model="vectorizeDialogVisible"
      @confirm="handleVectorizeConfirm"
    />

    <!-- 检索测试抽屉 -->
    <el-drawer
      v-model="hitTestDrawerVisible"
      title="检索效果测试"
      direction="rtl"
      size="520px"
      :before-close="closeHitTestDrawer"
      class="hit-test-drawer"
    >
      <div class="ht-drawer">
        <!-- 查询表单 -->
        <div class="ht-form">
          <el-input
            v-model="hitTestForm.query"
            placeholder="输入检索内容，如：消防水泵扬程要求"
            clearable
            @keyup.enter="handleHitTest"
            class="ht-form__query"
          >
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
          <div class="ht-form__options">
            <el-radio-group v-model="hitTestForm.searchMode" size="small">
              <el-radio-button value="hybrid">混合</el-radio-button>
              <el-radio-button value="vector">向量</el-radio-button>
              <el-radio-button value="keyword">关键词</el-radio-button>
            </el-radio-group>
            <el-input-number
              v-model="hitTestForm.topNumber"
              :min="1" :max="30"
              size="small"
              style="width: 80px;"
            />
            <el-button
              type="primary"
              @click="handleHitTest"
              :loading="hitTestLoading"
              size="small"
            >
              <el-icon><Search /></el-icon> 测试
            </el-button>
          </div>
        </div>

        <!-- 结果统计 -->
        <div v-if="hitTestResult" class="ht-stats">
          <el-tag size="small" type="info" effect="plain">{{ hitTestResult.stats.searchTimeMs }}ms</el-tag>
          <el-tag size="small" effect="plain">候选 {{ hitTestResult.stats.totalCandidates }}</el-tag>
        </div>

        <!-- 结果列表 -->
        <el-scrollbar class="ht-results" v-if="hitTestResult">
          <div v-if="hitTestResult.results.length === 0" class="ht-empty">
            <el-empty description="未检索到相关内容" :image-size="60" />
          </div>
          <div
            v-for="(item, index) in hitTestResult.results"
            :key="item.id"
            class="ht-result"
          >
            <div class="ht-result__header">
              <span class="ht-result__rank">#{{ index + 1 }}</span>
              <span class="ht-result__title">
                {{ item.title || '未知' }}
                <el-tag v-if="item.clauseId" size="small" type="primary" effect="plain" style="margin-left: 4px;">
                  {{ item.clauseId }}
                </el-tag>
                <el-tag v-if="item.isTable" size="small" type="warning" effect="plain" style="margin-left: 2px;">
                  表格
                </el-tag>
              </span>
              <div class="ht-result__scores">
                <el-tag size="small" :type="hitScoreType(item.comprehensiveScore)" effect="plain">
                  {{ (item.comprehensiveScore * 100).toFixed(0) }}%
                </el-tag>
                <el-tag v-if="item.rerankScore != null" size="small" type="success" effect="plain">
                  RR {{ (item.rerankScore * 100).toFixed(0) }}%
                </el-tag>
              </div>
            </div>
            <div class="ht-result__content">{{ item.content.substring(0, 300) }}{{ item.content.length > 300 ? '...' : '' }}</div>
          </div>
        </el-scrollbar>
        <div v-else class="ht-placeholder">
          <el-icon :size="32" color="var(--corp-text-tertiary)"><Aim /></el-icon>
          <p>输入查询测试当前知识库的检索效果</p>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  Upload, RefreshRight, Refresh, Search, ArrowLeft,
  Document, View, Edit, Delete, ArrowDown, MoreFilled,
  CircleCheck, CircleClose, Loading, DataAnalysis, Notebook, Grid, Plus, PriceTag, Setting, ChatDotRound, Aim,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import StatsCard from './components/StatsCard.vue'
import UploadDialog from './components/UploadDialog.vue'
import PreviewConfirmDialog from './components/PreviewConfirmDialog.vue'
import VectorizeDialog from './components/VectorizeDialog.vue'
import {
  getKnowledgeCategoriesApi,
  getGroupedDocumentsApi,
  updateDocumentApi,
  deleteDocumentApi,
  uploadKnowledgeDocumentApi,
  getDocumentParagraphsApi,
  updateParagraphApi,
  deleteParagraphApi,
  batchVectorizeApi,
  updateKnowledgeCategoryApi,
  getTagsApi,
  createTagApi,
  deleteTagApi,
  addDocumentTagApi,
  removeDocumentTagApi,
  generateQuestionsApi,
  hitTestApi,
  getActiveTasksApi,
  type GroupedDocument,
  type DocumentParagraph,
  type Tag,
  type HitTestResult,
  type UploadTaskStatus,
} from '@/api/knowledge-category'

const router = useRouter()
const route = useRoute()
const categoryId = route.params.id as string

// ===== 分类信息 =====
const categoryInfo = ref<any>(null)

// ===== 分块配置 =====
const chunkConfig = reactive({
  mode: 'auto' as 'auto' | 'fixed' | 'paragraph',
  maxChars: 1500,
  overlap: 120,
})
const chunkConfigSaving = ref(false)

const saveChunkConfig = async () => {
  chunkConfigSaving.value = true
  try {
    await updateKnowledgeCategoryApi(categoryId, {
      chunkMode: chunkConfig.mode,
      maxChars: chunkConfig.maxChars,
      overlap: chunkConfig.overlap,
    })
    if (categoryInfo.value) {
      categoryInfo.value.chunkMode = chunkConfig.mode
      categoryInfo.value.maxChars = chunkConfig.maxChars
      categoryInfo.value.overlap = chunkConfig.overlap
    }
    ElMessage.success('分块配置已保存')
  } catch { ElMessage.error('保存失败') }
  finally { chunkConfigSaving.value = false }
}

// ===== 文档列表 =====
const loading = ref(false)
const documentList = ref<GroupedDocument[]>([])
const searchQuery = ref('')
const tableRef = ref<any>(null)
const selectedDocs = ref<any[]>([])
const editingDoc = ref<string | null>(null)
let pollTimer: any = null

const pagination = reactive({
  current_page: 1,
  page_size: 10,
  total: 0,
})

const totalParagraphs = computed(() =>
  documentList.value.reduce((sum, d) => sum + d.paragraph_count, 0)
)
const totalChars = computed(() =>
  documentList.value.reduce((sum, d) => sum + d.char_length, 0)
)

// ===== 数据加载 =====
const fetchCategoryInfo = async () => {
  try {
    const { data } = await getKnowledgeCategoriesApi()
    // 递归搜索嵌套的分类树
    const findById = (nodes: any[], id: string): any => {
      for (const node of nodes) {
        if (node.id === id) return node
        if (node.children) {
          const found = findById(node.children, id)
          if (found) return found
        }
      }
      return null
    }
    categoryInfo.value = findById(data || [], categoryId)
    if (categoryInfo.value) {
      chunkConfig.mode = categoryInfo.value.chunkMode || 'auto'
      chunkConfig.maxChars = categoryInfo.value.maxChars || 1500
      chunkConfig.overlap = categoryInfo.value.overlap || 120
    }
  } catch (_) {}
}

const fetchDocuments = async () => {
  loading.value = true
  try {
    const { data } = await getGroupedDocumentsApi(categoryId, {
      page: pagination.current_page,
      pageSize: pagination.page_size,
      query: searchQuery.value || undefined,
    })
    documentList.value = data?.items || []
    pagination.total = data?.total || 0

    await fetchAllTags()

    const hasPending = documentList.value.some(d => !d.is_fully_embedded)
    if (hasPending && !pollTimer) {
      startPolling()
    } else if (!hasPending && pollTimer) {
      stopPolling()
    }
  } catch (e) {
    console.error('获取文档列表失败', e)
  } finally {
    loading.value = false
  }
}

const refreshData = () => {
  pagination.current_page = 1
  fetchDocuments()
}

const handleSearch = () => {
  pagination.current_page = 1
  fetchDocuments()
}

// ===== 轮询 =====
const startPolling = () => {
  if (pollTimer) return
  pollTimer = setInterval(() => { fetchDocuments() }, 6000)
}

const stopPolling = () => {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// ===== 选择 =====
const handleSelectionChange = (val: any[]) => { selectedDocs.value = val }
const clearSelection = () => { tableRef.value?.clearSelection() }

// ===== 行点击 → 打开段落 =====
const handleRowClick = (row: any, column: any) => {
  if (column?.type === 'selection') return
  openParagraphDrawer(row)
}

// ===== 文档名称编辑 =====
const startEditDoc = (row: any) => {
  editingDoc.value = row.title
  nextTick(() => {
    const el = document.querySelector('.doc-name-cell__text.is-editing') as HTMLElement
    el?.focus()
  })
}

const finishEditDoc = async (row: any, event: Event) => {
  const newName = (event.target as HTMLElement).textContent?.trim()
  editingDoc.value = null
  if (!newName || newName === row.title) return
  try {
    await updateDocumentApi(categoryId, { oldTitle: row.title, newTitle: newName })
    ElMessage.success('重命名成功')
    fetchDocuments()
  } catch { ElMessage.error('重命名失败') }
}

const cancelEdit = () => { editingDoc.value = null; fetchDocuments() }

// ===== 向量化 =====
const vectorizeDoc = async (row: any) => {
  try {
    await ElMessageBox.confirm(`确认对 "${row.title}" 重新向量化？`, '向量化确认', {
      confirmButtonText: '确认', cancelButtonText: '取消', type: 'info',
    })
  } catch { return }
  try {
    await batchVectorizeApi(categoryId, [row.title])
    ElMessage.success('向量化完成')
    fetchDocuments()
  } catch { ElMessage.error('向量化失败') }
}

const batchVectorize = async () => {
  if (selectedDocs.value.length === 0) return
  try {
    await ElMessageBox.confirm(`确认对选中的 ${selectedDocs.value.length} 个文档重新向量化？`, '批量向量化确认', {
      confirmButtonText: '确认', cancelButtonText: '取消', type: 'info',
    })
  } catch { return }
  try {
    const titles = selectedDocs.value.map(d => d.title)
    await batchVectorizeApi(categoryId, titles)
    ElMessage.success('批量向量化完成')
    clearSelection()
    fetchDocuments()
  } catch { ElMessage.error('批量向量化失败') }
}

// ===== 批量删除 =====
const batchDelete = async () => {
  if (selectedDocs.value.length === 0) return
  try {
    await ElMessageBox.confirm(
      `确认删除选中的 ${selectedDocs.value.length} 个文档及其所有向量数据？此操作不可撤销。`,
      '批量删除确认',
      { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch { return }
  try {
    for (const doc of selectedDocs.value) {
      await deleteDocumentApi(categoryId, doc.title)
    }
    ElMessage.success(`已删除 ${selectedDocs.value.length} 个文档`)
    clearSelection()
    fetchDocuments()
  } catch { ElMessage.error('批量删除失败') }
}

// ===== 行操作 =====
const handleRowCommand = async (command: string, row: any) => {
  if (command === 'generate-questions') {
    try {
      await ElMessageBox.confirm(
        `确认为「${row.title}」的 ${row.paragraph_count} 个段落自动生成问题？这将调用 LLM 接口。`,
        '生成问题确认',
        { confirmButtonText: '确认生成', cancelButtonText: '取消', type: 'info' }
      )
    } catch { return }
    try {
      const { data } = await generateQuestionsApi(categoryId, row.title)
      ElMessage.success(`生成完成，${data.generatedCount}/${data.totalChunks} 个段落已生成问题`)
    } catch { ElMessage.error('问题生成失败') }
    return
  }

  if (command === 'delete') {
    try {
      await ElMessageBox.confirm(`确认删除 "${row.title}" 及其所有向量数据？`, '删除确认', {
        confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning',
      })
    } catch { return }
    try {
      await deleteDocumentApi(categoryId, row.title)
      ElMessage.success('删除成功')
      fetchDocuments()
    } catch { ElMessage.error('删除失败') }
  }
}

// ===== 上传 =====
const uploadDialogVisible = ref(false)
const previewDialogVisible = ref(false)

// ===== 异步上传任务追踪 =====
const activeTasks = ref<UploadTaskStatus[]>([])
let taskPollTimer: ReturnType<typeof setInterval> | null = null

const startTaskPolling = () => {
  if (taskPollTimer) return
  taskPollTimer = setInterval(async () => {
    try {
      const { data } = await getActiveTasksApi()
      activeTasks.value = data || []
      if (activeTasks.value.length === 0) {
        stopTaskPolling()
        fetchDocuments()
      }
    } catch { /* ignore */ }
  }, 2000)
}

const stopTaskPolling = () => {
  if (taskPollTimer) { clearInterval(taskPollTimer); taskPollTimer = null }
}

const handleUploadComplete = (taskIds?: string[]) => {
  if (taskIds?.length) {
    activeTasks.value = taskIds.map(id => ({
      id,
      fileName: '',
      status: 'pending' as const,
      progress: 0,
      message: '等待处理...',
      createdAt: Date.now(),
    }))
    startTaskPolling()
  }
  fetchDocuments()
}

// ===== 标签管理 =====
const allTags = ref<Tag[]>([])
const tagPopoverVisible = ref<Record<string, boolean>>({})
const tagFilterValue = ref<string[]>([])
const newTagKey = ref('')
const newTagValue = ref('')

const fetchAllTags = async () => {
  try {
    const { data } = await getTagsApi({ categoryId })
    allTags.value = data || []
  } catch (_) {}
}

const getDocRow = (title: string) => documentList.value.find(doc => doc.title === title)

const toggleTagPopover = async (title: string) => {
  const visible = !tagPopoverVisible.value[title]
  // Close all other popovers
  for (const key of Object.keys(tagPopoverVisible.value)) {
    tagPopoverVisible.value[key] = false
  }
  tagPopoverVisible.value[title] = visible
}

const isTagApplied = (title: string, tagId: string): boolean => {
  return getDocRow(title)?.tags?.some(t => t.id === tagId) || false
}

const toggleDocumentTag = async (title: string, tag: Tag) => {
  const row = getDocRow(title)
  if (!row) return
  try {
    if (isTagApplied(title, tag.id)) {
      await removeDocumentTagApi(categoryId, { tagId: tag.id, documentTitle: title })
      row.tags = row.tags.filter(t => t.id !== tag.id)
    } else {
      await addDocumentTagApi(categoryId, { tagId: tag.id, documentTitle: title })
      row.tags = [...(row.tags || []), tag]
    }
  } catch { ElMessage.error('标签操作失败') }
}

const handleCreateTag = async (title: string) => {
  if (!newTagKey.value.trim() || !newTagValue.value.trim()) return
  try {
    const { data } = await createTagApi({
      key: newTagKey.value.trim(),
      value: newTagValue.value.trim(),
      categoryId,
    })
    allTags.value.push(data)
    await addDocumentTagApi(categoryId, { tagId: data.id, documentTitle: title })
    const row = getDocRow(title)
    if (row) row.tags = [...(row.tags || []), data]
    newTagKey.value = ''
    newTagValue.value = ''
  } catch (err: any) {
    ElMessage.error(err?.response?.data?.message || '创建标签失败')
  }
}

const handleDeleteTag = async (tagId: string) => {
  try {
    await deleteTagApi(tagId)
    allTags.value = allTags.value.filter(t => t.id !== tagId)
    for (const doc of documentList.value) {
      doc.tags = (doc.tags || []).filter(t => t.id !== tagId)
    }
  } catch { ElMessage.error('删除标签失败') }
}

/** 获取文档标签（优先从缓存，否则请求） */
const getDocTags = (title: string): Tag[] => {
  return (getDocRow(title)?.tags || []) as Tag[]
}

/** 过滤后的文档列表（按标签） */
const filteredDocumentList = computed(() => {
  if (tagFilterValue.value.length === 0) return documentList.value
  return documentList.value.filter(doc => {
    const tags = doc.tags || []
    return tagFilterValue.value.some(tagId => tags.some(t => t.id === tagId))
  })
})

// ===== 段落全屏页 =====
const paragraphViewVisible = ref(false)
const paragraphLoading = ref(false)
const currentParagraphTitle = ref('')
const paragraphs = ref<DocumentParagraph[]>([])
const paragraphTotalChars = ref(0)
const editingParagraphId = ref<string | null>(null)
const editingParagraphContent = ref('')
const activeParagraphId = ref<string | null>(null)
const paragraphSearchQuery = ref('')

const filteredParagraphs = computed(() => {
  if (!paragraphSearchQuery.value.trim()) return paragraphs.value
  const q = paragraphSearchQuery.value.toLowerCase()
  return paragraphs.value.filter(p =>
    (p.clauseId && p.clauseId.toLowerCase().includes(q)) ||
    p.content.toLowerCase().includes(q)
  )
})

const openParagraphDrawer = async (row: any) => {
  currentParagraphTitle.value = row.title
  paragraphViewVisible.value = true
  paragraphLoading.value = true
  paragraphs.value = []
  activeParagraphId.value = null
  paragraphSearchQuery.value = ''
  try {
    const { data } = await getDocumentParagraphsApi(categoryId, row.title)
    paragraphs.value = data?.paragraphs || []
    paragraphTotalChars.value = data?.totalChars || 0
    if (paragraphs.value.length > 0) activeParagraphId.value = paragraphs.value[0].id
  } catch {
    ElMessage.error('获取段落失败')
  } finally {
    paragraphLoading.value = false
  }
}

const closeParagraphView = () => {
  paragraphViewVisible.value = false
  editingParagraphId.value = null
  paragraphs.value = []
  paragraphSearchQuery.value = ''
  fetchDocuments()
}

const scrollToParagraph = (id: string) => {
  activeParagraphId.value = id
  const el = document.getElementById(`para-${id}`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const startEditParagraph = (para: DocumentParagraph) => {
  editingParagraphId.value = para.id
  editingParagraphContent.value = para.content
}

const cancelParagraphEdit = () => {
  editingParagraphId.value = null
  editingParagraphContent.value = ''
}

const saveParagraphEdit = async (paraId: string) => {
  try {
    await updateParagraphApi(paraId, { content: editingParagraphContent.value })
    ElMessage.success('段落已更新')
    const para = paragraphs.value.find(p => p.id === paraId)
    if (para) para.content = editingParagraphContent.value
    cancelParagraphEdit()
  } catch { ElMessage.error('更新失败') }
}

const handleDeleteParagraph = async (paraId: string) => {
  try {
    await deleteParagraphApi(paraId)
    ElMessage.success('段落已删除')
    paragraphs.value = paragraphs.value.filter(p => p.id !== paraId)
    paragraphTotalChars.value = paragraphs.value.reduce((sum, p) => sum + p.content.length, 0)
  } catch { ElMessage.error('删除失败') }
}

// ===== 向量化配置对话框 =====
const vectorizeDialogVisible = ref(false)
const pendingVectorizeDocs = ref<string[]>([])

// ===== 检索测试 =====
const hitTestDrawerVisible = ref(false)
const hitTestLoading = ref(false)
const hitTestResult = ref<HitTestResult | null>(null)
const hitTestForm = reactive({
  query: '',
  searchMode: 'hybrid' as 'vector' | 'keyword' | 'hybrid',
  topNumber: 10,
})

const openHitTestDrawer = () => {
  hitTestDrawerVisible.value = true
  hitTestResult.value = null
  hitTestForm.query = ''
}

const closeHitTestDrawer = () => {
  hitTestDrawerVisible.value = false
  hitTestResult.value = null
}

const handleHitTest = async () => {
  if (!hitTestForm.query.trim()) return
  hitTestLoading.value = true
  try {
    const res = await hitTestApi({
      query: hitTestForm.query.trim(),
      categoryId,
      topNumber: hitTestForm.topNumber,
      searchMode: hitTestForm.searchMode,
    })
    hitTestResult.value = res.data
  } catch (err: any) {
    console.error('Hit test failed:', err)
  } finally {
    hitTestLoading.value = false
  }
}

const hitScoreType = (score: number) => {
  if (score >= 0.8) return 'success'
  if (score >= 0.5) return 'warning'
  return 'info'
}

const handleVectorizeConfirm = async (_config: any) => {
  try {
    await batchVectorizeApi(categoryId, pendingVectorizeDocs.value)
    ElMessage.success('向量化任务已提交')
    pendingVectorizeDocs.value = []
    fetchDocuments()
  } catch {
    ElMessage.error('向量化失败')
  }
}

// ===== 工具函数 =====
const formatNumber = (n: number) => {
  if (!n) return '0'
  return n.toLocaleString()
}

const formatTime = (t: string) => {
  if (!t) return '-'
  const d = new Date(t)
  return d.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

/** 检测内容是否为Markdown表格（以分隔行 |---| 为唯一标准） */
const isTableContent = (content: string): boolean => {
  if (!content) return false
  const lines = content.split('\n').filter(l => l.trim())
  if (lines.length < 2) return false
  // 必须存在 |---| 分隔行
  const hasSeparator = lines.some(l => /^\|[\s\-:|]+\|$/.test(l.trim()))
  if (!hasSeparator) return false
  // 分隔行上下需要有2+行以|开头的行
  const pipeLines = lines.filter(l => l.trim().startsWith('|'))
  return pipeLines.length >= 2
}

/** 清理Markdown加粗标记 */
const stripBold = (text: string): string => text.replace(/\*\*(.+?)\*\*/g, '$1')

/** 解析一行表格的单元格 */
const parseTableLine = (line: string): string[] => {
  const trimmed = line.trim()
  // 标准格式：| col | col |
  if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
    return trimmed.split('|').slice(1, -1).map(c => stripBold(c.trim()))
  }
  // 非标准格式：text || text || text 或 |||| content ||||
  const cells = trimmed.split('|').map(c => c.trim()).filter(c => c !== '')
  return cells.map(c => stripBold(c))
}

/** 将Markdown表格内容渲染为HTML */
const renderTableHtml = (content: string): string => {
  const lines = content.split('\n').filter(l => l.trim())
  if (lines.length < 2) return escapeHtml(content)

  const isSeparator = (line: string): boolean => /^\|[\s\-:|]+$/.test(line.trim())

  // 确定最大列数
  let maxCols = 0
  for (const line of lines) {
    if (isSeparator(line)) continue
    const cells = parseTableLine(line)
    if (cells.length > maxCols) maxCols = cells.length
  }
  if (maxCols === 0) return escapeHtml(content)

  let html = '<table class="rendered-md-table">'
  let headerDone = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (isSeparator(line)) {
      html += '</thead>'
      headerDone = true
      continue
    }
    const cells = parseTableLine(line)
    // 补齐列数
    while (cells.length < maxCols) cells.push('')
    if (!headerDone) {
      if (i === 0) html += '<thead>'
      html += '<tr>' + cells.map(c => `<th>${escapeHtml(c)}</th>`).join('') + '</tr>'
    } else {
      if (i === lines.findIndex(l => isSeparator(l)) + 1) html += '<tbody>'
      html += '<tr>' + cells.map(c => `<td>${escapeHtml(c)}</td>`).join('') + '</tr>'
    }
  }

  if (!headerDone) html += '</thead>'
  html += '</tbody></table>'
  return html
}

const escapeHtml = (text: string): string => {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ===== 生命周期 =====
onMounted(async () => {
  await fetchCategoryInfo()
  await fetchDocuments()
  startPolling()
})

onBeforeUnmount(() => { stopPolling(); stopTaskPolling() })
</script>

<style scoped>
.kd-page {
  padding: 0;
  animation: page-enter 0.3s ease;
}
@keyframes page-enter {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 面包屑 */
.kd-breadcrumb {
  margin-bottom: var(--space-5);
}
.kd-breadcrumb :deep(.el-breadcrumb__inner) {
  font-weight: 500;
  color: var(--corp-text-tertiary);
  font-size: var(--text-sm);
}
.kd-breadcrumb :deep(.el-breadcrumb__item:last-child .el-breadcrumb__inner) {
  color: var(--corp-text-primary);
  font-weight: 700;
}

/* 头部 */
.kd-header {
  margin-bottom: var(--space-5);
}
.kd-header__title-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.kd-header__title {
  font-size: 17px;
  font-weight: 700;
  margin: 0;
  color: var(--corp-text-primary);
  letter-spacing: -0.3px;
}
.kd-header__desc {
  font-size: var(--text-base);
  color: var(--corp-text-secondary);
  margin: var(--space-1) 0 0;
  line-height: 1.5;
}

/* 统计 */
.kd-stats {
  display: flex;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}

/* 表格卡片 */
.kd-table-card {
  border-radius: var(--radius-lg);
  border: 1px solid var(--corp-border-light);
}
.kd-table-card :deep(.el-card__body) {
  padding: var(--space-6);
}

/* 工具栏 */
.kd-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-5);
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--corp-border-light);
}
.kd-toolbar__left {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.kd-toolbar__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.kd-toolbar__selected {
  font-size: var(--text-sm);
  color: var(--color-primary-700);
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  background: var(--color-primary-50);
  border: 1px solid var(--color-primary-200);
  border-radius: var(--radius-full);
  font-weight: 600;
}

/* 文档名称单元格 */
.doc-name-cell {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.doc-name-cell__icon {
  color: var(--corp-text-tertiary);
  flex-shrink: 0;
  transition: color var(--corp-transition-fast), transform var(--corp-transition-fast);
}
.doc-name-cell:hover .doc-name-cell__icon {
  color: var(--corp-primary);
  transform: scale(1.1);
}
.doc-name-cell__text {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--corp-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  outline: none;
  padding: 2px 4px;
  border-radius: var(--radius-sm);
  transition: all var(--corp-transition-fast);
}
.doc-name-cell__text[contenteditable="true"] {
  outline: 2px solid var(--corp-primary);
  outline-offset: 1px;
  background: var(--color-primary-50);
  border-radius: var(--radius-sm);
}
.doc-name-cell__edit-icon {
  color: var(--corp-text-tertiary);
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--corp-transition-fast), color var(--corp-transition-fast);
  flex-shrink: 0;
}
.doc-name-cell:hover .doc-name-cell__edit-icon {
  opacity: 1;
}
.doc-name-cell__edit-icon:hover {
  color: var(--corp-primary);
}

/* 状态单元格 */
.status-cell {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--text-sm);
  font-weight: 500;
}
.status-cell__icon--success { color: var(--color-success); }
.status-cell__icon--warning { color: var(--color-warning); }
.status-cell__icon--danger { color: var(--color-danger); }
.status-cell__text {
  font-size: var(--text-sm);
}

/* 分页 */
.kd-pagination {
  margin-top: var(--space-5);
  display: flex;
  justify-content: flex-end;
  padding-top: var(--space-4);
  border-top: 1px solid var(--corp-border-light);
}

/* 段落全屏页 */
.para-page {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: var(--bg-body);
  display: flex;
  flex-direction: column;
  animation: page-enter 0.2s ease;
}

.para-page__topbar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-6);
  background: var(--bg-surface);
  border-bottom: 1px solid var(--corp-border-light);
  flex-shrink: 0;
  z-index: 10;
}
.para-page__topbar-title {
  flex: 1;
  min-width: 0;
}
.para-page__doc-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--corp-text-primary);
  letter-spacing: -0.3px;
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.para-page__stats {
  font-size: var(--text-sm);
  color: var(--corp-text-tertiary);
  font-weight: 500;
}
.para-page__badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-success);
  background: var(--color-success-bg);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  margin-left: var(--space-2);
}
.para-page__topbar-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.para-page__body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

/* 左侧导航 */
.para-page__nav {
  width: 220px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--corp-border-light);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.para-page__nav-header {
  padding: var(--space-4) var(--space-4) var(--space-2);
  font-size: 10px;
  font-weight: 700;
  color: var(--corp-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  flex-shrink: 0;
}
.para-page__nav-list {
  padding: 0 var(--space-2);
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.para-page__nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px var(--space-3);
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: var(--corp-text-secondary);
  font-size: var(--text-sm);
  transition: all var(--corp-transition-fast);
  cursor: pointer;
  border-left: 2px solid transparent;
  margin-left: -1px;
}
.para-page__nav-item:hover {
  background: rgba(59, 130, 246, 0.05);
  color: var(--corp-text-primary);
}
.para-page__nav-item.is-active {
  background: var(--color-primary-50);
  color: var(--color-primary-700);
  font-weight: 600;
  border-left-color: var(--corp-primary);
}
.para-page__nav-index {
  font-size: 10px;
  font-weight: 700;
  color: var(--corp-text-tertiary);
  min-width: 26px;
  font-variant-numeric: tabular-nums;
}
.para-page__nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.para-page__nav-tag {
  color: var(--color-warning);
  flex-shrink: 0;
}
.para-page__nav-footer {
  padding: var(--space-3) var(--space-4);
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  border-top: 1px solid var(--corp-border-light);
  flex-shrink: 0;
}

/* 右侧内容 */
.para-page__content {
  flex: 1;
  min-width: 0;
  padding: var(--space-6);
  overflow-y: auto;
}

.para-card {
  background: var(--bg-surface-hover);
  border-radius: var(--radius-md);
  padding: var(--space-4) var(--space-5);
  margin-bottom: var(--space-3);
  border: 1px solid var(--corp-border-light);
  transition: all var(--corp-transition-fast);
  position: relative;
}
.para-card:hover {
  border-color: var(--corp-border);
  background: var(--bg-surface);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}
.para-card.is-editing {
  border-color: var(--corp-primary);
  background: var(--bg-surface);
  box-shadow: 0 0 0 1px var(--corp-primary), 0 2px 8px rgba(59, 130, 246, 0.1);
}

.para-card__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-2);
}
.para-card__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}
.para-card__clause {
  font-size: var(--text-sm);
  color: var(--color-primary-600);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.para-card__clause-tag {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.para-card__actions {
  display: flex;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--corp-transition-fast);
}
.para-card:hover .para-card__actions {
  opacity: 1;
}

.para-card__body {
  font-size: var(--text-base);
  line-height: 1.75;
  color: var(--corp-text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}
.para-card__table-wrap {
  overflow-x: auto;
  margin: var(--space-2) -4px;
  padding: 0 4px;
  border-radius: var(--radius-md);
  border: 1px solid var(--corp-border-light);
}
.para-card__table-wrap :deep(.rendered-md-table) {
  width: 100%;
  min-width: max-content;
  border-collapse: collapse;
  font-size: var(--text-sm);
  line-height: 1.5;
}
.para-card__table-wrap :deep(.rendered-md-table th),
.para-card__table-wrap :deep(.rendered-md-table td) {
  padding: 7px 12px;
  border: 1px solid var(--corp-border-light);
  text-align: left;
  white-space: nowrap;
}
.para-card__table-wrap :deep(.rendered-md-table th) {
  background: linear-gradient(135deg, var(--color-primary-50) 0%, var(--color-primary-100) 100%);
  font-weight: 700;
  color: var(--corp-text-primary);
  font-size: var(--text-xs);
  text-transform: none;
  letter-spacing: 0;
  position: sticky;
  top: 0;
  z-index: 1;
}
.para-card__table-wrap :deep(.rendered-md-table tr:nth-child(even)) {
  background: rgba(0, 0, 0, 0.015);
}
.para-card__table-wrap :deep(.rendered-md-table td) {
  color: var(--corp-text-secondary);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.para-card__table-wrap :deep(.rendered-md-table td:empty)::after {
  content: '—';
  color: var(--corp-text-tertiary);
}

.para-card__edit {
  margin-top: var(--space-2);
}
.para-card__edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.para-card__footer {
  margin-top: var(--space-3);
  padding-top: var(--space-2);
  border-top: 1px solid var(--corp-border-light);
}
.para-card__length {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.para-card__type-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-warning);
  background: var(--color-warning-bg);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  margin-left: var(--space-2);
}

/* 抽屉头部状态标签 */
.drawer-header__badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  margin-left: var(--space-2);
}
.drawer-header__badge--success {
  color: var(--color-success);
  background: var(--color-success-bg);
}

/* 标签单元格 */
.doc-tags-cell {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}
.doc-tags-cell__tag {
  max-width: 120px;
}
.doc-tags-cell__tag :deep(.el-tag__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.doc-tags-cell__add {
  padding: 2px;
  margin-left: 2px;
}

/* 标签弹窗 */
.tag-popover {
  padding: 4px 0;
}
.tag-popover__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}
.tag-popover__item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 12px;
  transition: background 0.15s;
}
.tag-popover__item:hover {
  background: var(--bg-surface-hover);
}
.tag-popover__item.is-active {
  background: var(--color-primary-bg);
}
.tag-popover__item-label {
  color: var(--corp-text-secondary);
  font-weight: 500;
}
.tag-popover__item.is-active .tag-popover__item-label {
  color: var(--color-primary-500);
}
.tag-popover__create {
  display: flex;
  gap: 4px;
  align-items: center;
}

/* 分块配置弹窗 */
.chunk-settings {
  padding: 4px 0;
}
.chunk-settings__title {
  font-size: 13px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin-bottom: 12px;
}
.chunk-settings :deep(.el-form-item) {
  margin-bottom: 12px;
}
.chunk-settings :deep(.el-form-item__label) {
  font-size: 12px;
  color: var(--corp-text-secondary);
}
.chunk-settings__hint {
  font-size: 11px;
  color: var(--corp-text-tertiary);
  margin-left: 8px;
}

/* ===== 检索测试抽屉 ===== */
.hit-test-drawer :deep(.el-drawer__header) {
  margin-bottom: 0;
  padding: 16px 20px;
  border-bottom: 1px solid var(--corp-border-light);
}
.hit-test-drawer :deep(.el-drawer__body) {
  padding: 0;
}
.ht-drawer {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.ht-form {
  padding: 16px 20px;
  border-bottom: 1px solid var(--corp-border-light);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ht-form__query :deep(.el-input__wrapper) {
  border-radius: var(--radius-lg);
}
.ht-form__options {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ht-stats {
  display: flex;
  gap: 6px;
  padding: 10px 20px;
  flex-wrap: wrap;
  border-bottom: 1px solid var(--corp-border-light);
  background: var(--bg-page);
}
.ht-stats__rewrite {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ht-results {
  flex: 1;
  padding: 12px 20px;
}
.ht-empty {
  padding: 40px 0;
}
.ht-result {
  padding: 12px 14px;
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-lg);
  margin-bottom: 8px;
  transition: border-color var(--corp-transition-fast), box-shadow var(--corp-transition-fast);
}
.ht-result:hover {
  border-color: var(--color-primary-300);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}
.ht-result__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.ht-result__rank {
  font-weight: 800;
  font-size: 14px;
  color: var(--color-primary-500);
  min-width: 24px;
}
.ht-result__title {
  flex: 1;
  font-weight: 600;
  font-size: 13px;
  color: var(--corp-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ht-result__scores {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.ht-result__content {
  font-size: 12px;
  color: var(--corp-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.ht-placeholder {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--corp-text-tertiary);
}
.ht-placeholder p {
  font-size: 13px;
  margin: 0;
}

/* 上传进度条 */
.upload-progress-bar {
  margin-bottom: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--bg-surface-hover);
  border-radius: var(--radius-md);
  border: 1px solid var(--corp-border-light);
}
.upload-progress-item {
  margin-bottom: var(--space-2);
}
.upload-progress-item:last-child {
  margin-bottom: 0;
}
.upload-progress-info {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 4px;
  font-size: var(--text-sm);
}
.upload-progress-name {
  font-weight: 600;
  color: var(--corp-text-primary);
}
.upload-progress-msg {
  color: var(--corp-text-tertiary);
  flex: 1;
}

</style>
