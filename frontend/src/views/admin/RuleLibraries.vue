<template>
  <div class="rl-container">
    <!-- 顶部介绍 + 操作 -->
    <div class="page-intro">
      <div class="intro-text">
        <h3>语义规则库</h3>
        <p>管理规范条文审点，驱动 DEC 三维度审查。支持上传规范 PDF 自动切分条文并加工审点。</p>
      </div>
      <div class="intro-actions">
        <el-input
          v-model="searchKeyword"
          placeholder="搜索库名"
          clearable
          size="default"
          style="width: 200px;"
          @keyup.enter="fetchLibraries"
          @clear="fetchLibraries"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="statusFilter" placeholder="状态" clearable size="default" style="width: 120px;" @change="fetchLibraries">
          <el-option label="草稿" value="DRAFT" />
          <el-option label="已发布" value="PUBLISHED" />
          <el-option label="归档" value="ARCHIVED" />
        </el-select>
        <el-button v-if="canManage" type="primary" @click="showCreateDialog">
          <el-icon><Plus /></el-icon> 新建规则库
        </el-button>
      </div>
    </div>

    <!-- 主表格卡片 -->
    <el-card shadow="never" class="table-card">
      <!-- 统计条 -->
      <div class="stats-strip">
        <div class="stat-item">
          <span class="stat-label">总库</span>
          <span class="corp-number stat-value">{{ stats.total }}</span>
        </div>
        <div class="stat-sep" />
        <div class="stat-item">
          <span class="stat-label">已发布</span>
          <span class="corp-number stat-value">{{ stats.published }}</span>
        </div>
        <div class="stat-sep" />
        <div class="stat-item">
          <span class="stat-label">审点</span>
          <span class="corp-number stat-value">{{ stats.checkpoints }}</span>
        </div>
        <div class="stat-sep" />
        <div class="stat-item">
          <span class="stat-label">可驱动 DEC</span>
          <span class="corp-number stat-value">{{ stats.decReady }}</span>
        </div>
      </div>

      <el-table
        v-loading="loading"
        :data="libraries"
        size="small"
        border
        stripe
        max-height="calc(100vh - 280px)"
        empty-text="暂无规则库，点击右上角新建"
        row-key="id"
        @row-click="showDetail"
        @expand-change="(row: RuleLibrary, expanded: RuleLibrary[]) => handleExpandChange(row, expanded)"
      >
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="checkpoint-summary" v-loading="expandLoadingMap[row.id]">
              <template v-if="expandCacheMap[row.id]?.length">
                <div v-for="item in expandCacheMap[row.id].slice(0, 5)" :key="item.id" class="summary-row">
                  <span class="summary-clause">{{ truncate(item.clauseText || item.description || item.ruleName || '-', 80) }}</span>
                  <span class="summary-tags">
                    <el-tag v-if="item.auditDimension" :type="dimensionTagType(item.auditDimension)" size="small" effect="plain">{{ dimensionLabel(item.auditDimension) }}</el-tag>
                    <el-tag v-if="item.mandatory" :type="item.mandatory === 'mandatory' ? 'danger' : 'info'" size="small" effect="plain">{{ item.mandatory === 'mandatory' ? '强制' : '引导' }}</el-tag>
                  </span>
                </div>
                <el-button v-if="expandCacheMap[row.id].length > 5" link type="primary" size="small" @click.stop="showDetail(row)">
                  查看全部 {{ expandCacheMap[row.id].length }} 条 <el-icon><ArrowRight /></el-icon>
                </el-button>
              </template>
              <span v-else-if="!expandLoadingMap[row.id]" class="summary-empty">该库暂无审点</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="库名" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="lib-name-link" @click.stop="showDetail(row)">{{ row.name }}</span>
            <div v-if="row.description" class="lib-desc">{{ row.description }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100" align="center">
          <template #default="{ row }">
            <span class="status-dot" :class="statusDotClass(row.status)" />
            <span class="status-text">{{ getStatusLabel(row.status) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="审点数" width="80" align="center">
          <template #default="{ row }">
            <span class="corp-number">{{ row._count?.items ?? row.items?.length ?? 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="维度分布" width="180" align="center" class-name="col-dimension">
          <template #default="{ row }">
            <span class="dimension-inline">{{ formatDimensionStats(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="强制性" width="100" align="center" class-name="col-mandatory">
          <template #default="{ row }">
            <span class="dimension-inline">{{ formatMandatoryStats(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="最近解析" width="110" align="center" class-name="col-recent">
          <template #default="{ row }">
            <span class="recent-time">{{ formatRelativeTime(row.createdAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click.stop="showDetail(row)">详情</el-button>
            <el-button v-if="canManage" link type="primary" size="small" @click.stop="showUploadRules(row)">AI解析</el-button>
            <el-button
              v-if="activeParseTasks.get(row.id)?.status === 'COMPLETED'"
              link type="success" size="small" @click.stop="showPreviewFromTask(row.id)"
            >查看结果</el-button>
            <el-dropdown v-if="canManage" trigger="click" @command="(cmd: string) => handleRowCommand(cmd, row)">
              <el-button link size="small" @click.stop><el-icon><More /></el-icon></el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="edit">编辑</el-dropdown-item>
                  <el-dropdown-item v-if="row.status === 'DRAFT'" command="publish">发布</el-dropdown-item>
                  <el-dropdown-item v-if="row.status === 'PUBLISHED'" command="draft">撤回</el-dropdown-item>
                  <el-dropdown-item v-if="row.status !== 'ARCHIVED'" command="archive">归档</el-dropdown-item>
                  <el-dropdown-item command="delete" divided>删除</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 详情抽屉 -->
    <el-drawer
      v-model="drawerVisible"
      :title="selectedLibrary?.name || '规则库详情'"
      size="75%"
      :destroy-on-close="true"
    >
      <template v-if="selectedLibrary">
        <div class="drawer-meta-bar">
          <div class="meta-item">
            <span class="meta-label">状态</span>
            <span class="status-dot" :class="statusDotClass(selectedLibrary.status)" />
            <span>{{ getStatusLabel(selectedLibrary.status) }}</span>
          </div>
          <div v-if="selectedLibrary.sourceFileName" class="meta-item">
            <span class="meta-label">来源</span>
            <span>{{ selectedLibrary.sourceFileName }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">创建</span>
            <span>{{ formatRelativeTime(selectedLibrary.createdAt) }}</span>
          </div>
          <div class="meta-item">
            <span class="meta-label">审点数</span>
            <span class="corp-number">{{ selectedLibrary.items?.length ?? 0 }}</span>
          </div>
        </div>

        <div class="drawer-filters">
          <el-input v-model="itemFilters.keyword" placeholder="搜索规则名/条文" clearable size="small" style="width: 200px;">
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-select v-model="itemFilters.severity" placeholder="严重度" clearable size="small" style="width: 110px;">
            <el-option label="错误" value="error" />
            <el-option label="警告" value="warning" />
            <el-option label="提示" value="info" />
          </el-select>
          <el-select v-model="itemFilters.auditDimension" placeholder="维度" clearable size="small" style="width: 110px;">
            <el-option label="合规" value="compliance" />
            <el-option label="事实" value="fact" />
            <el-option label="文本" value="text" />
          </el-select>
          <el-select v-model="itemFilters.mandatory" placeholder="强制性" clearable size="small" style="width: 110px;">
            <el-option label="强制" value="mandatory" />
            <el-option label="引导" value="guidance" />
          </el-select>
          <el-button v-if="canManage" type="primary" size="small" @click="showAddItemDialog">
            <el-icon><Plus /></el-icon> 添加审点
          </el-button>
        </div>

        <el-table :data="filteredItems" size="small" border max-height="calc(100vh - 380px)" empty-text="暂无审点">
          <el-table-column prop="ruleName" label="规则名称" min-width="160" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="rule-name-cell">{{ row.ruleName || '-' }}</span>
              <div v-if="row.ruleCode" class="rule-code-cell">{{ row.ruleCode }}</div>
            </template>
          </el-table-column>
          <el-table-column label="条文原文" min-width="200" show-overflow-tooltip>
            <template #default="{ row }">
              <span class="clause-text-cell">{{ row.clauseText || row.description || '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="审点属性" width="160" align="center">
            <template #default="{ row }">
              <template v-if="row.auditDimension || row.mandatory">
                <el-tag v-if="row.auditDimension" :type="dimensionTagType(row.auditDimension)" size="small" effect="plain" style="margin-right: 4px;">{{ dimensionLabel(row.auditDimension) }}</el-tag>
                <el-tag v-if="row.mandatory" :type="row.mandatory === 'mandatory' ? 'danger' : 'info'" size="small" effect="plain">{{ row.mandatory === 'mandatory' ? '强制' : '引导' }}</el-tag>
              </template>
              <span v-else class="text-muted">—</span>
            </template>
          </el-table-column>
          <el-table-column prop="severity" label="严重度" width="80" align="center">
            <template #default="{ row }">
              <el-tag :type="row.severity === 'error' ? 'danger' : row.severity === 'warning' ? 'warning' : 'info'" size="small" effect="dark">
                {{ row.severity === 'error' ? '错误' : row.severity === 'warning' ? '警告' : '提示' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="enabled" label="启用" width="60" align="center">
            <template #default="{ row }">
              <el-switch v-if="canManage" v-model="row.enabled" size="small" @change="toggleItem(row)" />
              <span v-else>{{ row.enabled ? '是' : '否' }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="canManage" label="操作" width="140" fixed="right" align="center">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="showItemDetail(row)">查看</el-button>
              <el-button link type="primary" size="small" @click="showEditItemDialog(row)">编辑</el-button>
              <el-popconfirm title="确认删除？" @confirm="handleDeleteItem(row.id)">
                <template #reference>
                  <el-button link type="danger" size="small">删除</el-button>
                </template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-drawer>

    <!-- 审点详情二级抽屉 -->
    <el-drawer
      v-model="itemDetailVisible"
      title="审点详情"
      size="45%"
      :append-to-body="true"
      :destroy-on-close="true"
    >
      <template v-if="selectedItem">
        <div class="item-detail-section">
          <div class="detail-label">规则名称</div>
          <div class="detail-value">{{ selectedItem.ruleName || '-' }}</div>
        </div>
        <div v-if="selectedItem.ruleCode" class="item-detail-section">
          <div class="detail-label">规则代码</div>
          <div class="detail-value mono">{{ selectedItem.ruleCode }}</div>
        </div>
        <div class="item-detail-section">
          <div class="detail-label">审查维度 / 强制性</div>
          <div class="detail-value">
            <el-tag v-if="selectedItem.auditDimension" :type="dimensionTagType(selectedItem.auditDimension)" size="small" effect="plain" style="margin-right: 6px;">{{ dimensionLabel(selectedItem.auditDimension) }}</el-tag>
            <el-tag v-if="selectedItem.mandatory" :type="selectedItem.mandatory === 'mandatory' ? 'danger' : 'info'" size="small" effect="plain">{{ selectedItem.mandatory === 'mandatory' ? '强制' : '引导' }}</el-tag>
            <span v-if="!selectedItem.auditDimension && !selectedItem.mandatory" class="text-muted">—</span>
          </div>
        </div>
        <div v-if="selectedItem.clauseText" class="item-detail-section">
          <div class="detail-label">条文原文</div>
          <div class="detail-value clause-text-block">{{ selectedItem.clauseText }}</div>
        </div>
        <div v-if="selectedItem.checkPrompt" class="item-detail-section">
          <div class="detail-label">判定 Prompt（LLM 加工）</div>
          <pre class="detail-value check-prompt-block">{{ selectedItem.checkPrompt }}</pre>
        </div>
        <div v-if="selectedItem.description" class="item-detail-section">
          <div class="detail-label">动作化描述</div>
          <div class="detail-value">{{ selectedItem.description }}</div>
        </div>
        <div v-if="selectedItem.sourceQuote" class="item-detail-section">
          <div class="detail-label">原文引用</div>
          <div class="detail-value">{{ selectedItem.sourceQuote }}</div>
        </div>
        <div v-if="selectedItem.sourceLocation" class="item-detail-section">
          <div class="detail-label">原文位置</div>
          <div class="detail-value">{{ selectedItem.sourceLocation }}</div>
        </div>
        <div v-if="selectedItem.clauseHash" class="item-detail-section">
          <div class="detail-label">去重指纹</div>
          <div class="detail-value mono">{{ selectedItem.clauseHash }}</div>
        </div>
      </template>
    </el-drawer>

    <!-- 新建/编辑规则库对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="isEdit ? '编辑规则库' : '新建规则库'"
      width="480px"
    >
      <el-form label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="formData.name" placeholder="请输入规则库名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="formData.description" type="textarea" :rows="3" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">确认</el-button>
      </template>
    </el-dialog>

    <!-- AI 解析对话框 -->
    <el-dialog
      v-model="parseDialogVisible"
      :title="`AI 解析 — ${parseTarget?.name || ''}`"
      width="560px"
      :close-on-click-modal="!isParsing"
      :close-on-press-escape="!isParsing"
      :show-close="!isParsing"
      :before-close="handleParseDialogClose"
    >
      <el-radio-group v-model="parseMode" size="small" style="margin-bottom: 12px;" :disabled="isParsing">
        <el-radio-button label="rule">规则模式</el-radio-button>
        <el-radio-button label="checkpoint">审点模式</el-radio-button>
      </el-radio-group>

      <p class="helper-text" v-if="parseMode === 'rule'">上传规范文档后用 LLM 提炼动作化规则描述，确认后导入。支持大文档后台异步解析。</p>
      <p class="helper-text" v-else>上传规范 PDF → 切分条文 + LLM 加工为 DEC 风格审点（产出 clauseText/checkPrompt/auditDimension/mandatory），可直接驱动 DEC_REVIEW。</p>

      <div v-if="isParsing" class="parse-loading-state">
        <div class="parse-progress-header">
          <el-icon class="is-loading" :size="24"><Loading /></el-icon>
          <strong>{{ parseStep || '准备中...' }}</strong>
        </div>
        <el-progress :percentage="parseProgress" :stroke-width="10" :indeterminate="parseProgress < 10" style="margin: 14px 0 10px;" />
        <div class="parse-loading-text">
          <span v-if="parseFiles.length > 0">共 {{ parseFiles.length }} 个文件，合计 {{ (parseFiles.reduce((s, f) => s + f.size, 0) / (1024 * 1024)).toFixed(1) }}MB</span>
        </div>
        <div class="parse-loading-hint">{{ parseMessage || '请耐心等待，长文档可能需要数分钟' }}</div>
      </div>

      <template v-else>
        <el-upload
          drag
          multiple
          :auto-upload="false"
          :limit="5"
          accept=".docx,.doc,.pdf,.xlsx,.xls,.txt,.md"
          :on-change="handleParseFileChange"
          :on-remove="handleParseFileRemove"
          :on-exceed="() => ElMessage.warning('最多只能上传 5 个文件')"
        >
          <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
          <div class="el-upload__text">拖拽文件到此处，或 <em>点击选择</em></div>
          <template #tip>
            <div class="el-upload__tip">支持 .docx / .pdf / .xlsx / .txt / .md 等，单文件 ≤ 50MB，最多 5 个文件</div>
          </template>
        </el-upload>
      </template>

      <template #footer>
        <el-button @click="handleParseDialogClose">关闭</el-button>
        <el-button v-if="!isParsing" type="primary" @click="handleParsePreview" :loading="parsing">
          {{ parseMode === 'rule' ? '生成候选规则' : '切分条文并加工审点' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 候选预览对话框 -->
    <el-dialog v-model="previewDialogVisible" :title="previewDialogTitle" width="960px">
      <div class="preview-toolbar">
        <el-radio-group v-model="importMode" size="small">
          <el-radio-button label="merge">合并导入</el-radio-button>
          <el-radio-button label="replace">覆盖导入</el-radio-button>
        </el-radio-group>
        <div class="preview-meta">候选 {{ previewItems.length }} 条</div>
      </div>
      <el-table :data="previewItems" max-height="420" size="small" border>
        <el-table-column prop="ruleCode" label="规则代码" width="120" show-overflow-tooltip />
        <el-table-column prop="ruleName" label="规则名称" min-width="160" show-overflow-tooltip />
        <el-table-column v-if="hasCheckpointFields" label="审点属性" width="170" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.auditDimension" :type="dimensionTagType(row.auditDimension)" size="small" effect="plain" style="margin-right: 4px;">{{ dimensionLabel(row.auditDimension) }}</el-tag>
            <el-tag v-if="row.mandatory" :type="row.mandatory === 'mandatory' ? 'danger' : 'info'" size="small" effect="plain">{{ row.mandatory === 'mandatory' ? '强制' : '引导' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="!hasCheckpointFields" prop="category" label="分类" width="120" />
        <el-table-column v-if="!hasCheckpointFields" prop="executionType" label="执行类型" width="140" />
        <el-table-column prop="severity" label="严重度" width="80" align="center" />
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.duplicate" type="warning" size="small">重复</el-tag>
            <el-tag v-else-if="!row.executable" type="info" size="small">人工项</el-tag>
            <el-tag v-else type="success" size="small">可执行</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="条文/内容" min-width="280" show-overflow-tooltip>
          <template #default="{ row }">
            <span>{{ row.clauseText || row.description || '-' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="previewDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleImportPreview" :loading="importing">确认导入</el-button>
      </template>
    </el-dialog>

    <!-- 手动添加/编辑审点对话框 -->
    <el-dialog
      v-model="itemDialogVisible"
      :title="itemDialogMode === 'edit' ? '编辑审点' : '添加审点'"
      width="640px"
    >
      <el-form label-width="90px">
        <div class="form-section-title">基础信息</div>
        <el-form-item label="规则名称" required>
          <el-input v-model="itemForm.ruleName" placeholder="如：条文 1.0.2 审点" />
        </el-form-item>
        <el-form-item label="规则代码">
          <el-input v-model="itemForm.ruleCode" placeholder="可选，如 1.0.2" />
        </el-form-item>
        <el-form-item label="严重度">
          <el-select v-model="itemForm.severity" style="width: 100%;">
            <el-option label="错误" value="error" />
            <el-option label="警告" value="warning" />
            <el-option label="提示" value="info" />
          </el-select>
        </el-form-item>
        <el-form-item label="动作化描述">
          <el-input v-model="itemForm.description" type="textarea" :rows="2" placeholder="可选，规则的动作化描述" />
        </el-form-item>

        <div class="form-section-title">
          审点字段（可驱动 DEC_REVIEW）
          <el-tooltip content="填写审点字段后，该条目可作为 DEC 三维度审查的判定依据" placement="top">
            <el-icon class="section-help"><InfoFilled /></el-icon>
          </el-tooltip>
        </div>
        <el-form-item label="条文原文">
          <el-input v-model="itemForm.clauseText" type="textarea" :rows="3" placeholder="规范原文条文" />
        </el-form-item>
        <el-form-item label="判定 Prompt">
          <el-input v-model="itemForm.checkPrompt" type="textarea" :rows="4" placeholder="LLM 加工的判定 prompt，用于 DEC 三维度审查" />
        </el-form-item>
        <el-form-item label="审查维度">
          <el-select v-model="itemForm.auditDimension" clearable placeholder="可选" style="width: 100%;">
            <el-option label="合规 (compliance)" value="compliance" />
            <el-option label="事实 (fact)" value="fact" />
            <el-option label="文本 (text)" value="text" />
          </el-select>
        </el-form-item>
        <el-form-item label="强制性">
          <el-select v-model="itemForm.mandatory" clearable placeholder="可选" style="width: 100%;">
            <el-option label="强制 (mandatory)" value="mandatory" />
            <el-option label="引导 (guidance)" value="guidance" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="itemDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSaveItem">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useUserStore } from '@/stores/user'
import { useEnterToConfirm } from '@/composables/useEnterToConfirm'
import {
  Plus, UploadFilled, Search, Loading, More, ArrowRight, InfoFilled,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getRuleLibrariesApi,
  getRuleLibraryApi,
  createRuleLibraryApi,
  updateRuleLibraryApi,
  deleteRuleLibraryApi,
  parseRulesPreviewAsyncApi,
  parseCheckpointsPreviewAsyncApi,
  getRuleParseJobApi,
  importRulePreviewItemsApi,
  addRuleItemApi,
  updateRuleItemApi,
  deleteRuleItemApi,
  type RuleLibrary,
  type RuleLibraryItem,
  type RuleLibraryPreviewItem,
} from '@/api/rule-library'

const userStore = useUserStore()
const canManage = computed(() => userStore.isAdminOrManager())

const loading = ref(false)
const submitting = ref(false)
const parsing = ref(false)
const importing = ref(false)

const libraries = ref<RuleLibrary[]>([])
const selectedLibrary = ref<RuleLibrary | null>(null)
const drawerVisible = ref(false)

const searchKeyword = ref('')
const statusFilter = ref<string>('')

const dialogVisible = ref(false)
const isEdit = ref(false)
const editId = ref('')
const formData = reactive({ name: '', description: '' })

const parseDialogVisible = ref(false)
const previewDialogVisible = ref(false)
const parseTarget = ref<RuleLibrary | null>(null)
const parseFiles = ref<File[]>([])
const previewItems = ref<RuleLibraryPreviewItem[]>([])
const previewSourceFileName = ref('')
const importMode = ref<'merge' | 'replace'>('merge')
const isParsing = ref(false)
// V3.1 解析模式：rule（规则模式）| checkpoint（审点模式）
const parseMode = ref<'rule' | 'checkpoint'>('checkpoint')

// 解析对话框进度（仅在对话框内展示，关闭后由 activeParseTasks 追踪）
const parseProgress = ref(0)
const parseMessage = ref('')
const parseStep = ref('')

const hasCheckpointFields = computed(() =>
  previewItems.value.some(it => it.clauseText || it.checkPrompt || it.auditDimension || it.mandatory),
)

const previewDialogTitle = computed(() =>
  parseMode.value === 'checkpoint' ? '候选审点预览' : '候选规则预览',
)

// 审点维度展示工具
const dimensionLabel = (d: string) => ({ compliance: '合规', fact: '事实', text: '文本' } as Record<string, string>)[d] || d
const dimensionTagType = (d: string): 'primary' | 'success' | 'warning' => {
  if (d === 'compliance') return 'primary'
  if (d === 'fact') return 'success'
  return 'warning'
}

// 按规则库 ID 追踪活跃的解析任务
interface ActiveParseTask {
  jobId: string
  libraryId: string
  libraryName: string
  progress: number
  step: string
  message: string
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED'
  items?: RuleLibraryPreviewItem[]
  sourceFileName?: string
}
const activeParseTasks = ref<Map<string, ActiveParseTask>>(new Map())
const parsePollTimers = ref<Map<string, number>>(new Map())

// 展开行按需加载缓存
const expandCacheMap = ref<Record<string, RuleLibraryItem[]>>({})
const expandLoadingMap = ref<Record<string, boolean>>({})

// 审点详情二级抽屉
const itemDetailVisible = ref(false)
const selectedItem = ref<RuleLibraryItem | null>(null)

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
  // V3.1 审点字段
  clauseText: '',
  checkPrompt: '',
  auditDimension: '' as '' | 'compliance' | 'fact' | 'text',
  mandatory: '' as '' | 'mandatory' | 'guidance',
})

const itemFilters = reactive({
  keyword: '',
  category: '',
  severity: '',
  enabled: '',
  auditDimension: '',
  mandatory: '',
})

// ===== 聚合统计 =====
const stats = computed(() => {
  const total = libraries.value.length
  const published = libraries.value.filter(l => l.status === 'PUBLISHED').length
  const allItems = libraries.value.flatMap(l => l.items || [])
  const checkpoints = allItems.length
  const decReady = allItems.filter(i => i.clauseText || i.checkPrompt).length
  return { total, published, checkpoints, decReady }
})

const getDimensionStats = (items: RuleLibraryItem[] = []) => {
  const r = { compliance: 0, fact: 0, text: 0, null: 0 }
  for (const it of items) {
    const d = (it.auditDimension || 'null') as keyof typeof r
    r[d] = (r[d] || 0) + 1
  }
  return r
}

const getMandatoryStats = (items: RuleLibraryItem[] = []) => {
  const r = { mandatory: 0, guidance: 0, null: 0 }
  for (const it of items) {
    const m = (it.mandatory || 'null') as keyof typeof r
    r[m] = (r[m] || 0) + 1
  }
  return r
}

const formatDimensionStats = (row: RuleLibrary) => {
  const items = row.items || []
  if (items.length === 0) return '—'
  const s = getDimensionStats(items)
  const parts: string[] = []
  if (s.compliance) parts.push(`合规${s.compliance}`)
  if (s.fact) parts.push(`事实${s.fact}`)
  if (s.text) parts.push(`文本${s.text}`)
  return parts.length > 0 ? parts.join('·') : '—'
}

const formatMandatoryStats = (row: RuleLibrary) => {
  const items = row.items || []
  if (items.length === 0) return '—'
  const s = getMandatoryStats(items)
  const parts: string[] = []
  if (s.mandatory) parts.push(`强${s.mandatory}`)
  if (s.guidance) parts.push(`引${s.guidance}`)
  return parts.length > 0 ? parts.join('·') : '—'
}

const formatRelativeTime = (dateStr?: string) => {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  if (hours < 24) return `${hours}小时前`
  if (days < 30) return `${days}天前`
  return date.toLocaleDateString('zh-CN')
}

const truncate = (text: string, max: number) => {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '...' : text
}

const filteredItems = computed(() => {
  let items = selectedLibrary.value?.items || []
  if (itemFilters.keyword.trim()) {
    const keyword = itemFilters.keyword.trim().toLowerCase()
    items = items.filter(item =>
      [item.ruleCode, item.ruleName, item.description, item.clauseText].some(v => (v || '').toLowerCase().includes(keyword)),
    )
  }
  if (itemFilters.severity) items = items.filter(item => item.severity === itemFilters.severity)
  if (itemFilters.auditDimension) items = items.filter(item => item.auditDimension === itemFilters.auditDimension)
  if (itemFilters.mandatory) items = items.filter(item => item.mandatory === itemFilters.mandatory)
  if (itemFilters.enabled === 'enabled') items = items.filter(item => item.enabled)
  if (itemFilters.enabled === 'disabled') items = items.filter(item => !item.enabled)
  return items
})

const statusDotClass = (status: string) => {
  const map: Record<string, string> = {
    DRAFT: 'warning',
    PUBLISHED: 'success',
    ARCHIVED: 'muted',
  }
  return map[status] || 'muted'
}

const getStatusLabel = (status: string) => {
  const map: Record<string, string> = {
    DRAFT: '草稿',
    PUBLISHED: '已发布',
    ARCHIVED: '归档',
  }
  return map[status] || status
}

const resetLibraryForm = () => {
  formData.name = ''
  formData.description = ''
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
  itemForm.clauseText = ''
  itemForm.checkPrompt = ''
  itemForm.auditDimension = ''
  itemForm.mandatory = ''
}

const fetchLibraries = async () => {
  loading.value = true
  try {
    const params: Record<string, any> = {}
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
  isEdit.value = false
  resetLibraryForm()
  dialogVisible.value = true
}

const showEditDialog = (row: RuleLibrary) => {
  isEdit.value = true
  editId.value = row.id
  formData.name = row.name
  formData.description = row.description || ''
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
      })
    } else {
      await createRuleLibraryApi({
        name: formData.name.trim(),
        description: formData.description || '',
      })
    }
    ElMessage.success(isEdit.value ? '更新成功' : '创建成功')
    dialogVisible.value = false
    await fetchLibraries()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

useEnterToConfirm(dialogVisible, handleSubmit, { disabled: submitting })

const handleDelete = async (id: string) => {
  try {
    await deleteRuleLibraryApi(id)
    ElMessage.success('删除成功')
    if (selectedLibrary.value?.id === id) {
      selectedLibrary.value = null
      drawerVisible.value = false
    }
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
    case 'edit':
      showEditDialog(row)
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

// ===== 活跃解析任务管理 =====
const showPreviewFromTask = (libraryId: string) => {
  const task = activeParseTasks.value.get(libraryId)
  if (!task?.items?.length) { ElMessage.warning('无解析结果'); return }
  parseTarget.value = libraries.value.find(l => l.id === libraryId) || null
  previewItems.value = task.items
  previewSourceFileName.value = task.sourceFileName || ''
  previewDialogVisible.value = true
}

const startBackgroundPolling = (jobId: string, libraryId: string, libraryName: string) => {
  const task: ActiveParseTask = { jobId, libraryId, libraryName, progress: 5, step: '上传完成', message: '等待解析...', status: 'PROCESSING' }
  activeParseTasks.value.set(libraryId, task)

  let attempts = 0
  const maxAttempts = 600
  const timer = window.setInterval(async () => {
    attempts++
    try {
      const { data } = await getRuleParseJobApi(jobId)
      const current = activeParseTasks.value.get(libraryId)
      if (!current) { window.clearInterval(timer); return }

      if (data?.status === 'COMPLETED') {
        window.clearInterval(timer); parsePollTimers.value.delete(libraryId)
        const items = data.items || []
        current.status = 'COMPLETED'; current.progress = 100; current.step = '解析完成'
        current.items = items; current.sourceFileName = data.sourceFileName || ''
        ElMessage.success(`[${libraryName}] 解析完成，${items.length} 条候选`)
        return
      }
      if (data?.status === 'FAILED') {
        window.clearInterval(timer); parsePollTimers.value.delete(libraryId)
        current.status = 'FAILED'; current.progress = 0; current.step = '解析失败'
        ElMessage.error(`[${libraryName}] 解析失败`)
        return
      }
      if (attempts >= maxAttempts) {
        window.clearInterval(timer); parsePollTimers.value.delete(libraryId)
        current.status = 'FAILED'; current.step = '超时'
        ElMessage.warning(`[${libraryName}] 解析超时`)
        return
      }
      // V3.1：直接用后端返回的真实进度，不再本地 +1% 模拟
      if (typeof data?.progress === 'number') current.progress = data.progress
      if (data?.step) current.step = data.step
      if (data?.message) current.message = data.message
    } catch { /* 轮询失败忽略 */ }
  }, 1000)
  parsePollTimers.value.set(libraryId, timer)
}

// 组件卸载时清理所有轮询
onBeforeUnmount(() => { parsePollTimers.value.forEach(timer => window.clearInterval(timer)) })

const showDetail = async (row: RuleLibrary) => {
  try {
    const { data } = await getRuleLibraryApi(row.id)
    selectedLibrary.value = data
    drawerVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '获取详情失败')
  }
}

const showUploadRules = (row: RuleLibrary) => {
  parseTarget.value = row
  parseFiles.value = []
  previewItems.value = []
  previewSourceFileName.value = ''
  parseProgress.value = 0
  parseStep.value = ''
  parseMessage.value = ''
  parseDialogVisible.value = true
}

const handleParseFileChange = (file: any, fileList: any[]) => {
  parseFiles.value = fileList.map(f => f.raw).filter(Boolean)
}

const handleParseFileRemove = (file: any) => {
  parseFiles.value = parseFiles.value.filter(f => f !== file.raw)
}

const handleParseDialogClose = () => {
  parseDialogVisible.value = false
}

const handleParsePreview = async () => {
  if (!parseTarget.value?.id || parseFiles.value.length === 0) {
    ElMessage.warning('请选择至少一个文件')
    return
  }
  if (parseFiles.value.length > 5) {
    ElMessage.error('最多支持同时上传 5 个文件')
    return
  }

  const oversize = parseFiles.value.find(f => f.size / (1024 * 1024) > 50)
  if (oversize) {
    ElMessage.error(`文件 "${oversize.name}" 超过 50MB 限制`)
    return
  }

  const libraryId = parseTarget.value.id
  const libraryName = parseTarget.value.name

  parsing.value = true
  isParsing.value = true
  parseProgress.value = 5
  parseStep.value = '上传中...'
  parseMessage.value = ''

  try {
    const fd = new FormData()
    parseFiles.value.forEach(f => fd.append('files', f))
    const api = parseMode.value === 'checkpoint' ? parseCheckpointsPreviewAsyncApi : parseRulesPreviewAsyncApi
    const { data } = await api(libraryId, fd)

    if (data?.jobId) {
      parseStep.value = '已上传，后台解析中'
      parseMessage.value = '可关闭对话框，解析完成后会在列表上方显示结果'
      // 保持对话框打开显示进度，同时启动后台轮询
      startBackgroundPolling(data.jobId, libraryId, libraryName)
      // 5 秒后自动关闭对话框（让用户看到进度开始）
      setTimeout(() => {
        if (parseDialogVisible.value) {
          parseDialogVisible.value = false
          isParsing.value = false
        }
      }, 2000)
      ElMessage.success(parseMode.value === 'checkpoint'
        ? '文件已上传，正在后台切分条文并加工审点'
        : '文件已上传，正在后台解析')
    } else {
      ElMessage.warning('任务创建异常，请重试')
      parsing.value = false
      isParsing.value = false
    }
  } catch (e: any) {
    parsing.value = false
    isParsing.value = false
    if (e?.code === 'ECONNABORTED' || e?.message?.includes('timeout')) {
      ElMessage.error('文件上传超时，请稍后重试')
    } else if (e?.message === 'canceled') {
      ElMessage.info('请求已取消')
    } else {
      ElMessage.error(e?.response?.data?.message || e?.message || '解析预览失败')
    }
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
  // V3.1 审点字段回填
  itemForm.clauseText = row.clauseText || ''
  itemForm.checkPrompt = row.checkPrompt || ''
  itemForm.auditDimension = (row.auditDimension as any) || ''
  itemForm.mandatory = (row.mandatory as any) || ''
  itemDialogVisible.value = true
}

const showItemDetail = (row: RuleLibraryItem) => {
  selectedItem.value = row
  itemDetailVisible.value = true
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
      // V3.1 审点字段
      clauseText: itemForm.clauseText || undefined,
      checkPrompt: itemForm.checkPrompt || undefined,
      auditDimension: itemForm.auditDimension || undefined,
      mandatory: itemForm.mandatory || undefined,
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

// 展开行按需加载
const handleExpandChange = async (row: RuleLibrary, expanded: RuleLibrary[]) => {
  if (expanded.find(r => r.id === row.id) && !expandCacheMap.value[row.id]) {
    expandLoadingMap.value[row.id] = true
    try {
      const { data } = await getRuleLibraryApi(row.id)
      expandCacheMap.value[row.id] = data.items || []
    } catch {
      expandCacheMap.value[row.id] = []
    } finally {
      expandLoadingMap.value[row.id] = false
    }
  }
}

onMounted(() => {
  fetchLibraries()
})
</script>

<style scoped>
.rl-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* ===== 页面介绍 ===== */
.page-intro {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding: 4px 0 4px var(--space-3);
  border-left: 3px solid var(--corp-primary);
}

.intro-text h3 {
  margin: 0 0 var(--space-1);
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--corp-text-primary);
}

.intro-text p {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
}

.intro-actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
  flex-wrap: wrap;
}

/* ===== 表格卡片 ===== */
.table-card {
  box-shadow: var(--shadow-card);
  border: none;
}

.table-card :deep(.el-card__body) {
  padding: var(--space-4);
}

/* ===== 统计条 ===== */
.stats-strip {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  margin-bottom: var(--space-4);
  background: var(--corp-bg-sunken);
  border-radius: var(--radius-md);
}

.stat-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-1);
}

.stat-label {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.stat-value {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--corp-text-primary);
}

.stat-sep {
  width: 1px;
  height: 14px;
  background: var(--corp-border-light);
}

/* ===== 表格行 ===== */
.lib-name-link {
  color: var(--corp-primary);
  font-weight: 600;
  cursor: pointer;
}

.lib-name-link:hover {
  color: var(--corp-primary-hover);
  text-decoration: underline;
}

.lib-desc {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  margin-top: 2px;
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
  vertical-align: middle;
}

.status-dot.success { background: var(--corp-success); }
.status-dot.warning { background: var(--corp-warning); }
.status-dot.muted { background: var(--corp-text-tertiary); }

.status-text {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
}

.dimension-inline {
  font-size: var(--text-xs);
  color: var(--corp-text-secondary);
}

.recent-time {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
}

/* ===== 展开行审点摘要 ===== */
.checkpoint-summary {
  padding: var(--space-3) var(--space-4);
}

.summary-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--corp-border-light);
}

.summary-row:last-child {
  border-bottom: none;
}

.summary-clause {
  flex: 1;
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  margin-right: var(--space-3);
}

.summary-tags {
  display: flex;
  gap: var(--space-1);
  flex-shrink: 0;
}

.summary-empty {
  color: var(--corp-text-tertiary);
  font-size: var(--text-sm);
}

/* ===== 详情抽屉 ===== */
.drawer-meta-bar {
  display: flex;
  align-items: center;
  gap: var(--space-5);
  padding: var(--space-3) var(--space-4);
  background: var(--corp-bg-sunken);
  border-radius: var(--radius-md);
  margin-bottom: var(--space-4);
  flex-wrap: wrap;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
}

.meta-label {
  color: var(--corp-text-tertiary);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-right: 4px;
}

.drawer-filters {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  flex-wrap: wrap;
  align-items: center;
}

.rule-name-cell {
  font-weight: 600;
  color: var(--corp-text-primary);
}

.rule-code-cell {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  margin-top: 2px;
}

.clause-text-cell {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
}

.text-muted {
  color: var(--corp-text-tertiary);
}

/* ===== 审点详情二级抽屉 ===== */
.item-detail-section {
  margin-bottom: var(--space-4);
}

.detail-label {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  margin-bottom: var(--space-1);
  font-weight: 600;
}

.detail-value {
  font-size: var(--text-sm);
  color: var(--corp-text-primary);
  line-height: 1.6;
}

.detail-value.mono {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.clause-text-block {
  padding: var(--space-3);
  background: var(--corp-bg-sunken);
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
}

.check-prompt-block {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  padding: var(--space-3);
  background: var(--corp-bg-sunken);
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
  line-height: 1.5;
}

/* ===== 对话框 ===== */
.helper-text {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  margin: 0 0 var(--space-3);
  line-height: 1.6;
}

.form-section-title {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--corp-text-primary);
  margin: var(--space-4) 0 var(--space-3);
  padding-bottom: var(--space-1);
  border-bottom: 1px solid var(--corp-border-light);
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.section-help {
  color: var(--corp-text-tertiary);
  font-size: var(--text-sm);
}

.preview-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-3);
}

.preview-meta {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
}

/* ===== 解析进度 ===== */
.parse-loading-state {
  text-align: center;
  padding: var(--space-4) 0;
}

.parse-progress-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.parse-loading-text {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  margin-bottom: var(--space-1);
}

.parse-loading-hint {
  font-size: var(--text-xs);
  color: var(--corp-text-tertiary);
}

/* ===== 响应式 ===== */
@media (max-width: 1200px) {
  .table-card :deep(.col-dimension) { display: none; }
}

@media (max-width: 992px) {
  .table-card :deep(.col-recent) { display: none; }
  .intro-actions { width: 100%; }
}

@media (max-width: 768px) {
  .table-card :deep(.col-mandatory) { display: none; }
  .page-intro { flex-direction: column; align-items: flex-start; }
  .drawer-meta-bar { flex-direction: column; align-items: flex-start; gap: var(--space-2); }
  .stats-strip { flex-wrap: wrap; gap: var(--space-2); }
}
</style>
