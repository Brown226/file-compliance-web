<template>
  <div class="rl-page">
    <!-- 主布局：左侧目录树 + 右侧内容区 -->
    <div class="rl-layout">
      <!-- 左侧分类/目录面板 -->
      <aside class="rl-sidebar" :class="{ 'rl-sidebar--collapsed': sidebarCollapsed }">
        <div class="sidebar-header">
          <h3 v-if="!sidebarCollapsed" class="sidebar-title">规则目录</h3>
          <div class="sidebar-actions">
            <el-button v-if="!sidebarCollapsed" size="small" icon="FolderPlus" @click="showCreateFolderDialog">新建目录</el-button>
            <button class="sidebar-collapse-btn" :title="sidebarCollapsed ? '展开目录' : '收起目录'" @click="sidebarCollapsed = !sidebarCollapsed">
              <el-icon :size="14"><ArrowRight /></el-icon>
            </button>
          </div>
        </div>

        <!-- 目录树 -->
        <div v-if="!sidebarCollapsed" class="folder-section">
          <el-tree
            :data="folderTree"
            :props="treeProps"
            :default-expanded-keys="expandedFolderKeys"
            node-key="id"
            class="folder-tree"
            ref="folderTreeRef"
            @node-click="handleFolderClick"
          >
            <template #default="{ node, data }">
              <span class="tree-node">
                <el-icon v-if="data.children && data.children.length > 0" class="expand-icon">
                  <ArrowRight />
                </el-icon>
                <el-icon v-else size="14"><Files /></el-icon>
                <span class="node-label">{{ data.label }}</span>
                <span v-if="data.count !== undefined" class="tree-count">{{ data.count }}</span>
                <span class="tree-node-actions" @click.stop>
                  <el-button
                    size="small"
                    :icon="Plus"
                    @click="showCreateLibraryUnderFolder(data)"
                    title="在此目录下新建规则库"
                    aria-label="在此目录下新建规则库"
                    class="action-btn-create-lib"
                  />
                  <el-button
                    size="small"
                    :icon="Edit"
                    @click="showEditFolderDialog(data)"
                    title="编辑"
                    aria-label="编辑目录"
                  />
                  <el-button
                    size="small"
                    :icon="Delete"
                    type="danger"
                    @click="handleDeleteFolder(data.id)"
                    title="删除"
                    aria-label="删除目录"
                  />
                </span>
              </span>
            </template>
          </el-tree>
        </div>
      </aside>

      <!-- 右侧主内容区 -->
      <main class="rl-main">
        <!-- 顶部工具栏 -->
        <section class="toolbar">
          <div class="toolbar-left">
            <div class="toolbar-stats">
              <span class="stat-item"><strong>{{ libraries.length }}</strong> 个规则库</span>
              <span class="stat-sep">·</span>
              <span class="stat-item"><strong>{{ publishedCount }}</strong> 已发布</span>
              <span class="stat-sep">·</span>
              <span class="stat-item"><strong>{{ executableCount }}</strong> 条可执行</span>
            </div>
            <div v-if="activeFolderId" class="active-filter-tag">
              <el-tag closable @close="clearFolderFilter" size="small" type="info">
                当前目录: {{ activeFolderLabel }}
              </el-tag>
            </div>
          </div>
          <div class="toolbar-right">
            <el-input
              v-model="searchKeyword"
              placeholder="搜索规则库名称/描述..."
              clearable
              prefix-icon="Search"
              class="search-input"
              @keyup.enter="fetchLibraries"
              @clear="fetchLibraries"
            />
            <el-select v-model="statusFilter" placeholder="状态筛选" clearable class="status-filter" @change="fetchLibraries">
              <el-option label="草稿" value="DRAFT" />
              <el-option label="已发布" value="PUBLISHED" />
              <el-option label="归档" value="ARCHIVED" />
            </el-select>
            <el-button type="primary" @click="showCreateDialog">
              <el-icon><Plus /></el-icon> 新建规则库
            </el-button>
          </div>
        </section>

        <!-- 规则库表格 -->
        <el-card shadow="never" class="rl-card rl-table-card">
          <el-table
            :data="libraries"
            v-loading="loading"
            empty-text="暂无规则库"
            stripe
            row-class-name="rl-table-row"
          >
            <el-table-column prop="name" label="规则库名称" min-width="180">
              <template #default="{ row }">
                <div class="lib-name-cell">
                  <div :class="['status-indicator', getStatusClass(row.status)]"></div>
                  <span class="lib-name">{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="描述" min-width="200" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="cell-muted">{{ row.description || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="sourceFileName" label="源文件" width="150" show-overflow-tooltip>
              <template #default="{ row }">
                <span class="cell-muted">{{ row.sourceFileName || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="规则数" width="90" align="center">
              <template #default="{ row }">
                <span class="cell-num">{{ row._count?.items || 0 }}</span>
              </template>
            </el-table-column>
            <el-table-column label="可执行" width="90" align="center">
              <template #default="{ row }">
                <span class="cell-num cell-num--success">{{ row.enabledExecutableItemCount || 0 }}</span>
              </template>
            </el-table-column>
            <el-table-column label="待结构化" width="90" align="center">
              <template #default="{ row }">
                <span class="cell-num cell-num--warning">{{ row.pendingStructuredItemCount || 0 }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="getStatusTagType(row.status)" size="small" effect="light">
                  {{ getStatusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="showDetail(row)">查看规则</el-button>
                <el-button type="primary" link size="small" @click="showEditDialog(row)">编辑</el-button>
                <el-dropdown trigger="click" @command="(cmd: string) => handleRowCommand(cmd, row)">
                  <el-button type="primary" link size="small">
                    更多<el-icon class="el-icon--right"><ArrowDown /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="ai-parse">
                        <el-icon><UploadFilled /></el-icon> AI 解析
                      </el-dropdown-item>
                      <el-dropdown-item command="publish" :disabled="row.status === 'PUBLISHED' || (row.enabledExecutableItemCount || 0) === 0">
                        <el-icon><CircleCheck /></el-icon> 发布
                        <span v-if="(row.enabledExecutableItemCount || 0) === 0" class="publish-hint">（无可执行规则）</span>
                      </el-dropdown-item>
                      <el-dropdown-item command="draft" :disabled="row.status === 'DRAFT'">
                        <el-icon><Edit /></el-icon> 撤回草稿
                      </el-dropdown-item>
                      <el-dropdown-item command="archive" :disabled="row.status === 'ARCHIVED'">
                        <el-icon><Folder /></el-icon> 归档
                      </el-dropdown-item>
                      <el-dropdown-item command="delete" divided>
                        <span style="color: #f56c6c;"><el-icon><Delete /></el-icon> 删除</span>
                      </el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <!-- 规则详情面板 -->
        <el-card v-if="selectedLibrary" shadow="never" class="rl-card detail-card">
          <template #header>
            <div class="detail-header">
              <div>
                <span>{{ selectedLibrary.name }} — 规则列表（{{ filteredItems.length }} / {{ selectedLibrary.items?.length || 0 }}）</span>
                <div class="detail-stats">
                  <el-tag type="success" size="small">启用且可执行 {{ selectedLibrary.enabledExecutableItemCount || 0 }}</el-tag>
                  <el-tag type="warning" size="small">待结构化 {{ selectedLibrary.pendingStructuredItemCount || 0 }}</el-tag>
                </div>
              </div>
              <div>
                <el-button type="primary" size="small" @click="showAddItemDialog">手动添加</el-button>
                <el-button type="primary" link @click="selectedLibrary = null">关闭</el-button>
              </div>
            </div>
          </template>

          <div class="filters">
            <el-input v-model="itemFilters.keyword" placeholder="搜索规则名/代码/描述" clearable class="filter-input" />
            <el-select v-model="itemFilters.category" placeholder="分类" clearable class="filter-select">
              <el-option v-for="category in categoryOptions" :key="category" :label="category" :value="category" />
            </el-select>
            <el-select v-model="itemFilters.severity" placeholder="严重度" clearable class="filter-select">
              <el-option label="error" value="error" />
              <el-option label="warning" value="warning" />
              <el-option label="info" value="info" />
            </el-select>
            <el-select v-model="itemFilters.enabled" placeholder="启用状态" clearable class="filter-select">
              <el-option label="启用" value="enabled" />
              <el-option label="停用" value="disabled" />
            </el-select>
          </div>

          <el-table :data="filteredItems" empty-text="暂无规则">
            <el-table-column prop="ruleCode" label="规则代码" width="120" />
            <el-table-column prop="ruleName" label="规则名称" min-width="180" />
            <el-table-column prop="category" label="分类" width="120">
              <template #default="{ row }">
                <el-tag v-if="row.category" size="small" type="info">{{ row.category }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="执行类型" width="130">
              <template #default="{ row }">
                <el-tag :type="row.executionType === 'MANUAL' ? 'info' : 'success'" size="small">
                  {{ row.executionType || 'BUILTIN_PREFIX' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="内置前缀" width="110">
              <template #default="{ row }">
                <span>{{ row.builtinPrefix || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column prop="severity" label="严重度" width="90">
              <template #default="{ row }">
                <el-tag :type="row.severity === 'error' ? 'danger' : row.severity === 'warning' ? 'warning' : 'info'" size="small">
                  {{ row.severity }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="描述" min-width="250" show-overflow-tooltip />
            <el-table-column prop="enabled" label="启用" width="70" align="center">
              <template #default="{ row }">
                <el-switch v-model="row.enabled" size="small" @change="toggleItem(row)" />
              </template>
            </el-table-column>
            <el-table-column label="操作" width="120" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="showEditItemDialog(row)">编辑</el-button>
                <el-popconfirm title="确认删除？" @confirm="handleDeleteItem(row.id)">
                  <template #reference>
                    <el-button type="danger" link size="small">删除</el-button>
                  </template>
                </el-popconfirm>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </main>
    </div>

    <!-- 新建/编辑规则库对话框 -->
    <el-dialog v-model="dialogVisible" :title="isEdit ? '编辑规则库' : '新建规则库'" width="480px">
      <el-form :model="formData" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="formData.name" placeholder="如：GB 50265 规则库" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="formData.description" type="textarea" :rows="3" placeholder="规则库用途说明" />
        </el-form-item>
        <el-form-item label="所属目录">
          <el-tree-select
            :data="folderTreeData"
            :props="treeProps"
            v-model="formData.folderId"
            placeholder="选择目录（可选）"
            clearable
            check-strictly
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>

    <!-- 新建目录对话框 -->
    <el-dialog v-model="folderDialogVisible" title="新建目录" width="400px">
      <el-form :model="folderForm" label-width="60px">
        <el-form-item label="名称" required>
          <el-input v-model="folderForm.name" placeholder="目录名称" />
        </el-form-item>
        <el-form-item label="上级目录">
          <el-tree-select
            :data="folderTree"
            :props="treeProps"
            v-model="folderForm.parentId"
            placeholder="选择上级目录"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="folderDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveFolder" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>

    <!-- 编辑目录对话框 -->
    <el-dialog v-model="editFolderDialogVisible" title="编辑目录" width="400px">
      <el-form :model="editFolderForm" label-width="60px">
        <el-form-item label="名称" required>
          <el-input v-model="editFolderForm.name" placeholder="目录名称" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editFolderDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleEditFolder" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>

    <!-- 移动目录对话框 -->
    <el-dialog v-model="moveFolderDialogVisible" title="移动目录" width="400px">
      <div class="dialog-tip">
        <el-icon><ArrowRight /></el-icon>
        <span>将选中的 {{ selectedFolders.length }} 个目录移动到目标位置</span>
      </div>
      <el-form :model="moveFolderForm" label-width="80px">
        <el-form-item label="目标目录" required>
          <el-tree-select
            :data="folderTree"
            :props="treeProps"
            v-model="moveFolderForm.targetId"
            placeholder="选择目标目录"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="moveFolderDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleMoveFolder" :loading="submitting">确定移动</el-button>
      </template>
    </el-dialog>

    <!-- 合并目录对话框 -->
    <el-dialog v-model="mergeFolderDialogVisible" title="合并目录" width="400px">
      <div class="dialog-tip">
        <el-icon><Grid /></el-icon>
        <span>将选中的 {{ selectedFolders.length }} 个目录合并为一个新目录</span>
      </div>
      <el-form :model="mergeFolderForm" label-width="80px">
        <el-form-item label="新目录名称" required>
          <el-input v-model="mergeFolderForm.name" placeholder="合并后的目录名称" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="mergeFolderDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleMergeFolder" :loading="submitting">确定合并</el-button>
      </template>
    </el-dialog>

    <!-- AI解析对话框 -->
    <el-dialog v-model="parseDialogVisible" :title="`AI 解析规则 — ${parseTarget?.name || ''}`" width="560px">
      <p class="helper-text">上传规范文档后先生成候选规则，确认后再导入当前规则库。</p>

      <!-- 解析中的局部加载状态 -->
      <div v-if="isParsing" class="parse-loading-state">
        <el-icon class="is-loading" :size="32"><Loading /></el-icon>
        <div class="parse-loading-text">
          <strong>正在解析文件...</strong>
          <span v-if="parseFile">{{ parseFile.name }} ({{ (parseFile.size / (1024 * 1024)).toFixed(1) }}MB)</span>
        </div>
        <div class="parse-loading-hint">请耐心等待，大文件可能需要较长时间</div>
      </div>

      <!-- 文件上传区域（非解析状态时显示） -->
      <template v-else>
        <el-upload
          drag
          :auto-upload="false"
          :limit="1"
          accept=".docx,.doc,.pdf,.xlsx,.xls,.txt,.md"
          :on-change="handleParseFileChange"
        >
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖拽文件到此处，或 <em>点击选择</em></div>
        </el-upload>
      </template>

      <template #footer>
        <el-button @click="parseDialogVisible = false">取消</el-button>
        <el-button
          type="primary"
          @click="handleParsePreview"
          :loading="parsing"
          :disabled="isParsing"
        >
          {{ isParsing ? '解析中...' : '生成候选规则' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 候选规则预览对话框 -->
    <el-dialog v-model="previewDialogVisible" title="候选规则预览" width="960px">
      <div class="preview-toolbar">
        <el-radio-group v-model="importMode" size="small">
          <el-radio-button label="merge">合并导入</el-radio-button>
          <el-radio-button label="replace">覆盖导入</el-radio-button>
        </el-radio-group>
        <div class="preview-meta">候选 {{ previewItems.length }} 条</div>
      </div>
      <el-table :data="previewItems" max-height="420">
        <el-table-column prop="ruleCode" label="规则代码" width="120" />
        <el-table-column prop="ruleName" label="规则名称" min-width="180" />
        <el-table-column prop="category" label="分类" width="120" />
        <el-table-column prop="executionType" label="执行类型" width="140" />
        <el-table-column prop="builtinPrefix" label="前缀" width="100" />
        <el-table-column prop="severity" label="严重度" width="90" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.duplicate" type="warning" size="small">重复</el-tag>
            <el-tag v-if="!row.executable" type="info" size="small">人工项</el-tag>
            <el-tag v-if="row.executable && !row.duplicate" type="success" size="small">可执行</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
      </el-table>
      <template #footer>
        <el-button @click="previewDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleImportPreview" :loading="importing">确认导入</el-button>
      </template>
    </el-dialog>

    <!-- 编辑规则对话框 -->
    <el-dialog v-model="itemDialogVisible" :title="itemDialogMode === 'edit' ? '编辑规则' : '手动添加规则'" width="620px">
      <el-form :model="itemForm" label-width="100px">
        <el-form-item label="规则代码">
          <el-input v-model="itemForm.ruleCode" placeholder="如 NAME_001" />
        </el-form-item>
        <el-form-item label="规则名称" required>
          <el-input v-model="itemForm.ruleName" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="itemForm.category">
            <el-option v-for="cat in categories" :key="cat.id" :label="cat.name" :value="cat.name" />
            <el-option label="自定义" value="" />
          </el-select>
        </el-form-item>
        <el-form-item label="执行类型">
          <el-select v-model="itemForm.executionType">
            <el-option label="BUILTIN_PREFIX" value="BUILTIN_PREFIX" />
            <el-option label="REGEX" value="REGEX" />
            <el-option label="KEYWORD_REQUIRED" value="KEYWORD_REQUIRED" />
            <el-option label="KEYWORD_FORBIDDEN" value="KEYWORD_FORBIDDEN" />
            <el-option label="MANUAL" value="MANUAL" />
          </el-select>
        </el-form-item>
        <el-form-item label="内置前缀">
          <el-input v-model="itemForm.builtinPrefix" placeholder="NAME / FORMAT / DWG" />
        </el-form-item>
        <el-form-item label="目标范围">
          <el-select v-model="itemForm.targetScope">
            <el-option label="TEXT" value="TEXT" />
            <el-option label="FILE_NAME" value="FILE_NAME" />
            <el-option label="HEADER" value="HEADER" />
            <el-option label="TABLE" value="TABLE" />
            <el-option label="DWG" value="DWG" />
          </el-select>
        </el-form-item>
        <el-form-item label="严重度">
          <el-select v-model="itemForm.severity">
            <el-option label="error" value="error" />
            <el-option label="warning" value="warning" />
            <el-option label="info" value="info" />
          </el-select>
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="itemForm.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="检查方法">
          <el-input v-model="itemForm.checkMethod" type="textarea" :rows="3" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="itemDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveItem" :loading="submitting">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import {
  Plus, UploadFilled, Folder, FolderOpened, ArrowRight,
  CircleCheck, Edit, Delete, ArrowDown, ArrowUp, Files, Loading
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox, ElTree } from 'element-plus'
import {
  getRuleLibrariesApi,
  getRuleLibraryApi,
  createRuleLibraryApi,
  updateRuleLibraryApi,
  deleteRuleLibraryApi,
  parseRulesPreviewApi,
  importRulePreviewItemsApi,
  addRuleItemApi,
  updateRuleItemApi,
  deleteRuleItemApi,
  type RuleLibrary,
  type RuleLibraryItem,
  type RuleLibraryPreviewItem,
} from '@/api/rule-library'
import {
  getRuleFoldersApi,
  createRuleFolderApi,
  updateRuleFolderApi,
  deleteRuleFolderApi,
  moveRuleFoldersApi,
  mergeRuleFoldersApi,
  type RuleFolderTreeNode,
} from '@/api/rule-folder'

// 加载状态
const loading = ref(false)
const submitting = ref(false)
const parsing = ref(false)
const importing = ref(false)
const sidebarCollapsed = ref(false)

// 数据
const libraries = ref<RuleLibrary[]>([])
const selectedLibrary = ref<RuleLibrary | null>(null)

// 目录树
const folderTreeRef = ref<InstanceType<typeof ElTree> | null>(null)
const folderTree = ref<RuleFolderTreeNode[]>([])
const folderTreeData = ref<RuleFolderTreeNode[]>([]) // for tree-select (flat compatible)
const expandedFolderKeys = ref<string[]>([])
const checkedFolderKeys = ref<string[]>([])
const treeProps = {
  children: 'children',
  label: 'label',
}

// 选中的目录（用于联动过滤）
const activeFolderId = ref<string | null>(null)
const activeFolderLabel = ref<string>('')

// 搜索与筛选
const searchKeyword = ref('')
const statusFilter = ref<string>('')

// 选中的目录（用于批量移动/合并）
const selectedFolders = computed(() => checkedFolderKeys.value)

// 编辑目录对话框
const editFolderDialogVisible = ref(false)
const editingFolder = ref<any>(null)
const editFolderForm = reactive({ name: '' })

// 移动目录对话框
const moveFolderDialogVisible = ref(false)
const moveFolderForm = reactive({ targetId: '' })

// 合并目录对话框
const mergeFolderDialogVisible = ref(false)
const mergeFolderForm = reactive({ name: '' })

// 对话框状态
const dialogVisible = ref(false)
const isEdit = ref(false)
const editId = ref('')
const formData = reactive({ name: '', description: '', folderId: '' as string | null })

const folderDialogVisible = ref(false)
const folderForm = reactive({ name: '', parentId: '' })

const parseDialogVisible = ref(false)
const previewDialogVisible = ref(false)
const parseTarget = ref<RuleLibrary | null>(null)
const parseFile = ref<File | null>(null)
const previewItems = ref<RuleLibraryPreviewItem[]>([])
const previewSourceFileName = ref('')
const importMode = ref<'merge' | 'replace'>('merge')
const isParsing = ref(false) // 新增：解析中的状态标记

const itemDialogVisible = ref(false)
const itemDialogMode = ref<'create' | 'edit'>('create')
const editingItemId = ref('')
const itemForm = reactive({
  ruleCode: '',
  ruleName: '',
  category: '',
  description: '',
  checkMethod: '',
  severity: 'warning',
  executionType: 'BUILTIN_PREFIX',
  builtinPrefix: '',
  targetScope: 'TEXT',
})

const itemFilters = reactive({
  keyword: '',
  category: '',
  severity: '',
  enabled: '',
})

// 计算属性
const categoryOptions = computed(() => {
  const values = new Set<string>()
  ;(selectedLibrary.value?.items || []).forEach((item) => {
    if (item.category) values.add(item.category)
  })
  return Array.from(values)
})

const publishedCount = computed(() => libraries.value.filter(item => item.status === 'PUBLISHED').length)
const executableCount = computed(() => libraries.value.reduce((sum, item) => sum + (item.enabledExecutableItemCount || 0), 0))

const filteredItems = computed(() => {
  let items = selectedLibrary.value?.items || []
  if (itemFilters.keyword.trim()) {
    const keyword = itemFilters.keyword.trim().toLowerCase()
    items = items.filter(item =>
      [item.ruleCode, item.ruleName, item.description].some(v => (v || '').toLowerCase().includes(keyword)),
    )
  }
  if (itemFilters.category) items = items.filter(item => item.category === itemFilters.category)
  if (itemFilters.severity) items = items.filter(item => item.severity === itemFilters.severity)
  if (itemFilters.enabled === 'enabled') items = items.filter(item => item.enabled)
  if (itemFilters.enabled === 'disabled') items = items.filter(item => !item.enabled)
  return items
})

// 获取状态相关方法
const getStatusClass = (status: string) => {
  const map: Record<string, string> = {
    DRAFT: 'status-draft',
    PUBLISHED: 'status-published',
    ARCHIVED: 'status-archived',
  }
  return map[status] || 'status-draft'
}

const getStatusTagType = (status: string): 'warning' | 'success' | 'info' | 'danger' | 'primary' => {
  const map: Record<string, 'warning' | 'success' | 'info'> = {
    DRAFT: 'warning',
    PUBLISHED: 'success',
    ARCHIVED: 'info',
  }
  return map[status] || 'warning'
}

const getStatusLabel = (status: string) => {
  const map: Record<string, string> = {
    DRAFT: '草稿',
    PUBLISHED: '已发布',
    ARCHIVED: '归档',
  }
  return map[status] || status
}

// 获取目录树
const fetchFolders = async () => {
  try {
    const { data } = await getRuleFoldersApi()
    folderTree.value = data || []
    // For tree-select, clone and add a virtual root
    folderTreeData.value = data?.length ? data : []
    // Auto-expand first level
    expandedFolderKeys.value = (data || []).map((f: RuleFolderTreeNode) => f.id)
  } catch (e: any) {
    console.error('获取目录树失败:', e)
  }
}

const handleFolderClick = (data: any) => {
  if (activeFolderId.value === data.id) {
    // 再次点击取消选择
    clearFolderFilter()
  } else {
    activeFolderId.value = data.id
    activeFolderLabel.value = data.label
    fetchLibraries()
  }
}

const clearFolderFilter = () => {
  activeFolderId.value = null
  activeFolderLabel.value = ''
  if (folderTreeRef.value) {
    folderTreeRef.value.setCurrentKey(null)
  }
  fetchLibraries()
}

const handleFolderCheck = (_data: any, _checked: boolean) => {
  // checkbox 选中状态通过 checkedFolderKeys 自动同步
}

  // 编辑目录
  const showEditFolderDialog = (data: any) => {
    editingFolder.value = data
    editFolderForm.name = data.label
    editFolderDialogVisible.value = true
  }

  const handleEditFolder = async () => {
    if (!editFolderForm.name.trim()) {
      ElMessage.warning('请输入目录名称')
      return
    }
    if (!editingFolder.value?.id) return
    submitting.value = true
    try {
      await updateRuleFolderApi(editingFolder.value.id, { name: editFolderForm.name.trim() })
      ElMessage.success('目录名称更新成功')
      editFolderDialogVisible.value = false
      await fetchFolders()
    } catch (e: any) {
      ElMessage.error(e?.response?.data?.message || '更新失败')
    } finally {
      submitting.value = false
    }
  }

  // 删除目录
  const handleDeleteFolder = (folderId: string) => {
    ElMessageBox.confirm(
      '确认删除此目录？目录下的子目录将移到上级，关联的规则库将解除目录绑定。',
      '删除目录',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
      }
    ).then(async () => {
      try {
        await deleteRuleFolderApi(folderId)
        checkedFolderKeys.value = checkedFolderKeys.value.filter(id => id !== folderId)
        ElMessage.success('删除成功')
        await fetchFolders()
        await fetchLibraries()
      } catch (e: any) {
        ElMessage.error(e?.response?.data?.message || '删除失败')
      }
    }).catch(() => {})
  }

  // 移动目录对话框
  const showMoveFolderDialog = () => {
    moveFolderForm.targetId = ''
    moveFolderDialogVisible.value = true
  }

  const handleMoveFolder = async () => {
    if (!moveFolderForm.targetId) {
      ElMessage.warning('请选择目标目录')
      return
    }
    if (selectedFolders.value.length === 0) {
      ElMessage.warning('请勾选要移动的目录')
      return
    }
    submitting.value = true
    try {
      await moveRuleFoldersApi(selectedFolders.value, moveFolderForm.targetId)
      ElMessage.success('移动成功')
      moveFolderDialogVisible.value = false
      checkedFolderKeys.value = []
      await fetchFolders()
    } catch (e: any) {
      ElMessage.error(e?.response?.data?.message || '移动失败')
    } finally {
      submitting.value = false
    }
  }

  // 合并目录对话框
  const showMergeFolderDialog = () => {
    mergeFolderForm.name = ''
    mergeFolderDialogVisible.value = true
  }

  const handleMergeFolder = async () => {
    if (!mergeFolderForm.name.trim()) {
      ElMessage.warning('请输入合并后的目录名称')
      return
    }
    if (selectedFolders.value.length < 2) {
      ElMessage.warning('至少勾选 2 个目录进行合并')
      return
    }
    submitting.value = true
    try {
      await mergeRuleFoldersApi(selectedFolders.value, mergeFolderForm.name.trim())
      ElMessage.success('合并成功')
      mergeFolderDialogVisible.value = false
      checkedFolderKeys.value = []
      await fetchFolders()
      await fetchLibraries()
    } catch (e: any) {
      ElMessage.error(e?.response?.data?.message || '合并失败')
    } finally {
      submitting.value = false
    }
  }

const resetLibraryForm = () => {
  formData.name = ''
  formData.description = ''
  formData.folderId = null
}

const resetItemForm = () => {
  editingItemId.value = ''
  itemForm.ruleCode = ''
  itemForm.ruleName = ''
  itemForm.category = ''
  itemForm.description = ''
  itemForm.checkMethod = ''
  itemForm.severity = 'warning'
  itemForm.executionType = 'BUILTIN_PREFIX'
  itemForm.builtinPrefix = ''
  itemForm.targetScope = 'TEXT'
}

const fetchLibraries = async () => {
  loading.value = true
  try {
    const params: Record<string, any> = {}
    if (activeFolderId.value) params.folderId = activeFolderId.value
    if (searchKeyword.value.trim()) params.keyword = searchKeyword.value.trim()
    if (statusFilter.value) params.status = statusFilter.value
    const { data } = await getRuleLibrariesApi(params)
    libraries.value = data || []
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '获取规则库列表失败')
  } finally {
    loading.value = false
  }
}

const refreshSelectedLibrary = async () => {
  if (!selectedLibrary.value?.id) return
  const { data } = await getRuleLibraryApi(selectedLibrary.value.id)
  selectedLibrary.value = data
}

const showCreateDialog = () => {
  console.debug('[RuleLibraries] showCreateDialog called')
  isEdit.value = false
  resetLibraryForm()
  dialogVisible.value = true
  console.debug('[RuleLibraries] dialogVisible set to:', dialogVisible.value)
}

const showCreateLibraryUnderFolder = (folderData: any) => {
  isEdit.value = false
  resetLibraryForm()
  formData.folderId = folderData.id
  dialogVisible.value = true
  ElMessage.info(`将在目录 "${folderData.label}" 下创建规则库`)
}

const showEditDialog = (row: RuleLibrary) => {
  isEdit.value = true
  editId.value = row.id
  formData.name = row.name
  formData.description = row.description || ''
  formData.folderId = (row as any).folderId || null
  dialogVisible.value = true
}

const handleSubmit = async () => {
  if (!formData.name.trim()) {
    ElMessage.warning('请输入名称')
    return
  }
  submitting.value = true
  try {
    if (isEdit.value) {
      await updateRuleLibraryApi(editId.value, {
        name: formData.name.trim(),
        description: formData.description || '',
        folderId: formData.folderId || null,
      })
    } else {
      await createRuleLibraryApi({
        name: formData.name.trim(),
        description: formData.description || '',
        folderId: formData.folderId || null,
      })
    }
    ElMessage.success(isEdit.value ? '更新成功' : '创建成功')
    dialogVisible.value = false
    await fetchLibraries()
    await fetchFolders()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

const handleDelete = async (id: string) => {
  try {
    await deleteRuleLibraryApi(id)
    ElMessage.success('删除成功')
    if (selectedLibrary.value?.id === id) selectedLibrary.value = null
    await fetchLibraries()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '删除失败')
  }
}

const changeStatus = async (row: RuleLibrary, status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED') => {
  try {
    await updateRuleLibraryApi(row.id, { status })
    ElMessage.success('状态更新成功')
    await fetchLibraries()
    if (selectedLibrary.value?.id === row.id) await refreshSelectedLibrary()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '状态更新失败')
  }
}

const handleRowCommand = (cmd: string, row: RuleLibrary) => {
  switch (cmd) {
    case 'ai-parse':
      showUploadRules(row)
      break
    case 'publish':
      changeStatus(row, 'PUBLISHED')
      break
    case 'draft':
      changeStatus(row, 'DRAFT')
      break
    case 'archive':
      changeStatus(row, 'ARCHIVED')
      break
    case 'delete':
      ElMessageBox.confirm('确认删除此规则库？', '删除', { type: 'warning' })
        .then(() => handleDelete(row.id))
        .catch(() => {})
      break
  }
}

const showDetail = async (row: RuleLibrary) => {
  try {
    const { data } = await getRuleLibraryApi(row.id)
    selectedLibrary.value = data
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '获取详情失败')
  }
}

const showUploadRules = (row: RuleLibrary) => {
  parseTarget.value = row
  parseFile.value = null
  previewItems.value = []
  previewSourceFileName.value = ''
  parseDialogVisible.value = true
}

const handleParseFileChange = (file: any) => {
  parseFile.value = file.raw
}

const handleParsePreview = async () => {
  if (!parseTarget.value?.id || !parseFile.value) {
    ElMessage.warning('请选择文件')
    return
  }

  // 文件大小检查（前端预检）
  const fileSizeMB = parseFile.value.size / (1024 * 1024)
  if (fileSizeMB > 50) {
    ElMessage.error('文件大小超过50MB限制，请选择更小的文件')
    return
  }

  parsing.value = true
  isParsing.value = true // 标记解析中状态

  try {
    const fd = new FormData()
    fd.append('file', parseFile.value)
    const { data } = await parseRulesPreviewApi(parseTarget.value.id, fd)

    previewItems.value = data?.items || []
    previewSourceFileName.value = data?.sourceFileName || parseFile.value.name

    if (previewItems.value.length === 0) {
      ElMessage.warning('未解析出任何规则，请检查文件内容是否完整')
    } else {
      ElMessage.success(`成功解析 ${previewItems.value.length} 条候选规则`)
    }

    parseDialogVisible.value = false
    previewDialogVisible.value = true
  } catch (e: any) {
    // 区分不同类型的错误
    if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
      ElMessage.error('文件解析超时，可能是文件过大或服务器繁忙，请稍后重试')
    } else if (e?.message === 'canceled') {
      ElMessage.info('请求已取消')
    } else {
      const errorMsg = e?.response?.data?.message || e?.message || '解析预览失败'

      // 针对常见错误提供更友好的提示
      if (errorMsg.includes('文件大小') || errorMsg.includes('file size')) {
        ElMessage.error('文件过大，请压缩后重试（最大支持50MB）')
      } else if (errorMsg.includes('解析失败') || errorMsg.includes('parse')) {
        ElMessage.error('文件解析失败，请检查文件格式是否支持（支持PDF/DOCX/TXT/MD等）')
      } else {
        ElMessage.error(errorMsg)
      }
    }
  } finally {
    parsing.value = false
    isParsing.value = false // 解析完成
  }
}

const handleImportPreview = async () => {
  if (!parseTarget.value?.id) return
  importing.value = true
  try {
    const { data } = await importRulePreviewItemsApi(parseTarget.value.id, {
      items: previewItems.value,
      mode: importMode.value,
      sourceFileName: previewSourceFileName.value,
    })
    ElMessage.success(`导入成功，共 ${data?.count || 0} 条`)
    previewDialogVisible.value = false
    await fetchLibraries()
    if (selectedLibrary.value?.id === parseTarget.value.id) await refreshSelectedLibrary()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '导入失败')
  } finally {
    importing.value = false
  }
}

const showAddItemDialog = () => {
  itemDialogMode.value = 'create'
  resetItemForm()
  itemDialogVisible.value = true
}

const showEditItemDialog = (row: RuleLibraryItem) => {
  itemDialogMode.value = 'edit'
  editingItemId.value = row.id
  itemForm.ruleCode = row.ruleCode || ''
  itemForm.ruleName = row.ruleName || ''
  itemForm.category = row.category || ''
  itemForm.description = row.description || ''
  itemForm.checkMethod = row.checkMethod || ''
  itemForm.severity = row.severity || 'warning'
  itemForm.executionType = row.executionType || 'BUILTIN_PREFIX'
  itemForm.builtinPrefix = row.builtinPrefix || ''
  itemForm.targetScope = row.targetScope || 'TEXT'
  itemDialogVisible.value = true
}

const handleSaveItem = async () => {
  if (!selectedLibrary.value?.id || !itemForm.ruleName.trim()) {
    ElMessage.warning('请输入规则名称')
    return
  }
  submitting.value = true
  try {
    const payload = {
      ruleCode: itemForm.ruleCode || undefined,
      ruleName: itemForm.ruleName.trim(),
      category: itemForm.category || undefined,
      description: itemForm.description || undefined,
      checkMethod: itemForm.checkMethod || undefined,
      severity: itemForm.severity,
      executionType: itemForm.executionType as any,
      builtinPrefix: itemForm.builtinPrefix || undefined,
      targetScope: itemForm.targetScope as any,
    }
    if (itemDialogMode.value === 'edit' && editingItemId.value) {
      await updateRuleItemApi(selectedLibrary.value.id, editingItemId.value, payload)
    } else {
      await addRuleItemApi(selectedLibrary.value.id, payload)
    }
    ElMessage.success(itemDialogMode.value === 'edit' ? '更新成功' : '添加成功')
    itemDialogVisible.value = false
    await refreshSelectedLibrary()
    await fetchLibraries()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '保存失败')
  } finally {
    submitting.value = false
  }
}

const toggleItem = async (row: RuleLibraryItem) => {
  if (!selectedLibrary.value?.id) return
  try {
    await updateRuleItemApi(selectedLibrary.value.id, row.id, { enabled: row.enabled })
    await fetchLibraries()
  } catch (e: any) {
    row.enabled = !row.enabled
    ElMessage.error(e?.response?.data?.message || '更新失败')
  }
}

const handleDeleteItem = async (itemId: string) => {
  if (!selectedLibrary.value?.id) return
  try {
    await deleteRuleItemApi(selectedLibrary.value.id, itemId)
    ElMessage.success('删除成功')
    await refreshSelectedLibrary()
    await fetchLibraries()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '删除失败')
  }
}

const showCreateFolderDialog = () => {
  folderForm.name = ''
  folderForm.parentId = ''
  folderDialogVisible.value = true
}

const handleSaveFolder = async () => {
  if (!folderForm.name.trim()) {
    ElMessage.warning('请输入目录名称')
    return
  }
  submitting.value = true
  try {
    await createRuleFolderApi({
      name: folderForm.name.trim(),
      parentId: folderForm.parentId || null,
    })
    ElMessage.success('目录创建成功')
    folderDialogVisible.value = false
    await fetchFolders()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '创建失败')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  fetchLibraries()
  fetchFolders()
})
</script>

<style scoped>
.rl-page {
  padding: 0;
  min-height: 100vh;
  background: var(--bg-body);
}

.rl-layout {
  display: flex;
  gap: var(--space-8);
  padding: var(--space-8);
  width: 100%;
}

/* 左侧边栏 */
.rl-sidebar {
  width: 260px;
  flex-shrink: 0;
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  border: 1px solid var(--corp-border-light);
  box-shadow: var(--shadow-card);
  transition: width 0.25s ease, padding 0.25s ease, opacity 0.2s ease;
  overflow: hidden;
}

.rl-sidebar--collapsed {
  width: 48px;
  padding: var(--space-4) var(--space-3);
}

.sidebar-collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--corp-border-light);
  border-radius: var(--radius-md);
  background: var(--bg-surface);
  cursor: pointer;
  color: var(--corp-text-secondary);
  transition: all 0.15s;
  flex-shrink: 0;
}
.sidebar-collapse-btn:hover {
  border-color: var(--corp-primary);
  color: var(--corp-primary);
  background: var(--color-primary-50);
}
.rl-sidebar--collapsed .sidebar-collapse-btn .el-icon {
  transform: rotate(180deg);
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-5);
  border-bottom: 1px solid var(--corp-border-light);
}

.sidebar-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--corp-text-primary);
  margin: 0;
}

.sidebar-actions {
  display: flex;
  gap: 8px;
}

.folder-section {
  margin-bottom: var(--space-6);
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.folder-tree {
  font-size: var(--text-base);
  max-height: calc(100vh - 300px);
  min-height: 380px;
  overflow-y: auto;
  color: var(--corp-text-primary);
}

.folder-tree :deep(.el-tree-node__content) {
  height: auto;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
}

.folder-tree :deep(.el-tree-node:hover > .el-tree-node__content) {
  background: var(--bg-surface-hover);
}

.folder-tree :deep(.el-tree-node.is-selected > .el-tree-node__content) {
  background: var(--corp-primary-lighter);
}

.folder-tree :deep(.el-checkbox__inner) {
  border-radius: 4px;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) 0;
  width: 100%;
}

.expand-icon {
  font-size: var(--text-xs);
  color: var(--corp-text-secondary);
}

.node-label {
  flex: 1;
  color: var(--corp-text-primary);
  font-size: var(--text-sm);
  font-weight: 500;
}

.tree-count {
  font-size: var(--text-xs);
  color: var(--corp-text-secondary);
  background: var(--bg-surface-hover);
  padding: 2px var(--space-2);
  border-radius: var(--radius-full);
}

.tree-node-actions {
  display: flex;
  gap: var(--space-1);
  opacity: 0;
  transition: opacity var(--corp-transition-base);
}

.tree-node:hover .tree-node-actions {
  opacity: 1;
}

.action-btn-create-lib {
  color: var(--corp-success) !important;
  background: var(--corp-success-light) !important;
}

.action-btn-create-lib:hover {
  color: var(--corp-success) !important;
  background: rgba(16, 185, 129, 0.2) !important;
}

.tree-node-actions :deep(.el-button) {
  padding: var(--space-1);
  min-width: auto;
}

.dialog-tip {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5);
  margin-bottom: var(--space-5);
  background: var(--corp-info-light);
  border-radius: var(--radius-lg);
  font-size: var(--text-base);
  color: var(--corp-info-text);
}

.dialog-tip :deep(.el-icon) {
  font-size: 16px;
}

/* 右侧主内容 */
.rl-main {
  flex: 1;
  min-width: 0;
}

/* 工具栏 */
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-4) var(--space-6);
  margin-bottom: var(--space-5);
  background: var(--bg-surface);
  border-radius: var(--radius-lg);
  border: 1px solid var(--corp-border-light);
  gap: var(--space-5);
  flex-wrap: wrap;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}

.toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.search-input {
  width: 240px;
}

.status-filter {
  width: 120px;
}

.active-filter-tag {
  display: flex;
  align-items: center;
}

.publish-hint {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  margin-left: var(--space-1);
}

.toolbar-stats {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  background: #f5f7fa;
  padding: 5px 14px;
  border-radius: 20px;
  border: 1px solid #ebeef5;
}

.toolbar-stats .stat-item strong {
  color: var(--corp-text-primary);
  font-weight: 700;
}

.stat-sep {
  color: #dcdfe6;
}

/* 卡片样式 */
.rl-card {
  border-radius: var(--radius-xl);
  border: 1px solid var(--corp-border-light);
  overflow: hidden;
  box-shadow: var(--shadow-surface);
  transition: all var(--corp-transition-base);
}

.rl-card:hover {
  box-shadow: var(--shadow-card);
}

.rl-table-card :deep(.el-card__body),
.detail-card :deep(.el-card__body) {
  padding: var(--space-6);
}

.rl-table-card :deep(.el-table th.el-table__cell) {
  background: var(--bg-elevated);
  color: var(--corp-text-secondary);
  font-weight: 600;
  font-size: var(--text-sm);
  border-bottom: 2px solid var(--corp-border-light);
}

.rl-table-card :deep(.el-table th.el-table__cell):first-child {
  border-radius: var(--radius-lg) 0 0 0;
}

.rl-table-card :deep(.el-table th.el-table__cell):last-child {
  border-radius: 0 var(--radius-lg) 0 0;
}

.rl-table-card :deep(.el-table--striped .el-table__body tr.el-table__row--striped td.el-table__cell) {
  background: #fafbfc;
}

.rl-table-card :deep(.el-table tr:hover > td.el-table__cell),
.detail-card :deep(.el-table tr:hover > td.el-table__cell) {
  background: #f0f5ff !important;
}

.rl-table-card :deep(.el-table__row) {
  transition: all var(--corp-transition-fast);
}

.rl-table-card :deep(.el-table__body tr:last-child td.el-table__cell):first-child {
  border-radius: 0 0 0 var(--radius-lg);
}

.rl-table-card :deep(.el-table__body tr:last-child td.el-table__cell):last-child {
  border-radius: 0 0 var(--radius-lg) 0;
}

.detail-card {
  margin-top: var(--space-6);
}

.lib-name-cell {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.cell-muted {
  color: var(--corp-text-tertiary);
  font-size: var(--text-sm);
}

.cell-num {
  font-weight: 700;
  font-size: var(--text-sm);
  color: var(--corp-text-primary);
}
.cell-num--success { color: #10b981; }
.cell-num--warning { color: #f59e0b; }

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: var(--radius-full);
  flex-shrink: 0;
}

.status-indicator.status-draft {
  background: var(--corp-warning);
}

.status-indicator.status-published {
  background: var(--corp-success);
}

.status-indicator.status-archived {
  background: var(--color-primary-500);
}

.lib-name {
  font-weight: 600;
  color: var(--corp-text-primary);
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
}

.detail-stats {
  display: flex;
  gap: var(--space-2);
  margin-top: var(--space-2);
}

.filters {
  display: flex;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
  border: 1px solid var(--corp-border-light);
  flex-wrap: wrap;
}

.filter-input {
  width: 260px;
}

.filter-select {
  width: 140px;
}

.helper-text {
  font-size: var(--text-base);
  color: var(--corp-text-secondary);
  margin-bottom: var(--space-5);
}

.preview-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-5);
}

.preview-meta {
  font-size: var(--text-base);
  color: var(--corp-text-secondary);
}

/* 解析中的局部加载状态 */
.parse-loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-10) var(--space-6);
  gap: var(--space-4);
  background: var(--bg-elevated);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--corp-border-light);
}

.parse-loading-state .el-icon {
  color: var(--corp-primary);
}

.parse-loading-text {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-base);
  color: var(--corp-text-primary);
}

.parse-loading-text strong {
  font-size: var(--text-lg);
  font-weight: 600;
}

.parse-loading-text span {
  color: var(--corp-text-secondary);
  font-size: var(--text-sm);
}

.parse-loading-hint {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
}

@media (max-width: 1200px) {
  .rl-layout {
    flex-direction: column;
    gap: var(--space-6);
  }

  .rl-sidebar {
    width: 100%;
    max-width: 100%;
  }

  .rl-sidebar--collapsed {
    width: 100%;
    padding: var(--space-5);
  }

  .sidebar-collapse-btn {
    display: none;
  }
  
  .filters {
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  
  .filter-input {
    width: 100%;
    max-width: 300px;
  }
  
  .filter-select {
    width: 140px;
  }
}

@media (max-width: 768px) {
  .rl-layout {
    padding: var(--space-5);
    gap: var(--space-4);
  }
  
  .rl-sidebar {
    padding: var(--space-5);
  }
  
  .filters {
    padding: var(--space-4);
    gap: var(--space-3);
  }
  
  .filter-input {
    width: 100%;
    max-width: 100%;
  }
  
  .filter-select {
    width: calc(50% - var(--space-2));
  }
  
  .detail-header {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
  }
  
  .tree-node-actions {
    opacity: 1;
  }
}

@media (max-width: 480px) {
  .rl-layout {
    padding: var(--space-3);
  }
  
  .lib-name-cell {
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-1);
  }
}
</style>
