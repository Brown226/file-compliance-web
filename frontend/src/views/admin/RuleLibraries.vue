<template>
  <div class="rl-page">
    <!-- 主布局：左侧目录树 + 右侧内容区 -->
    <div class="rl-layout">
      <!-- 左侧分类/目录面板 -->
      <aside class="rl-sidebar">
        <div class="sidebar-header">
          <h3 class="sidebar-title">分类管理</h3>
          <div class="sidebar-actions">
            <el-button size="small" icon="Plus" @click="showCreateCategoryDialog">新建分类</el-button>
            <el-button size="small" icon="FolderPlus" @click="showCreateFolderDialog">新建目录</el-button>
          </div>
        </div>
        
        <!-- 分类列表 -->
        <div class="category-section">
          <div class="section-title">
            <el-icon class="section-icon"><Folder /></el-icon>
            <span>规则分类</span>
          </div>
          <div class="category-list">
            <div
              v-for="cat in categories"
              :key="cat.id"
              class="category-item"
              :class="{ active: selectedCategory?.id === cat.id }"
              @click="selectCategory(cat)"
            >
              <el-icon class="category-icon" size="14">Tag</el-icon>
              <span class="category-name">{{ cat.name }}</span>
              <span class="category-count">{{ getCategoryCount(cat.id) }}</span>
              <div class="category-actions" @click.stop>
                <el-button size="small" :icon="Edit" @click="showEditCategoryDialog(cat)" aria-label="编辑分类" />
                <el-button size="small" :icon="Delete" type="danger" @click="handleDeleteCategory(cat.id)" aria-label="删除分类" />
              </div>
            </div>
          </div>
        </div>

        <!-- 目录树 -->
        <div class="folder-section">
          <div class="section-header">
            <div class="section-title">
              <el-icon class="section-icon"><FolderOpened /></el-icon>
              <span>规则目录</span>
            </div>
            <el-button 
              size="small" 
              aria-label="移动目录"
              @click="showMoveFolderDialog" 
              :disabled="!selectedFolders.length"
              title="移动目录"
            >
              <el-icon><ArrowRight /></el-icon>
            </el-button>
            <el-button 
              size="small" 
              aria-label="合并目录"
              @click="showMergeFolderDialog" 
              :disabled="selectedFolders.length < 2"
              title="合并目录"
            >
              <el-icon><Grid /></el-icon>
            </el-button>
          </div>
          <el-tree
            :data="folderTree"
            :props="treeProps"
            :default-expanded-keys="expandedFolderKeys"
            :default-checked-keys="checkedFolderKeys"
            show-checkbox
            node-key="id"
            class="folder-tree"
            ref="folderTreeRef"
            @node-click="handleFolderClick"
            @check-change="handleFolderCheck"
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
                  <el-button 
                    v-if="node.parent" 
                    size="small" 
                    :icon="ArrowUp" 
                    @click="moveFolderUp(data, node)" 
                    title="上移"
                    aria-label="目录上移"
                  />
                  <el-button 
                    v-if="node.parent && node.parent.children?.length > 1" 
                    size="small" 
                    :icon="ArrowDown" 
                    @click="moveFolderDown(data, node)" 
                    title="下移"
                    aria-label="目录下移"
                  />
                </span>
              </span>
            </template>
          </el-tree>
        </div>
      </aside>

      <!-- 右侧主内容区 -->
      <main class="rl-main">
        <!-- 顶部英雄面板 -->
        <section class="hero-panel">
          <div class="hero-copy">
            <div class="hero-eyebrow">RULE LIBRARIES</div>
            <h2>规则库管理</h2>
            <p class="subtitle">把规范文档沉淀成可发布、可筛选、可提审的结构化规则资产。</p>
            <div class="hero-metrics">
              <div class="metric-card">
                <div class="metric-icon bg-blue">
                  <el-icon><FolderOpened /></el-icon>
                </div>
                <div class="metric-info">
                  <span class="metric-value">{{ libraries.length }}</span>
                  <span class="metric-label">规则库总数</span>
                </div>
              </div>
              <div class="metric-card">
                <div class="metric-icon bg-green">
                  <el-icon><CircleCheck /></el-icon>
                </div>
                <div class="metric-info">
                  <span class="metric-value">{{ publishedCount }}</span>
                  <span class="metric-label">已发布</span>
                </div>
              </div>
              <div class="metric-card">
                <div class="metric-icon bg-purple">
                  <el-icon><Refresh /></el-icon>
                </div>
                <div class="metric-info">
                  <span class="metric-value">{{ executableCount }}</span>
                  <span class="metric-label">可执行规则</span>
                </div>
              </div>
              <div class="metric-card">
                <div class="metric-icon bg-orange">
                  <el-icon><Grid /></el-icon>
                </div>
                <div class="metric-info">
                  <span class="metric-value">{{ categories.length }}</span>
                  <span class="metric-label">分类数</span>
                </div>
              </div>
            </div>
          </div>
          <div class="hero-actions">
            <div class="view-toggle">
              <button 
                :class="{ active: viewMode === 'grid' }" 
                @click="viewMode = 'grid'"
                title="网格视图"
                type="button"
                aria-label="切换到网格视图"
              >
                <el-icon><Grid /></el-icon>
              </button>
              <button 
                :class="{ active: viewMode === 'list' }" 
                @click="viewMode = 'list'"
                title="列表视图"
                type="button"
                aria-label="切换到列表视图"
              >
                <el-icon><List /></el-icon>
              </button>
            </div>
            <el-button type="primary" class="create-button" @click="showCreateDialog">
              <el-icon><Plus /></el-icon> 新建规则库
            </el-button>
          </div>
        </section>

        <!-- 规则库列表 -->
        <div v-if="viewMode === 'grid'" class="library-grid">
          <div 
            v-for="lib in libraries" 
            :key="lib.id" 
            class="library-card"
            @click="showDetail(lib)"
          >
            <div class="card-header">
              <div class="card-icon" :class="getStatusClass(lib.status)">
                <el-icon>{{ getStatusIcon(lib.status) }}</el-icon>
              </div>
              <el-tag :type="getStatusTagType(lib.status)" size="small" class="card-status">
                {{ getStatusLabel(lib.status) }}
              </el-tag>
            </div>
            <h3 class="card-title">{{ lib.name }}</h3>
            <p class="card-desc">{{ lib.description || '暂无描述' }}</p>
            <div class="card-meta">
              <div class="meta-item">
                <el-icon><FileText /></el-icon>
                <span>{{ lib._count?.items || 0 }} 规则</span>
              </div>
              <div class="meta-item">
                <el-icon><Zap /></el-icon>
                <span>{{ lib.enabledExecutableItemCount || 0 }} 可执行</span>
              </div>
            </div>
            <div class="card-actions">
              <el-button size="small" @click.stop="showDetail(lib)">查看规则</el-button>
              <el-button size="small" @click.stop="showUploadRules(lib)">AI解析</el-button>
            </div>
          </div>
        </div>

        <!-- 规则库表格 -->
        <el-card v-else shadow="never" class="rl-card rl-table-card">
          <el-table :data="libraries" v-loading="loading" empty-text="暂无规则库">
            <el-table-column prop="name" label="规则库名称" min-width="180">
              <template #default="{ row }">
                <div class="lib-name-cell">
                  <div :class="['status-indicator', getStatusClass(row.status)]"></div>
                  <span class="lib-name">{{ row.name }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="description" label="描述" min-width="220" show-overflow-tooltip />
            <el-table-column prop="sourceFileName" label="源文件" width="160" show-overflow-tooltip />
            <el-table-column label="规则数" width="100" align="center">
              <template #default="{ row }">
                <el-tag type="info" size="small">{{ row._count?.items || 0 }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="可执行" width="100" align="center">
              <template #default="{ row }">
                <el-tag type="success" size="small">{{ row.enabledExecutableItemCount || 0 }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="待结构化" width="100" align="center">
              <template #default="{ row }">
                <el-tag type="warning" size="small">{{ row.pendingStructuredItemCount || 0 }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="getStatusTagType(row.status)" size="small">
                  {{ getStatusLabel(row.status) }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="420" fixed="right">
              <template #default="{ row }">
                <el-button type="primary" link size="small" @click="showDetail(row)">查看规则</el-button>
                <el-button type="primary" link size="small" @click="showUploadRules(row)">AI 解析</el-button>
                <el-button type="primary" link size="small" @click="showEditDialog(row)">编辑</el-button>
                <el-button
                  v-if="row.status !== 'PUBLISHED'"
                  type="success"
                  link
                  size="small"
                  @click="changeStatus(row, 'PUBLISHED')"
                >
                  发布
                </el-button>
                <el-button
                  v-if="row.status !== 'DRAFT'"
                  type="warning"
                  link
                  size="small"
                  @click="changeStatus(row, 'DRAFT')"
                >
                  撤回
                </el-button>
                <el-button
                  v-if="row.status !== 'ARCHIVED'"
                  type="info"
                  link
                  size="small"
                  @click="changeStatus(row, 'ARCHIVED')"
                >
                  归档
                </el-button>
                <el-popconfirm title="确认删除此规则库？" @confirm="handleDelete(row.id)">
                  <template #reference>
                    <el-button type="danger" link size="small">删除</el-button>
                  </template>
                </el-popconfirm>
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
        <el-form-item label="分类">
          <el-select v-model="formData.categoryId" placeholder="选择分类" clearable>
            <el-option v-for="cat in categories" :key="cat.id" :label="cat.name" :value="cat.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSubmit" :loading="submitting">确定</el-button>
      </template>
    </el-dialog>

    <!-- 新建分类对话框 -->
    <el-dialog v-model="categoryDialogVisible" :title="isEditCategory ? '编辑分类' : '新建分类'" width="400px">
      <el-form :model="categoryForm" label-width="60px">
        <el-form-item label="名称" required>
          <el-input v-model="categoryForm.name" placeholder="分类名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="categoryForm.description" type="textarea" :rows="2" placeholder="分类描述" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="categoryDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleSaveCategory" :loading="submitting">确定</el-button>
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
      <el-upload drag :auto-upload="false" :limit="1" accept=".docx,.doc,.pdf,.xlsx,.xls,.txt,.md" :on-change="handleParseFileChange">
        <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
        <div class="el-upload__text">拖拽文件到此处，或 <em>点击选择</em></div>
      </el-upload>
      <template #footer>
        <el-button @click="parseDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="handleParsePreview" :loading="parsing">生成候选规则</el-button>
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
  CircleCheck, Grid, List, Edit, Delete, ArrowDown, ArrowUp, Refresh, Files
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

// 视图模式
const viewMode = ref<'grid' | 'list'>('list')

// 加载状态
const loading = ref(false)
const submitting = ref(false)
const parsing = ref(false)
const importing = ref(false)

// 数据
const libraries = ref<RuleLibrary[]>([])
const selectedLibrary = ref<RuleLibrary | null>(null)
const selectedCategory = ref<any>(null)
const categories = ref<any[]>([
  { id: 'cat-1', name: '命名规范', description: '文件命名、变量命名等规则' },
  { id: 'cat-2', name: '格式规范', description: '文档格式、排版规则' },
  { id: 'cat-3', name: '内容规范', description: '文档内容要求' },
  { id: 'cat-4', name: 'DWG规范', description: 'CAD图纸相关规则' },
])

// 目录树
const folderTreeRef = ref<InstanceType<typeof ElTree> | null>(null)
const folderTree = ref([
  {
    id: 'folder-1',
    label: '根目录',
    count: 15,
    children: [
      { id: 'folder-1-1', label: '命名规则', count: 5 },
      { id: 'folder-1-2', label: '格式规则', count: 6 },
      { id: 'folder-1-3', label: '内容规则', count: 4, children: [
        { id: 'folder-1-3-1', label: '标题规范', count: 2 },
        { id: 'folder-1-3-2', label: '正文规范', count: 2 },
      ]},
    ]
  },
])
const expandedFolderKeys = ref(['folder-1'])
const checkedFolderKeys = ref([])
const treeProps = {
  children: 'children',
  label: 'label',
}

// 选中的目录
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
const formData = reactive({ name: '', description: '', categoryId: '' })

const categoryDialogVisible = ref(false)
const isEditCategory = ref(false)
const editingCategoryId = ref('')
const categoryForm = reactive({ name: '', description: '' })

const folderDialogVisible = ref(false)
const folderForm = reactive({ name: '', parentId: '' })

const parseDialogVisible = ref(false)
const previewDialogVisible = ref(false)
const parseTarget = ref<RuleLibrary | null>(null)
const parseFile = ref<File | null>(null)
const previewItems = ref<RuleLibraryPreviewItem[]>([])
const previewSourceFileName = ref('')
const importMode = ref<'merge' | 'replace'>('merge')

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

// 方法
const getCategoryCount = (categoryId: string) => {
  let count = 0
  libraries.value.forEach(lib => {
    lib.items?.forEach(item => {
      if (item.category === categories.value.find(c => c.id === categoryId)?.name) {
        count++
      }
    })
  })
  return count
}

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

const getStatusIcon = (status: string) => {
  const map: Record<string, any> = {
    DRAFT: List,
    PUBLISHED: CircleCheck,
    ARCHIVED: Folder,
  }
  return map[status] || List
}

const selectCategory = (cat: any) => {
  selectedCategory.value = cat
}

const handleFolderClick = (data: any) => {
    console.log('Folder clicked:', data)
  }

  const handleFolderCheck = (data: any, checked: boolean) => {
    console.log('Folder checked:', data, checked)
  }

  // 查找节点
  const findNodeById = (nodes: any[], id: string): { node: any; parent: any; index: number } | null => {
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) {
        return { node: nodes[i], parent: null, index: i }
      }
      if (nodes[i].children) {
        const found = findNodeById(nodes[i].children, id)
        if (found) {
          return { node: found.node, parent: nodes[i], index: found.index }
        }
      }
    }
    return null
  }

  // 编辑目录
  const showEditFolderDialog = (data: any) => {
    editingFolder.value = data
    editFolderForm.name = data.label
    editFolderDialogVisible.value = true
  }

  const handleEditFolder = () => {
    if (!editFolderForm.name.trim()) {
      ElMessage.warning('请输入目录名称')
      return
    }
    editingFolder.value.label = editFolderForm.name.trim()
    ElMessage.success('目录名称更新成功')
    editFolderDialogVisible.value = false
  }

  // 删除目录
  const handleDeleteFolder = (folderId: string) => {
    if (folderId === 'folder-1') {
      ElMessage.warning('根目录不能删除')
      return
    }
    ElMessageBox.confirm(
      '确认删除此目录？目录下的子目录和规则将一并删除。',
      '删除目录',
      {
        confirmButtonText: '确定删除',
        cancelButtonText: '取消',
        type: 'warning',
      }
    ).then(() => {
      const removeFromTree = (nodes: any[]): boolean => {
        for (let i = 0; i < nodes.length; i++) {
          if (nodes[i].id === folderId) {
            nodes.splice(i, 1)
            return true
          }
          if (nodes[i].children && removeFromTree(nodes[i].children)) {
            return true
          }
        }
        return false
      }
      removeFromTree(folderTree.value)
      checkedFolderKeys.value = checkedFolderKeys.value.filter(id => id !== folderId)
      ElMessage.success('删除成功')
    }).catch(() => {})
  }

  // 上移目录
  const moveFolderUp = (data: any, node: any) => {
    if (!node.parent || node.parent.children.length <= 1) return
    
    const siblings = node.parent.children
    const index = siblings.findIndex((item: any) => item.id === data.id)
    if (index > 0) {
      const temp = siblings[index]
      siblings[index] = siblings[index - 1]
      siblings[index - 1] = temp
      ElMessage.success('已上移')
    }
  }

  // 下移目录
  const moveFolderDown = (data: any, node: any) => {
    if (!node.parent) return
    
    const siblings = node.parent.children
    const index = siblings.findIndex((item: any) => item.id === data.id)
    if (index < siblings.length - 1) {
      const temp = siblings[index]
      siblings[index] = siblings[index + 1]
      siblings[index + 1] = temp
      ElMessage.success('已下移')
    }
  }

  // 移动目录对话框
  const showMoveFolderDialog = () => {
    moveFolderForm.targetId = ''
    moveFolderDialogVisible.value = true
  }

  const handleMoveFolder = () => {
    if (!moveFolderForm.targetId) {
      ElMessage.warning('请选择目标目录')
      return
    }
    
    selectedFolders.value.forEach(folderId => {
      if (folderId === moveFolderForm.targetId) return
      
      const found = findNodeById(folderTree.value, folderId)
      if (found && found.parent) {
        found.parent.children.splice(found.index, 1)
        
        const targetFound = findNodeById(folderTree.value, moveFolderForm.targetId)
        if (targetFound) {
          if (!targetFound.node.children) targetFound.node.children = []
          targetFound.node.children.push(found.node)
        }
      }
    })
    
    ElMessage.success('移动成功')
    moveFolderDialogVisible.value = false
    checkedFolderKeys.value = []
  }

  // 合并目录对话框
  const showMergeFolderDialog = () => {
    mergeFolderForm.name = ''
    mergeFolderDialogVisible.value = true
  }

  const handleMergeFolder = () => {
    if (!mergeFolderForm.name.trim()) {
      ElMessage.warning('请输入合并后的目录名称')
      return
    }
    
    const mergedChildren: any[] = []
    const mergedCount: number = 0
    
    selectedFolders.value.forEach(folderId => {
      const found = findNodeById(folderTree.value, folderId)
      if (found && found.parent) {
        const node = found.node
        if (node.children) {
          mergedChildren.push(...node.children)
        }
        found.parent.children.splice(found.index, 1)
      }
    })
    
    const newFolder = {
      id: `folder-${Date.now()}`,
      label: mergeFolderForm.name.trim(),
      count: mergedCount,
      children: mergedChildren.length > 0 ? mergedChildren : undefined,
    }
    
    folderTree.value.push(newFolder)
    ElMessage.success('合并成功')
    mergeFolderDialogVisible.value = false
    checkedFolderKeys.value = []
  }

const resetLibraryForm = () => {
  formData.name = ''
  formData.description = ''
  formData.categoryId = ''
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
    const { data } = await getRuleLibrariesApi()
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
      await updateRuleLibraryApi(editId.value, { name: formData.name.trim(), description: formData.description || '' })
    } else {
      await createRuleLibraryApi({ name: formData.name.trim(), description: formData.description || '' })
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
  parsing.value = true
  try {
    const fd = new FormData()
    fd.append('file', parseFile.value)
    const { data } = await parseRulesPreviewApi(parseTarget.value.id, fd)
    previewItems.value = data?.items || []
    previewSourceFileName.value = data?.sourceFileName || parseFile.value.name
    parseDialogVisible.value = false
    previewDialogVisible.value = true
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '解析预览失败')
  } finally {
    parsing.value = false
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

const showCreateCategoryDialog = () => {
  isEditCategory.value = false
  editingCategoryId.value = ''
  categoryForm.name = ''
  categoryForm.description = ''
  categoryDialogVisible.value = true
}

const showEditCategoryDialog = (cat: any) => {
  isEditCategory.value = true
  editingCategoryId.value = cat.id
  categoryForm.name = cat.name
  categoryForm.description = cat.description || ''
  categoryDialogVisible.value = true
}

const handleSaveCategory = async () => {
  if (!categoryForm.name.trim()) {
    ElMessage.warning('请输入分类名称')
    return
  }
  submitting.value = true
  try {
    if (isEditCategory.value) {
      const index = categories.value.findIndex(c => c.id === editingCategoryId.value)
      if (index !== -1) {
        categories.value[index] = {
          ...categories.value[index],
          name: categoryForm.name.trim(),
          description: categoryForm.description,
        }
      }
      ElMessage.success('分类更新成功')
    } else {
      categories.value.push({
        id: `cat-${Date.now()}`,
        name: categoryForm.name.trim(),
        description: categoryForm.description,
      })
      ElMessage.success('分类创建成功')
    }
    categoryDialogVisible.value = false
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

const handleDeleteCategory = (categoryId: string) => {
  ElMessageBox.confirm(
    '确认删除此分类？',
    '删除分类',
    {
      confirmButtonText: '确定删除',
      cancelButtonText: '取消',
      type: 'warning',
    }
  ).then(() => {
    const index = categories.value.findIndex(c => c.id === categoryId)
    if (index !== -1) {
      categories.value.splice(index, 1)
      if (selectedCategory.value?.id === categoryId) {
        selectedCategory.value = null
      }
      ElMessage.success('删除成功')
    }
  }).catch(() => {})
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
    const newFolder = {
      id: `folder-${Date.now()}`,
      label: folderForm.name.trim(),
      count: 0,
      children: [],
    }
    
    if (folderForm.parentId) {
      const addToTree = (nodes: any[]): boolean => {
        for (const node of nodes) {
          if (node.id === folderForm.parentId) {
            if (!node.children) node.children = []
            node.children.push(newFolder)
            return true
          }
          if (node.children && addToTree(node.children)) {
            return true
          }
        }
        return false
      }
      addToTree(folderTree.value)
    } else {
      folderTree.value.push(newFolder)
    }
    
    ElMessage.success('目录创建成功')
    folderDialogVisible.value = false
  } catch (e: any) {
    ElMessage.error('操作失败')
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  fetchLibraries()
})
</script>

<style scoped>
.rl-page {
  padding: 0;
  min-height: 100vh;
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
}

.rl-layout {
  display: flex;
  gap: 24px;
  padding: 24px;
  max-width: 1800px;
  margin: 0 auto;
}

/* 左侧边栏 */
.rl-sidebar {
  width: 280px;
  flex-shrink: 0;
  background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
  border-radius: 16px;
  padding: 20px;
  border: 1px solid #d8e0ea;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid #e2e8f0;
}

.sidebar-title {
  font-size: 16px;
  font-weight: 600;
  color: #0f172a;
  margin: 0;
}

.sidebar-actions {
  display: flex;
  gap: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  font-weight: 500;
  color: #334155;
  margin-bottom: 12px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.72);
  border-radius: 8px;
}

.section-icon {
  font-size: 14px;
}

.category-section,
.folder-section {
  margin-bottom: 24px;
}

.category-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.category-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid transparent;
}

.category-item:hover {
  background: rgba(255, 255, 255, 0.92);
  border-color: #cbd5e1;
}

.category-item.active {
  background: linear-gradient(90deg, #dbeafe 0%, #eff6ff 100%);
  border-color: #93c5fd;
}

.category-icon {
  font-size: 14px;
  color: #0369a1;
}

.category-name {
  flex: 1;
  font-size: 14px;
  color: #0f172a;
  font-weight: 500;
}

.category-count {
  font-size: 12px;
  color: #475569;
  background: rgba(255, 255, 255, 0.75);
  padding: 2px 8px;
  border-radius: 999px;
}

.category-actions {
  opacity: 0;
  transition: opacity 0.2s;
}

.category-item:hover .category-actions {
  opacity: 1;
}

.folder-tree {
  font-size: 14px;
  max-height: 350px;
  overflow-y: auto;
  color: #0f172a;
}

.folder-tree :deep(.el-tree-node__content) {
  height: auto;
  padding: 6px 8px;
  border-radius: 8px;
}

.folder-tree :deep(.el-tree-node:hover > .el-tree-node__content) {
  background: rgba(255, 255, 255, 0.9);
}

.folder-tree :deep(.el-tree-node.is-selected > .el-tree-node__content) {
  background: linear-gradient(90deg, #dbeafe 0%, #eff6ff 100%);
}

.folder-tree :deep(.el-checkbox__inner) {
  border-radius: 4px;
}

.tree-node {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  width: 100%;
}

.expand-icon {
  font-size: 12px;
  color: #64748b;
}

.node-label {
  flex: 1;
  color: #0f172a;
  font-size: 13px;
  font-weight: 500;
}

.tree-count {
  font-size: 12px;
  color: #334155;
  background: rgba(255, 255, 255, 0.82);
  padding: 2px 6px;
  border-radius: 999px;
}

.tree-node-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.tree-node:hover .tree-node-actions {
  opacity: 1;
}

.tree-node-actions :deep(.el-button) {
  padding: 4px;
  min-width: auto;
}

.view-toggle button {
  outline: none;
}

.view-toggle button:focus-visible {
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35);
}

.view-toggle button:hover {
  color: #0f172a;
}

.view-toggle button.active:hover {
  background: #ffffff;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.section-tools {
  display: flex;
  gap: 4px;
}

.section-tools :deep(.el-button:disabled) {
  opacity: 0.65;
  background: rgba(255, 255, 255, 0.9);
  border-color: #dbe4ee;
  color: #94a3b8;
}

.section-tools :deep(.el-button) {
  width: 34px;
  height: 34px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.section-tools :deep(.el-button:hover:not(:disabled)) {
  background: #eff6ff;
  border-color: #93c5fd;
  color: #1d4ed8;
}

.dialog-tip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
  background: #f0f9ff;
  border-radius: 8px;
  font-size: 13px;
  color: #0369a1;
}

.dialog-tip :deep(.el-icon) {
  font-size: 16px;
}

/* 右侧主内容 */
.rl-main {
  flex: 1;
  min-width: 0;
}

/* 英雄面板 */
.hero-panel {
  display: flex;
  justify-content: space-between;
  gap: 24px;
  align-items: stretch;
  padding: 32px;
  margin-bottom: 24px;
  border-radius: 20px;
  background: linear-gradient(135deg, #1e293b 0%, #334155 50%, #475569 100%);
  box-shadow: 0 20px 60px rgba(30, 41, 59, 0.3);
  position: relative;
  overflow: hidden;
}

.hero-panel::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -20%;
  width: 60%;
  height: 100%;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.15) 0%, transparent 70%);
  border-radius: 50%;
  pointer-events: none;
}

.hero-panel::after {
  content: '';
  position: absolute;
  bottom: -30%;
  left: -10%;
  width: 40%;
  height: 80%;
  background: radial-gradient(circle, rgba(139, 92, 246, 0.1) 0%, transparent 70%);
  border-radius: 50%;
  pointer-events: none;
}

.hero-copy {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hero-eyebrow {
  font-size: 11px;
  letter-spacing: 0.2em;
  color: #94a3b8;
  font-weight: 700;
}

.hero-panel h2 {
  font-size: 32px;
  line-height: 1.1;
  margin: 0;
  color: #ffffff;
  font-weight: 700;
}

.subtitle {
  font-size: 14px;
  color: #cbd5e1;
  margin: 0;
  max-width: 600px;
}

.hero-metrics {
  display: flex;
  gap: 16px;
  margin-top: 12px;
}

.metric-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 20px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  backdrop-filter: blur(10px);
}

.metric-icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.metric-icon.bg-blue {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

.metric-icon.bg-green {
  background: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.metric-icon.bg-purple {
  background: rgba(139, 92, 246, 0.2);
  color: #a78bfa;
}

.metric-icon.bg-orange {
  background: rgba(249, 115, 22, 0.2);
  color: #fb923c;
}

.metric-info {
  display: flex;
  flex-direction: column;
}

.metric-value {
  font-size: 24px;
  font-weight: 700;
  color: #ffffff;
  line-height: 1;
}

.metric-label {
  font-size: 12px;
  color: #94a3b8;
}

.hero-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 16px;
}

.view-toggle {
  display: flex;
  gap: 4px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 10px;
}

.view-toggle button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: #94a3b8;
  transition: all 0.2s;
}

.view-toggle button:hover {
  background: rgba(255, 255, 255, 0.1);
}

.view-toggle button.active {
  background: #ffffff;
  color: #1e293b;
}

.create-button {
  min-width: 148px;
  border-radius: 14px;
  background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
  border: none;
  box-shadow: 0 8px 24px rgba(14, 165, 233, 0.3);
  position: relative;
  z-index: 10;
}

/* 网格视图 */
.library-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.library-card {
  background: #ffffff;
  border-radius: 16px;
  padding: 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  border: 1px solid #e2e8f0;
  position: relative;
  overflow: hidden;
}

.library-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: linear-gradient(90deg, #0ea5e9, #8b5cf6);
  transform: scaleX(0);
  transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.library-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  border-color: #cbd5e1;
}

.library-card:hover::before {
  transform: scaleX(1);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.card-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.card-icon.status-draft {
  background: #fef3c7;
  color: #d97706;
}

.card-icon.status-published {
  background: #dcfce7;
  color: #16a34a;
}

.card-icon.status-archived {
  background: #e0e7ff;
  color: #6366f1;
}

.card-status {
  font-size: 11px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 8px 0;
}

.card-desc {
  font-size: 13px;
  color: #64748b;
  margin: 0 0 14px 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #94a3b8;
}

.card-actions {
  display: flex;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid #f1f5f9;
}

.card-actions :deep(.el-button) {
  font-size: 12px;
  padding: 4px 12px;
}

/* 卡片样式 */
.rl-card {
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  transition: all 0.3s ease;
}

.rl-card:hover {
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.08);
}

.rl-table-card :deep(.el-card__body),
.detail-card :deep(.el-card__body) {
  padding: 20px;
}

.rl-table-card :deep(.el-table th.el-table__cell) {
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  color: #334155;
  font-weight: 600;
  font-size: 14px;
  border-bottom: 2px solid #e2e8f0;
}

.rl-table-card :deep(.el-table th.el-table__cell):first-child {
  border-radius: 12px 0 0 0;
}

.rl-table-card :deep(.el-table th.el-table__cell):last-child {
  border-radius: 0 12px 0 0;
}

.rl-table-card :deep(.el-table tr:hover > td.el-table__cell),
.detail-card :deep(.el-table tr:hover > td.el-table__cell) {
  background: #f8fafc;
}

.rl-table-card :deep(.el-table__row) {
  transition: all 0.2s ease;
}

.rl-table-card :deep(.el-table__row):hover {
  transform: scale(1.002);
}

.rl-table-card :deep(.el-table__body tr:last-child td.el-table__cell):first-child {
  border-radius: 0 0 0 12px;
}

.rl-table-card :deep(.el-table__body tr:last-child td.el-table__cell):last-child {
  border-radius: 0 0 12px 0;
}

.detail-card {
  margin-top: 20px;
}

.lib-name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.status-indicator.status-draft {
  background: #f59e0b;
}

.status-indicator.status-published {
  background: #10b981;
}

.status-indicator.status-archived {
  background: #6366f1;
}

.lib-name {
  font-weight: 600;
  color: #1e293b;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.detail-stats {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.filters {
  display: flex;
  gap: 14px;
  margin-bottom: 18px;
  padding: 16px;
  border-radius: 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  flex-wrap: wrap;
}

.filter-input {
  width: 280px;
}

.filter-select {
  width: 150px;
}

.helper-text {
  font-size: 13px;
  color: #64748b;
  margin-bottom: 16px;
}

.preview-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.preview-meta {
  font-size: 13px;
  color: #64748b;
}

@media (max-width: 1200px) {
  .rl-layout {
    flex-direction: column;
    gap: 16px;
  }
  
  .rl-sidebar {
    width: 100%;
    max-width: 100%;
  }
  
  .hero-panel {
    flex-direction: column;
    padding: 24px;
    gap: 20px;
  }
  
  .hero-copy {
    order: 1;
  }
  
  .hero-actions {
    order: 2;
    align-items: flex-start;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 12px;
  }
  
  .hero-panel h2 {
    font-size: 26px;
  }
  
  .hero-metrics {
    flex-wrap: wrap;
  }
  
  .metric-card {
    min-width: 140px;
    flex: 1;
  }
  
  .filters {
    flex-wrap: wrap;
    gap: 12px;
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
    padding: 12px;
    gap: 12px;
  }
  
  .rl-sidebar {
    padding: 16px;
  }
  
  .hero-panel {
    padding: 20px;
  }
  
  .hero-panel h2 {
    font-size: 22px;
  }
  
  .hero-metrics {
    flex-wrap: wrap;
    gap: 12px;
  }
  
  .metric-card {
    flex: 1;
    min-width: calc(50% - 6px);
  }
  
  .library-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }
  
  .library-card {
    padding: 16px;
  }
  
  .filters {
    padding: 12px;
    gap: 10px;
  }
  
  .filter-input {
    width: 100%;
    max-width: 100%;
  }
  
  .filter-select {
    width: calc(50% - 5px);
  }
  
  .detail-header {
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
  }
  
  .category-actions,
  .tree-node-actions {
    opacity: 1;
  }
}

@media (max-width: 480px) {
  .rl-layout {
    padding: 8px;
  }
  
  .hero-panel {
    padding: 16px;
  }
  
  .hero-panel h2 {
    font-size: 18px;
  }
  
  .hero-eyebrow {
    font-size: 10px;
  }
  
  .metric-card {
    min-width: 100%;
  }
  
  .lib-name-cell {
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
}

@supports (-webkit-backdrop-filter: none) or (backdrop-filter: none) {
  .metric-card {
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
  }
}

@-moz-document url-prefix() {
  .metric-card {
    background: rgba(255, 255, 255, 0.2);
  }
  
  .hero-panel::before,
  .hero-panel::after {
    opacity: 0.5;
  }
}

@media screen and (-webkit-min-device-pixel-ratio: 0) {
  .card-desc {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
}
</style>
