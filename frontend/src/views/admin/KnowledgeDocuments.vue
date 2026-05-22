<template>
  <div class="kd-page">
    <!-- NavBar -->
    <div class="kd-navbar">
      <div class="kd-navbar__left">
        <button class="kd-navbar__back" @click="goBack">
          <el-icon :size="16"><ArrowLeft /></el-icon>
        </button>
        <span class="kd-navbar__name">{{ categoryInfo?.name || '知识库' }}</span>
      </div>
      <div class="kd-navbar__center">
        <div class="navbar-tabs">
          <button
            v-for="tab in navbarTabs"
            :key="tab.value"
            class="navbar-tab"
            :class="{ 'is-active': activeTab === tab.value }"
            @click="switchTab(tab.value)"
          >{{ tab.label }}</button>
        </div>
      </div>
      <div class="kd-navbar__right" />
    </div>

    <!-- 主内容区 -->
    <div class="kd-body" v-if="!paragraphViewVisible">
      <!-- 文档列表 Tab -->
      <template v-if="activeTab === 'documents'">
        <div class="kd-main">
          <el-alert
            v-if="activeTasks.some(task => task.status === 'failed')"
            type="error"
            show-icon
            :closable="false"
            class="kd-task-alert"
            :title="`有 ${activeTasks.filter(task => task.status === 'failed').length} 个上传任务失败，请查看下方状态原因`"
          />

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

          <div class="kd-toolbar">
            <div class="kd-toolbar__left">
              <span class="kd-toolbar__title">文档列表({{ pagination.total }})</span>
              <el-input
                v-model="searchQuery"
                placeholder="搜索文档名称..."
                clearable
                size="small"
                style="width: 200px;"
                :prefix-icon="Search"
                @change="handleSearch"
              />
            </div>
            <div class="kd-toolbar__right">
              <el-button
                size="small"
                @click="batchVectorize"
                :disabled="selectedDocs.length === 0"
              >
                <el-icon><RefreshRight /></el-icon> 批量向量化
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
              <el-select
                v-model="tagFilterValue"
                multiple
                collapse-tags
                collapse-tags-tooltip
                placeholder="按标签过滤"
                size="small"
                style="width: 160px;"
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
              <el-button type="primary" size="small" @click="importWizardVisible = true">
                <el-icon><Upload /></el-icon> 上传文档
              </el-button>
            </div>
          </div>

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
            <el-table-column label="标签" min-width="160">
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
                <span
                  class="status-tag"
                  :class="statusTagClass(row)"
                >
                  <span class="status-tag__dot" />
                  {{ statusTagText(row) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="char_length" label="字符数" width="100" align="right" sortable>
              <template #default="{ row }">
                {{ formatNumber(row.char_length) }}
              </template>
            </el-table-column>
            <el-table-column prop="paragraph_count" label="段落数" width="80" align="right" sortable />
            <el-table-column prop="create_time" label="创建时间" width="160" sortable>
              <template #default="{ row }">
                {{ formatTime(row.create_time) }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="80" fixed="right" align="center">
              <template #default="{ row }">
                <el-dropdown trigger="click" @command="(cmd: string) => handleRowCommand(cmd, row)">
                  <el-button type="primary" link size="small" @click.stop>
                    <el-icon><MoreFilled /></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="vectorize">
                        <el-icon><RefreshRight /></el-icon> 向量化
                      </el-dropdown-item>
                      <el-dropdown-item command="rename">
                        <el-icon><Edit /></el-icon> 重命名
                      </el-dropdown-item>
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
        </div>

      </template>

      <!-- 检索测试 Tab -->
      <template v-if="activeTab === 'test'">
        <div class="kd-main">
          <div class="kd-test-layout">
            <div class="kd-test-left">
              <el-input
                v-model="hitTestForm.query"
                placeholder="输入检索内容，如：消防水泵扬程要求"
                clearable
                @keyup.enter="handleHitTest"
                class="kd-test-query"
              >
                <template #prefix>
                  <el-icon><Search /></el-icon>
                </template>
              </el-input>
              <div class="kd-test-options">
                <el-form label-position="top" size="small">
                  <el-form-item label="搜索模式">
                    <el-radio-group v-model="hitTestForm.searchMode" size="small">
                      <el-radio-button value="hybrid">混合</el-radio-button>
                      <el-radio-button value="vector">向量</el-radio-button>
                      <el-radio-button value="keyword">关键词</el-radio-button>
                    </el-radio-group>
                  </el-form-item>
                  <el-form-item label="返回条数">
                    <el-input-number
                      v-model="hitTestForm.topNumber"
                      :min="1" :max="30"
                      size="small"
                      style="width: 120px;"
                    />
                  </el-form-item>
                  <el-form-item>
                    <el-button
                      type="primary"
                      @click="handleHitTest"
                      :loading="hitTestLoading"
                    >
                      <el-icon><Search /></el-icon> 测试
                    </el-button>
                  </el-form-item>
                </el-form>
              </div>
              <div class="kd-test-history" v-if="hitTestHistory.length > 0">
                <div class="kd-test-history__title">搜索历史</div>
                <div
                  v-for="(item, idx) in hitTestHistory"
                  :key="idx"
                  class="kd-test-history__item"
                  @click="hitTestForm.query = item; handleHitTest()"
                >
                  <el-icon :size="12"><Search /></el-icon>
                  <span>{{ item }}</span>
                </div>
              </div>
            </div>
            <div class="kd-test-right">
              <div v-if="hitTestResult" class="kd-test-stats">
                <el-tag size="small" type="info" effect="plain">{{ hitTestResult.stats.searchTimeMs }}ms</el-tag>
                <el-tag size="small" effect="plain">候选 {{ hitTestResult.stats.totalCandidates }}</el-tag>
              </div>
              <div v-if="hitTestResult" class="kd-test-results">
                <div v-if="hitTestResult.results.length === 0" class="kd-test-empty">
                  <el-empty description="未检索到相关内容" :image-size="60" />
                </div>
                <div
                  v-for="(item, index) in hitTestResult.results"
                  :key="item.id"
                  class="kd-test-result"
                >
                  <div class="kd-test-result__header">
                    <span class="kd-test-result__rank">#{{ index + 1 }}</span>
                    <span class="kd-test-result__title">
                      {{ item.title || '未知' }}
                      <el-tag v-if="item.clauseId" size="small" type="primary" effect="plain" style="margin-left: 4px;">
                        {{ item.clauseId }}
                      </el-tag>
                      <el-tag v-if="item.isTable" size="small" type="warning" effect="plain" style="margin-left: 2px;">
                        表格
                      </el-tag>
                    </span>
                    <div class="kd-test-result__scores">
                      <el-tag size="small" :type="hitScoreType(item.comprehensiveScore)" effect="plain">
                        {{ (item.comprehensiveScore * 100).toFixed(0) }}%
                      </el-tag>
                      <el-tag v-if="item.rerankScore != null" size="small" type="success" effect="plain">
                        RR {{ (item.rerankScore * 100).toFixed(0) }}%
                      </el-tag>
                    </div>
                  </div>
                  <div class="kd-test-result__content">{{ item.content.substring(0, 300) }}{{ item.content.length > 300 ? '...' : '' }}</div>
                </div>
              </div>
              <div v-else class="kd-test-placeholder">
                <el-icon :size="32" color="var(--corp-text-tertiary)"><Aim /></el-icon>
                <p>输入查询测试当前知识库的检索效果</p>
              </div>
            </div>
          </div>
        </div>

      </template>

      <!-- 知识库设置 Tab -->
      <template v-if="activeTab === 'settings'">
        <div class="kd-main kd-main--full">
          <el-card class="kd-settings-card" shadow="never">
            <template #header>
              <div class="kd-settings-card__header-row">
                <span class="kd-settings-card__title">知识库信息</span>
                <div class="kd-settings-name-row" v-if="!editCategoryNameVisible">
                  <span class="kd-settings-name">{{ categoryInfo?.name || '-' }}</span>
                  <el-icon class="kd-settings-name-edit" :size="14" @click="startEditCategoryName"><Edit /></el-icon>
                </div>
                <div v-else class="kd-settings-name-edit-row">
                  <el-input v-model="editCategoryNameValue" size="small" @keyup.enter="saveCategoryName" />
                  <el-button size="small" @click="saveCategoryName" :loading="editCategoryNameSaving">保存</el-button>
                  <el-button size="small" @click="editCategoryNameVisible = false">取消</el-button>
                </div>
              </div>
            </template>
            <el-descriptions :column="3" border size="small" class="kd-settings-desc-table">
              <el-descriptions-item label="描述" :span="3">{{ categoryInfo?.description || '暂无描述' }}</el-descriptions-item>
              <el-descriptions-item label="ID"><span class="kd-settings-mono">{{ categoryId }}</span></el-descriptions-item>
              <el-descriptions-item label="类型">{{ categoryInfo?.isLeaf ? '叶子知识库' : '目录' }}</el-descriptions-item>
              <el-descriptions-item label="状态">{{ categoryInfo?.status === 'ACTIVE' ? '启用' : '已归档' }}</el-descriptions-item>
              <el-descriptions-item label="创建时间">{{ formatTime(categoryInfo?.createdAt) }}</el-descriptions-item>
              <el-descriptions-item label="文档总数"><b>{{ pagination.total }}</b></el-descriptions-item>
              <el-descriptions-item label="向量片段"><b>{{ totalParagraphs }}</b></el-descriptions-item>
              <el-descriptions-item label="总字符数" :span="2"><b>{{ formatNumber(totalChars) }}</b></el-descriptions-item>
            </el-descriptions>
          </el-card>

          <el-card class="kd-settings-card kd-settings-card--compact" shadow="never">
            <template #header>
              <div class="kd-settings-card__header-row">
                <span class="kd-settings-card__title">分块配置</span>
                <span class="kd-settings-hint-inline">配置影响后续上传文档的分块方式</span>
              </div>
            </template>
            <el-form label-position="left" size="small" class="kd-settings-form kd-settings-form--inline">
              <el-form-item label="模式">
                <el-select v-model="chunkConfig.mode" style="width: 200px;">
                  <el-option label="自动（推荐）" value="auto" />
                  <el-option label="固定长度" value="fixed" />
                  <el-option label="按段落" value="paragraph" />
                </el-select>
              </el-form-item>
              <el-form-item label="最大字符">
                <el-input-number v-model="chunkConfig.maxChars" :min="200" :max="4000" :step="100" :controls="false" style="width: 100px;" />
                <span class="kd-settings-tip-inline">800-1500</span>
              </el-form-item>
              <el-form-item label="重叠字符" v-if="chunkConfig.mode !== 'paragraph'">
                <el-input-number v-model="chunkConfig.overlap" :min="0" :max="500" :step="50" :controls="false" style="width: 100px;" />
                <span class="kd-settings-tip-inline">100-200</span>
              </el-form-item>
            </el-form>
            <div class="kd-settings-save-row">
              <el-button type="primary" size="small" @click="saveChunkConfig" :loading="chunkConfigSaving">保存配置</el-button>
            </div>
          </el-card>
        </div>
      </template>
    </div>

    <!-- 段落全屏浏览页 (FastGPT DataCard 1:1 复刻 + 左侧目录导航) -->
    <div v-if="paragraphViewVisible" class="para-page">
      <!-- 左侧目录导航 -->
      <aside
        class="para-toc"
        :class="{ 'para-toc--collapsed': tocCollapsed }"
        v-if="tocItems.length > 0"
      >
        <div class="para-toc__header" @click="tocCollapsed = !tocCollapsed">
          <div class="para-toc__header-left">
            <el-icon :size="14"><List /></el-icon>
            <span v-if="!tocCollapsed" class="para-toc__title">目录</span>
            <span v-if="!tocCollapsed" class="para-toc__count">{{ tocItems.length }}</span>
          </div>
          <el-icon
            :size="14"
            class="para-toc__toggle"
            :class="{ 'is-flipped': tocCollapsed }"
          ><ArrowLeft /></el-icon>
        </div>

        <div v-if="!tocCollapsed" class="para-toc__body">
          <div
            v-for="(item, idx) in tocItems"
            :key="item.id"
            class="para-toc__item"
            :class="{ 'para-toc__item--active': activeTocId === item.id }"
            @click="scrollToTocItem(item.id)"
          >
            <span class="para-toc__item-index">{{ idx + 1 }}</span>
            <span class="para-toc__item-text" :title="item.label">{{ item.label }}</span>
          </div>
        </div>

        <div v-else class="para-toc__mini">
          <div
            v-for="item in tocItems"
            :key="item.id"
            class="para-toc__mini-dot"
            :class="{ 'para-toc__mini-dot--active': activeTocId === item.id }"
            :title="item.label"
            @click="scrollToTocItem(item.id)"
          />
        </div>
      </aside>

      <!-- 右侧主内容区 -->
      <div class="para-page__main">
      <!-- 顶部导航栏 -->
      <div class="para-page__topbar">
        <div class="para-page__topbar-left">
          <el-button text @click="closeParagraphView">
            <el-icon :size="18"><ArrowLeft /></el-icon> 返回文档列表
          </el-button>
          <span class="para-page__doc-name">{{ currentParagraphTitle }}</span>
          <span class="para-page__badge" v-if="paragraphs.length > 0">
            <el-icon :size="12"><CircleCheck /></el-icon> 已向量化
          </span>
        </div>
        <div class="para-page__topbar-right">
          <el-button size="small" @click="handleExportParagraphs" :disabled="paragraphs.length === 0">
            <el-icon><Download /></el-icon> 导出数据
          </el-button>
        </div>
      </div>

      <!-- 分隔线 -->
      <div class="para-page__divider">
        <div class="para-page__divider-line" />
      </div>

      <!-- 统计栏 (FastGPT: data_amount 行) -->
      <div class="para-page__stats-bar">
        <div class="para-page__stats-left">
          <el-icon :size="16" color="#999"><List /></el-icon>
          <span class="para-page__stats-text">共 {{ paragraphs.length }} 条数据</span>
          <span v-if="paragraphTotalChars > 0" class="para-page__stats-dot">·</span>
          <span v-if="paragraphTotalChars > 0" class="para-page__stats-text">{{ paragraphTotalChars.toLocaleString() }} 字符</span>
        </div>
        <el-input
          v-model="paragraphSearchQuery"
          placeholder="搜索段落..."
          clearable
          size="small"
          class="para-page__search-input"
          :prefix-icon="Search"
        />
      </div>

      <!-- 数据列表区 (FastGPT: ScrollData + Card 列表) -->
      <div class="para-page__scroll-area" v-loading="paragraphLoading" ref="drawerContentRef">
        <template v-if="filteredParagraphs.length > 0">
          <div class="para-page__card-list">
            <div
              v-for="(item, index) in filteredParagraphs"
              :key="item.id"
              :id="`para-${item.id}`"
              class="fg-card"
              :class="{
                'fg-card--odd': index % 2 === 1,
                'fg-card--editing': editingParagraphId === item.id,
              }"
              @click="startEditParagraph(item)"
            >
              <!-- 悬浮标签 (FastGPT: header tag, #chunkIndex + ID) -->
              <div class="fg-card__tag">
                <span class="fg-card__tag-index">#{{ index + 1 }}</span>
                <span v-if="item.clauseId" class="fg-card__tag-id">{{ item.clauseId }}</span>
              </div>

              <!-- 内容区 (FastGPT: Markdown 渲染区域) -->
              <div v-if="editingParagraphId !== item.id" class="fg-card__content">
                <div v-if="isTableContent(item.content)" class="fg-card__table" v-html="renderTableHtml(item.content)" />
                <div v-else class="fg-card__text">{{ item.content }}</div>
              </div>

              <!-- 编辑模式 -->
              <div v-else class="fg-card__editor" @click.stop>
                <el-input
                  ref="paragraphEditRef"
                  v-model="editingParagraphContent"
                  type="textarea"
                  :rows="6"
                  @keydown.escape="cancelParagraphEdit"
                />
                <div class="fg-card__editor-actions">
                  <el-button size="small" @click="cancelParagraphEdit">取消</el-button>
                  <el-button size="small" type="primary" @click="saveParagraphEdit(item.id)">保存</el-button>
                </div>
              </div>

              <!-- 底部操作栏 (FastGPT: footer, 字符数 + 删除) [编辑模式时隐藏避免与操作按钮重叠] -->
              <div v-if="editingParagraphId !== item.id" class="fg-card__footer">
                <div class="fg-card__footer-chars">
                  <el-icon :size="12"><Document /></el-icon>
                  {{ item.content.length }}
                </div>
                <el-popconfirm title="确认删除此段落？" @confirm="handleDeleteParagraph(item.id)">
                  <template #reference>
                    <button class="fg-card__footer-del" @click.stop>
                      <el-icon :size="13"><Delete /></el-icon>
                    </button>
                  </template>
                </el-popconfirm>
              </div>
            </div>
          </div>
        </template>
        <el-empty v-else-if="!paragraphLoading" description="暂无段落数据" :image-size="80" />
      </div>
      </div>
    </div>

    <!-- 导入向导 -->
    <ImportWizard
      v-model="importWizardVisible"
      :target-id="categoryId"
      :target-name="categoryInfo?.name || ''"
      @imported="handleImportComplete"
    />

    <!-- 编辑知识库名称对话框 -->
    <el-dialog v-model="editCategoryNameVisible" title="编辑知识库名称" width="400px" :close-on-click-modal="false">
      <el-input v-model="editCategoryNameValue" placeholder="请输入知识库名称" maxlength="50" show-word-limit />
      <template #footer>
        <el-button @click="editCategoryNameVisible = false">取消</el-button>
        <el-button type="primary" @click="saveCategoryName" :loading="editCategoryNameSaving">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onBeforeUnmount, computed, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import {
  Upload, RefreshRight, Refresh, Search, ArrowLeft,
  Document, View, Edit, Delete, ArrowDown, MoreFilled,
  CircleCheck, CircleClose, Loading, DataAnalysis, Notebook, Grid, Plus, PriceTag, ChatDotRound, Aim, Download, List,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import ImportWizard from './components/ImportWizard.vue'
import {
  getKnowledgeCategoriesApi,
  getGroupedDocumentsApi,
  updateDocumentApi,
  deleteDocumentApi,
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

const activeTab = ref((route.query.tab as string) || 'documents')

const navbarTabs = [
  { label: '文档列表', value: 'documents' },
  { label: '检索测试', value: 'test' },
  { label: '知识库设置', value: 'settings' },
]

const switchTab = (tab: string) => {
  activeTab.value = tab
  router.replace({ query: { tab } })
}

const goBack = () => {
  router.push('/admin/knowledge-categories')
}

// ===== 分类信息 =====
const categoryInfo = ref<any>(null)

// ===== 编辑知识库名称 =====
const editCategoryNameVisible = ref(false)
const editCategoryNameValue = ref('')
const editCategoryNameSaving = ref(false)

const startEditCategoryName = () => {
  editCategoryNameValue.value = categoryInfo.value?.name || ''
  editCategoryNameVisible.value = true
}

const saveCategoryName = async () => {
  if (!editCategoryNameValue.value.trim()) {
    ElMessage.warning('名称不能为空')
    return
  }
  editCategoryNameSaving.value = true
  try {
    await updateKnowledgeCategoryApi(categoryId, { name: editCategoryNameValue.value.trim() })
    if (categoryInfo.value) {
      categoryInfo.value.name = editCategoryNameValue.value.trim()
    }
    ElMessage.success('名称已更新')
    editCategoryNameVisible.value = false
  } catch {
    ElMessage.error('更新失败')
  } finally {
    editCategoryNameSaving.value = false
  }
}

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

// ===== 状态标签辅助 =====
const statusTagClass = (row: any) => {
  if (row.is_fully_embedded) return 'status-tag--success'
  if (row.vector_status === 'STARTED' || row.embedded_count > 0) return 'status-tag--warning'
  return 'status-tag--danger'
}

const statusTagText = (row: any) => {
  if (row.is_fully_embedded) return '已完成'
  if (row.vector_status === 'STARTED') return '向量化中'
  if (row.embedded_count > 0) return `${row.embedded_count}/${row.paragraph_count} 段`
  return '未向量化'
}

// ===== 数据加载 =====
const fetchCategoryInfo = async () => {
  try {
    const { data } = await getKnowledgeCategoriesApi()
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
  if (command === 'vectorize') {
    vectorizeDoc(row)
    return
  }

  if (command === 'rename') {
    startEditDoc(row)
    return
  }

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
const importWizardVisible = ref(false)

// ===== 异步上传任务追踪 =====
const activeTasks = ref<UploadTaskStatus[]>([])
let taskPollTimer: ReturnType<typeof setInterval> | null = null

const startTaskPolling = () => {
  if (taskPollTimer) return
  taskPollTimer = setInterval(async () => {
    try {
      const { data } = await getActiveTasksApi()
      const freshTasks = data || []
      const failedTasks = activeTasks.value.filter(task => task.status === 'failed')
      activeTasks.value = [...freshTasks, ...failedTasks.filter(ft => !freshTasks.some(t => t.id === ft.id))]
      if (freshTasks.length === 0 && failedTasks.length === 0) {
        stopTaskPolling()
        fetchDocuments()
      }
    } catch { /* ignore */ }
  }, 2000)
}

const stopTaskPolling = () => {
  if (taskPollTimer) { clearInterval(taskPollTimer); taskPollTimer = null }
}

const handleImportComplete = (taskIds?: string[]) => {
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

const visibleTasks = computed(() => activeTasks.value)

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

const getDocTags = (title: string): Tag[] => {
  return (getDocRow(title)?.tags || []) as Tag[]
}

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

// ===== 目录导航 (TOC) =====
interface TocItem {
  id: string
  label: string
  index: number
}

const tocCollapsed = ref(false)
const activeTocId = ref<string | null>(null)
let tocObserver: IntersectionObserver | null = null

const tocItems = computed<TocItem[]>(() => {
  return paragraphs.value.map((p, idx) => ({
    id: p.id,
    label: p.content.trim().replace(/\n/g, ' ').slice(0, 50),
    index: idx,
  }))
})

const scrollToTocItem = (id: string) => {
  activeTocId.value = id
  const el = document.getElementById(`para-${id}`)
  if (el) {
    const scrollContainer = document.querySelector('.para-page__scroll-area') as HTMLElement | null
    if (scrollContainer) {
      const containerTop = scrollContainer.getBoundingClientRect().top
      const targetTop = el.getBoundingClientRect().top - containerTop + scrollContainer.scrollTop - 12
      scrollContainer.scrollTo({ top: targetTop, behavior: 'smooth' })
    } else {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
}

const setupTocScrollSpy = () => {
  if (tocObserver) tocObserver.disconnect()
  activeTocId.value = null

  if (tocItems.value.length === 0) return

  const scrollArea = document.querySelector('.para-page__scroll-area') as HTMLElement | null
  if (!scrollArea) return

  tocObserver = new IntersectionObserver(
    (entries) => {
      const visibleEntries = entries.filter(e => e.isIntersecting).sort((a, b) => {
        const aRect = a.boundingClientRect
        const bRect = b.boundingClientRect
        return Math.abs(aRect.top) - Math.abs(bRect.top)
      })
      if (visibleEntries.length > 0) {
        const target = visibleEntries[0]
        const id = target.target.id.replace('para-', '')
        if (id !== activeTocId.value) {
          activeTocId.value = id
        }
      }
    },
    {
      root: scrollArea,
      rootMargin: '-60px 0px -60% 0px',
      threshold: 0,
    }
  )

  tocItems.value.forEach(item => {
    const el = document.getElementById(`para-${item.id}`)
    if (el) tocObserver.observe(el)
  })
}

const openParagraphDrawer = async (row: any) => {
  currentParagraphTitle.value = row.title
  paragraphViewVisible.value = true
  paragraphLoading.value = true
  paragraphs.value = []
  activeParagraphId.value = null
  activeTocId.value = null
  tocCollapsed.value = false
  paragraphSearchQuery.value = ''
  try {
    const { data } = await getDocumentParagraphsApi(categoryId, row.title)
    paragraphs.value = data?.paragraphs || []
    paragraphTotalChars.value = data?.totalChars || 0
    if (paragraphs.value.length > 0) activeParagraphId.value = paragraphs.value[0].id
    await nextTick()
    setupTocScrollSpy()
  } catch {
    ElMessage.error('获取段落失败')
  } finally {
    paragraphLoading.value = false
  }
}

const closeParagraphView = () => {
  paragraphViewVisible.value = false
  try { tocObserver?.disconnect() } catch (_) {}
  tocObserver = null
  editingParagraphId.value = null
  paragraphs.value = []
  paragraphSearchQuery.value = ''
  activeTocId.value = null
  tocCollapsed.value = false
  nextTick(() => { try { fetchDocuments() } catch (_) {} })
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

const handleExportParagraphs = () => {
  const headers = ['序号', '条款号', '内容', '字符数']
  const rows = paragraphs.value.map((p, i) => [
    i + 1,
    p.clauseId || '',
    p.content.replace(/,/g, '，').replace(/\n/g, ' '),
    p.content.length
  ])
  const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${currentParagraphTitle.value}_段落数据.csv`
  link.click()
  URL.revokeObjectURL(url)
}

// ===== 检索测试 =====
const hitTestLoading = ref(false)
const hitTestResult = ref<HitTestResult | null>(null)
const hitTestHistory = ref<string[]>([])
const hitTestForm = reactive({
  query: '',
  searchMode: 'hybrid' as 'vector' | 'keyword' | 'hybrid',
  topNumber: 10,
})

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
      const q = hitTestForm.query.trim()
      hitTestHistory.value = [q, ...hitTestHistory.value.filter(h => h !== q)].slice(0, 10)
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

const isTableContent = (content: string): boolean => {
  if (!content) return false
  const lines = content.split('\n').filter(l => l.trim())
  if (lines.length < 2) return false
  const hasSeparator = lines.some(l => /^\|[\s\-:|]+\|$/.test(l.trim()))
  if (!hasSeparator) return false
  const pipeLines = lines.filter(l => l.trim().startsWith('|'))
  return pipeLines.length >= 2
}

const stripBold = (text: string): string => text.replace(/\*\*(.+?)\*\*/g, '$1')

const parseTableLine = (line: string): string[] => {
  const trimmed = line.trim()
  if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
    return trimmed.split('|').slice(1, -1).map(c => stripBold(c.trim()))
  }
  const cells = trimmed.split('|').map(c => c.trim()).filter(c => c !== '')
  return cells.map(c => stripBold(c))
}

const renderTableHtml = (content: string): string => {
  const lines = content.split('\n').filter(l => l.trim())
  if (lines.length < 2) return escapeHtml(content)

  const isSeparator = (line: string): boolean => /^\|[\s\-:|]+$/.test(line.trim())

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
  height: 100%;
  display: flex;
  flex-direction: column;
  animation: page-enter 0.3s ease;
}
@keyframes page-enter {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ===== NavBar ===== */
.kd-navbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  height: 52px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--corp-border-light);
  flex-shrink: 0;
}
.kd-navbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 200px;
}
.kd-navbar__back {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--corp-border-light);
  background: var(--bg-surface);
  cursor: pointer;
  transition: all var(--corp-transition-fast);
  color: var(--corp-text-secondary);
}
.kd-navbar__back:hover {
  border-color: var(--corp-primary);
  color: var(--corp-primary);
  background: var(--color-primary-50);
}
.kd-navbar__name {
  font-size: var(--text-lg);
  font-weight: 700;
  color: var(--corp-text-primary);
  letter-spacing: -0.3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kd-navbar__center {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}
.kd-navbar__right {
  min-width: 200px;
}

.navbar-tabs {
  display: flex;
  gap: 4px;
  background: #f5f5f7;
  border-radius: 8px;
  padding: 3px;
}
.navbar-tab {
  padding: 6px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #666;
  cursor: pointer;
  transition: all 0.15s;
  border: none;
  background: transparent;
  font-family: inherit;
}
.navbar-tab:hover {
  background: rgba(0,0,0,0.04);
}
.navbar-tab.is-active {
  background: white;
  color: #1a1a2e;
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}

/* ===== 主内容区 ===== */
.kd-body {
  padding: 16px 20px;
  min-height: 0;
  overflow-y: auto;
}
.kd-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}
.kd-main--full {
  max-width: 900px;
}

/* ===== 知识库设置页 ===== */
.kd-settings-card__header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.kd-settings-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.kd-settings-name {
  font-size: var(--text-base);
  font-weight: 700;
  color: var(--corp-text-primary);
}
.kd-settings-name-edit {
  color: var(--corp-text-tertiary);
  cursor: pointer;
  transition: color var(--corp-transition-fast);
}
.kd-settings-name-edit:hover {
  color: var(--corp-primary);
}
.kd-settings-name-edit-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.kd-settings-name-edit-row .el-input {
  flex: 1;
  max-width: 240px;
}
.kd-settings-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  color: var(--corp-text-tertiary);
}
.kd-settings-hint-inline {
  font-size: 12px;
  color: var(--corp-text-tertiary);
  font-weight: 400;
}
.kd-settings-tip-inline {
  font-size: 11px;
  color: var(--corp-text-tertiary);
  margin-left: 6px;
  font-weight: 500;
}
.kd-settings-save-row {
  margin-top: 4px;
  padding-top: 12px;
  border-top: 1px solid var(--corp-border-light);
}

/* ===== 状态标签 (FastGPT MyTag 风格) ===== */
.status-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}
.status-tag__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.status-tag--success { background: #ecfdf5; color: #059669; }
.status-tag--success .status-tag__dot { background: #10b981; }
.status-tag--warning { background: #fffbeb; color: #d97706; }
.status-tag--warning .status-tag__dot { background: #f59e0b; }
.status-tag--danger { background: #fef2f2; color: #dc2626; }
.status-tag--danger .status-tag__dot { background: #ef4444; }

/* ===== 工具栏 ===== */
.kd-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.kd-toolbar__left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.kd-toolbar__title {
  font-size: var(--text-base);
  font-weight: 700;
  color: var(--corp-text-primary);
  white-space: nowrap;
}
.kd-toolbar__right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
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

/* ===== 文档名称单元格 ===== */
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

/* ===== 标签单元格 ===== */
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

/* ===== 标签弹窗 ===== */
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

/* ===== 分页 ===== */
.kd-pagination {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--space-4);
  border-top: 1px solid var(--corp-border-light);
}

/* ===== 上传进度条 ===== */
.upload-progress-bar {
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

/* ===== 检索测试 Tab 左右分栏 ===== */
.kd-test-layout {
  display: flex;
  gap: var(--space-6);
  min-height: 0;
}
.kd-test-left {
  flex: 0 0 468px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.kd-test-query :deep(.el-input__wrapper) {
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.kd-test-options {
  padding: var(--space-4);
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  border: 1px solid var(--corp-border-light);
}
.kd-test-history {
  margin-top: var(--space-2);
}
.kd-test-history__title {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--corp-text-secondary);
  margin-bottom: var(--space-2);
  padding: 0 var(--space-1);
}
.kd-test-history__item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--corp-transition-fast);
}
.kd-test-history__item:hover {
  background: var(--bg-surface-hover);
  color: var(--corp-primary);
}
.kd-test-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}
.kd-test-stats {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}
.kd-test-results {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.kd-test-result {
  background: var(--bg-surface);
  border-radius: var(--radius-md);
  padding: var(--space-4);
  border: 1px solid var(--corp-border-light);
}
.kd-test-result__header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.kd-test-result__rank {
  font-weight: 700;
  color: var(--color-primary-500);
  font-size: var(--text-sm);
  min-width: 28px;
}
.kd-test-result__title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--corp-text-primary);
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kd-test-result__scores {
  display: flex;
  gap: var(--space-1);
}
.kd-test-result__content {
  font-size: var(--text-sm);
  color: var(--corp-text-secondary);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  padding-left: 28px;
}
.kd-test-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  padding: var(--space-16) 0;
  color: var(--corp-text-tertiary);
  font-size: var(--text-sm);
}
.kd-test-placeholder p {
  margin: 0;
}

/* ===== 知识库设置 Tab ===== */
.kd-settings-card {
  margin-bottom: var(--space-3);
}
.kd-settings-card--compact :deep(.el-card__body) {
  padding: 16px 20px 12px;
}
.kd-settings-card--compact :deep(.el-card__header) {
  padding: 12px 20px;
}
.kd-settings-card__title {
  font-size: 14px;
  font-weight: 700;
  color: var(--corp-text-primary);
}
.kd-settings-form {
  max-width: 100%;
}
.kd-settings-form--inline {
  display: flex;
  flex-wrap: wrap;
  gap: 0 24px;
}
.kd-settings-form--inline :deep(.el-form-item) {
  margin-bottom: 10px;
  margin-right: 0;
}
.kd-settings-form--inline :deep(.el-form-item__label) {
  font-size: 13px;
  color: var(--corp-text-secondary);
  width: auto;
  padding-right: 8px;
}

/* ===== 段落全屏页 (FastGPT DataCard 1:1 复刻 + 左侧目录导航) ===== */
.para-page {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: #fff;
  display: flex;
  flex-direction: row;
  animation: page-enter 0.2s ease;
}

/* ===== 左侧目录导航 (TOC) ===== */
.para-toc {
  width: 220px;
  min-width: 220px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #fafbfc;
  border-right: 1px solid #e2e8f0;
  flex-shrink: 0;
  transition: width 0.25s ease, min-width 0.25s ease;
  overflow: hidden;
}
.para-toc--collapsed {
  width: 44px;
  min-width: 44px;
}
.para-toc__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid #e2e8f0;
  transition: background 0.15s;
  flex-shrink: 0;
}
.para-toc__header:hover {
  background: #edf2f7;
}
.para-toc__header-left {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #4a5568;
}
.para-toc__title {
  font-size: 13px;
  font-weight: 600;
  color: #2d3748;
}
.para-toc__count {
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: #3182ce;
  padding: 1px 6px;
  border-radius: 9999px;
}
.para-toc__toggle {
  color: #a0aec0;
  transition: transform 0.25s ease;
  flex-shrink: 0;
}
.para-toc__toggle.is-flipped {
  transform: rotate(180deg);
}

.para-toc__body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
.para-toc__body::-webkit-scrollbar {
  width: 4px;
}
.para-toc__body::-webkit-scrollbar-thumb {
  background: transparent;
}

.para-toc__item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  cursor: pointer;
  transition: all 0.15s ease;
  border-left: 3px solid transparent;
  color: #718096;
  font-size: 13px;
  line-height: 1.4;
}
.para-toc__item:hover {
  background: #edf2f7;
  color: #2d3748;
}
.para-toc__item--active {
  background: #ebf8ff;
  color: #3182ce;
  border-left-color: #3182ce;
  font-weight: 600;
}
.para-toc__item-index {
  flex-shrink: 0;
  width: 20px;
  text-align: right;
  font-size: 11px;
  color: #a0aec0;
  font-weight: 500;
}
.para-toc__item--active .para-toc__item-index {
  color: #3182ce;
}
.para-toc__item-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.para-toc__mini {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  overflow-y: auto;
}
.para-toc__mini-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cbd5e0;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}
.para-toc__mini-dot:hover {
  background: #a0aec0;
  transform: scale(1.3);
}
.para-toc__mini-dot--active {
  background: #3182ce;
  box-shadow: 0 0 0 3px rgba(49, 130, 206, 0.2);
  transform: scale(1.3);
}

/* ===== 右侧主内容区 ===== */
.para-page__main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.para-page__topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 24px;
  background: #fff;
  flex-shrink: 0;
  z-index: 20;
  position: relative;
}
.para-page__topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}
.para-page__topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.para-page__doc-name {
  font-size: 16px;
  font-weight: 600;
  color: #1a202c;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.para-page__badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #38a169;
  background: #f0fff4;
  padding: 2px 10px;
  border-radius: 9999px;
  white-space: nowrap;
}

.para-page__divider {
  padding: 0 24px;
}
.para-page__divider-line {
  height: 1px;
  background: #e2e8f0;
}

.para-page__stats-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 24px;
  flex-shrink: 0;
}
.para-page__stats-left {
  display: flex;
  align-items: center;
  gap: 6px;
}
.para-page__stats-text {
  font-size: 14px;
  font-weight: 500;
  color: #a0aec0;
}
.para-page__stats-dot {
  color: #cbd5e0;
  margin: 0 2px;
}
.para-page__search-input {
  width: 240px;
}
.para-page__search-input :deep(.el-input__wrapper) {
  background: #f7fafc;
  box-shadow: 0 0 0 1px #e2e8f0 inset;
}
.para-page__search-input :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px #cbd5e0 inset;
}

.para-page__scroll-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 20px;
}

.para-page__card-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* ===== FG Card (FastGPT Card 1:1 复刻) ===== */
.fg-card {
  cursor: pointer;
  user-select: none;
  padding: 12px;
  border-radius: 6px;
  border: 1px solid #e2e8f0;
  position: relative;
  overflow: hidden;
  transition: all 0.15s ease;
  background: #ebf8ff;
  box-shadow: none;
}
.fg-card--odd {
  background: #f7fafc;
}
.fg-card:hover {
  border-color: #3182ce;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  background: #bee3f8;
}
.fg-card--odd:hover {
  background: #edf2f7;
}
.fg-card--editing {
  border-color: #3182ce;
  background: #fff;
  box-shadow: 0 0 0 2px rgba(49, 130, 206, 0.2);
  cursor: default;
}

/* 悬浮标签 (FastGPT: header tag, MyTag borderFill) */
.fg-card__tag {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 1;
  display: flex;
  align-items: center;
  visibility: hidden;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 12px;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  gap: 6px;
  font-weight: 500;
}
.fg-card:hover .fg-card__tag {
  visibility: visible;
}
.fg-card__tag-index {
  color: #3182ce;
  font-weight: 700;
}
.fg-card__tag-id {
  color: #a0aec0;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 120px;
}

/* 内容区 (FastGPT: Box wordBreak fontSize=sm) */
.fg-card__content {
  word-break: break-all;
  font-size: 14px;
  line-height: 1.6;
  color: #1a202c;
  min-height: 28px;
}
.fg-card__text {
  white-space: pre-wrap;
}

.fg-card__table {
  overflow-x: auto;
  margin: 2px 0;
  border-radius: 4px;
  border: 1px solid #e2e8f0;
}
.fg-card__table :deep(.rendered-md-table) {
  width: 100%;
  min-width: max-content;
  border-collapse: collapse;
  font-size: 13px;
  line-height: 1.5;
}
.fg-card__table :deep(.rendered-md-table th),
.fg-card__table :deep(.rendered-md-table td) {
  padding: 7px 12px;
  border: 1px solid #e2e8f0;
  text-align: left;
  white-space: nowrap;
}
.fg-card__table :deep(.rendered-md-table th) {
  background: linear-gradient(135deg, #ebf8ff 0%, #bee3f8 100%);
  font-weight: 700;
  color: #1a202c;
  font-size: 12px;
  position: sticky;
  top: 0;
  z-index: 1;
}
.fg-card__table :deep(.rendered-md-table tr:nth-child(even)) {
  background: rgba(0, 0, 0, 0.02);
}
.fg-card__table :deep(.rendered-md-table td) {
  color: #718096;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fg-card__table :deep(.rendered-md-table td:empty)::after {
  content: '—';
  color: #a0aec0;
}

/* 编辑模式 */
.fg-card__editor {
  margin-top: 4px;
}
.fg-card__editor-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

/* 底部操作栏 (FastGPT: footer) */
.fg-card__footer {
  position: absolute;
  bottom: 6px;
  right: 6px;
  z-index: 1;
  display: flex;
  align-items: flex-end;
  visibility: hidden;
  font-size: 12px;
}
.fg-card:hover .fg-card__footer {
  visibility: visible;
}
.fg-card__footer-chars {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #fff;
  color: #718096;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  margin-right: 6px;
}
.fg-card__footer-del {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 4px;
  box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  color: #718096;
  cursor: pointer;
  transition: all 0.15s;
}
.fg-card__footer-del:hover {
  color: #e53e3e;
  border-color: #feb2b2;
  background: #fff5f5;
}
</style>
