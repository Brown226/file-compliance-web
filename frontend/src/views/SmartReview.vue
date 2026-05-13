<template>
  <div class="smart-review">
    <!-- 步骤条 - 参考项目风格 -->
    <div class="step-header">
      <div class="step-item" :class="{ active: currentStep >= 0, completed: currentStep > 0 }">
        <div class="step-circle">
          <span v-if="currentStep > 0">✓</span>
          <span v-else>1</span>
        </div>
        <span class="step-label">上传文件</span>
      </div>
      <div class="step-line" :class="{ active: currentStep >= 1 }"></div>
      <div class="step-item" :class="{ active: currentStep >= 1, completed: currentStep > 1 }">
        <div class="step-circle">
          <span v-if="currentStep > 1">✓</span>
          <span v-else>2</span>
        </div>
        <span class="step-label">确认信息并分析</span>
      </div>
      <div class="step-line" :class="{ active: currentStep >= 2 }"></div>
      <div class="step-item" :class="{ active: currentStep >= 2 }">
        <div class="step-circle">3</div>
        <span class="step-label">查看并编辑结果</span>
      </div>
    </div>

    <!-- Step 0: 上传区域（参考项目设计） -->
    <div v-if="currentStep === 0" class="upload-step">
      <div class="step-title">
        <h1 class="page-title">智能文件审查</h1>
        <p class="page-subtitle">上传您的文件，AI 将为您深度分析、识别风险、守护合规。</p>
      </div>

      <div class="upload-container">
        <!-- 待审文件上传区域（必选） -->
        <div class="primary-upload-section">
          <h3 class="section-title">
            <el-icon><Document /></el-icon>
            待审文件
            <el-tag type="danger" size="small">必选</el-tag>
          </h3>
          <el-upload
            ref="uploadRef"
            class="upload-dragger"
            drag
            multiple
            :auto-upload="false"
            :limit="10"
            :on-change="handleFileChange"
            :on-remove="handleFileRemove"
            :on-exceed="handleExceed"
            accept=".dwg,.doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx,.jpg,.png,.jpeg,.txt"
            :show-file-list="false"
          >
            <div class="upload-content">
              <el-icon :size="48" class="upload-icon"><UploadFilled /></el-icon>
              <div class="upload-text">
                <span class="upload-link">点击上传</span>
                <span>或将文件拖到此处</span>
              </div>
              <p class="upload-hint">支持 .docx .pdf .dwg .xls .ppt 格式</p>
            </div>
          </el-upload>

          <!-- 已选待审文件列表 -->
          <div v-if="fileList.length > 0" class="file-list-section">
            <div class="file-list">
              <div v-for="(file, index) in fileList" :key="index" class="file-item">
                <el-icon class="file-icon"><Document /></el-icon>
                <span class="file-name">{{ file.name }}</span>
                <span class="file-size">{{ formatFileSize(file.size || 0) }}</span>
                <el-button
                  type="danger"
                  text
                  size="small"
                  @click="removeFile(index)"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 参考文件上传区域（可选） -->
        <div class="reference-upload-section">
          <h3 class="section-title">
            <el-icon><Link /></el-icon>
            参考文件（用于以文审文）
            <el-tag type="info" size="small">可选</el-tag>
          </h3>
          <p class="section-description">
            上传参考文件作为审查依据，系统将基于参考文件对待审文件进行智能审查。
          </p>
          <el-upload
            ref="referenceUploadRef"
            class="reference-upload"
            drag
            multiple
            :auto-upload="false"
            :limit="5"
            :on-change="handleReferenceFileChange"
            :on-remove="handleReferenceFileRemove"
            accept=".dwg,.doc,.docx,.xls,.xlsx,.pdf,.ppt,.pptx,.txt"
            :show-file-list="false"
          >
            <div class="upload-content">
              <el-icon :size="36" class="upload-icon"><FolderAdd /></el-icon>
              <div class="upload-text">
                <span class="upload-link">选择参考文件</span>
                <span>或拖到此处</span>
              </div>
              <p class="upload-hint">支持 .docx .pdf .dwg 等格式，最多 5 个文件</p>
            </div>
          </el-upload>

          <!-- 已选参考文件列表 -->
          <div v-if="refFileList.length > 0" class="file-list-section">
            <div class="file-list">
              <div v-for="(file, index) in refFileList" :key="index" class="file-item reference-file">
                <el-icon class="file-icon"><Document /></el-icon>
                <span class="file-name">{{ file.name }}</span>
                <span class="file-size">{{ formatFileSize(file.size || 0) }}</span>
                <el-button
                  type="danger"
                  text
                  size="small"
                  @click="removeReferenceFile(index)"
                >
                  <el-icon><Delete /></el-icon>
                </el-button>
              </div>
            </div>
          </div>
        </div>

        <!-- 下一步按钮 -->
        <div class="step-actions">
          <el-button
            type="primary"
            size="large"
            :disabled="fileList.length === 0"
            @click="goToStep1"
          >
            下一步：确认信息并分析
          </el-button>
        </div>
      </div>
    </div>

    <!-- Step 1: 预审配置 - 参考项目左右分栏布局 -->
    <div v-if="currentStep === 1" class="confirm-step">
      <!-- 后台上传/预分析状态横幅 -->
      <el-alert
        v-if="backgroundStatus === 'uploading'"
        title="正在上传文件..."
        type="info"
        :closable="false"
        show-icon
        class="background-status-alert"
      >
        <template #default>
          <span>文件正在后台上传，您可以先配置审查参数，上传完成后将自动开始AI预分析。</span>
        </template>
      </el-alert>
      <el-alert
        v-else-if="backgroundStatus === 'pre-analyzing'"
        title="正在AI预分析..."
        type="warning"
        :closable="false"
        show-icon
        class="background-status-alert"
      >
        <template #default>
          <span>AI 正在分析您的文件内容并生成推荐配置，您可以先手动选择审查参数。</span>
        </template>
      </el-alert>
      <el-alert
        v-else-if="backgroundStatus === 'done'"
        title="预分析完成"
        type="success"
        :closable="true"
        show-icon
        @close="backgroundStatus = 'idle'"
        class="background-status-alert"
      >
        <template #default>
          <span>AI 预分析已完成，推荐配置已自动填入下方表单。</span>
        </template>
      </el-alert>
      <el-alert
        v-else-if="backgroundStatus === 'failed'"
        title="预分析失败"
        type="error"
        :closable="true"
        show-icon
        @close="backgroundStatus = 'idle'"
        class="background-status-alert"
      >
        <template #default>
          <span>AI 预分析失败，不影响正常使用。请手动配置后点击"开始分析"。</span>
        </template>
      </el-alert>

      <div class="confirm-content">
        <!-- 任务标题 -->
        <div class="title-input-section">
          <el-input
            v-model="form.title"
            placeholder="请输入任务标题，例如：XX项目施工图审查"
            size="large"
            clearable
            maxlength="100"
            show-word-limit
          />
        </div>

        <!-- 文件上传成功提示 -->
        <div class="upload-success">
          <p class="success-text">文件 <span class="file-name">{{ fileList.length }} 个文件</span> 已上传成功。</p>
          <p class="ai-hint" v-if="preAnalysisData.contractType">AI初步识别文件类型为：<span class="type-text">{{ preAnalysisData.contractType }}</span></p>
          <p class="ai-hint" v-else-if="!preAnalyzed">
            <el-icon class="is-loading"><Loading /></el-icon>
            AI 正在识别文件类型...
          </p>
        </div>

        <!-- 左右分栏：审查立场 + 审查范围 -->
        <div class="config-grid">
          <!-- 左侧：审查立场 -->
          <div class="config-panel">
            <h3 class="panel-title">1. 选择您的审查立场</h3>
            <p class="panel-desc">AI将基于您的立场进行侧重分析。</p>
            <el-select 
              v-model="config.perspective" 
              placeholder="请选择您的立场" 
              class="w-full" 
              filterable 
              allow-create
              style="width: 100%; margin-top: 16px;"
            >
              <el-option label="建设方" value="builder" />
              <el-option label="施工方" value="contractor" />
              <el-option label="监理方" value="supervisor" />
              <el-option label="设计方" value="designer" />
              <el-option label="通用审查" value="general" />
            </el-select>
          </div>

          <!-- 右侧：审查范围 -->
          <div class="config-panel">
            <h3 class="panel-title">2. 确认审查范围</h3>
            <p class="panel-desc">默认已全选AI建议的审查点。</p>
            <div class="template-select">
              <label class="select-label">审查模板</label>
              <el-select v-model="selectedTemplateId" placeholder="选择审查模板" style="width: 100%; margin-top: 8px;">
                <el-option
                  v-for="template in reviewTemplates"
                  :key="template.id"
                  :label="template.name"
                  :value="template.id"
                />
              </el-select>
            </div>
            <div class="panel-actions">
              <el-button @click="goBackToUpload">重新上传</el-button>
              <el-button 
                type="primary" 
                :disabled="!config.perspective"
                @click="startAnalysis"
              >
                开始分析
              </el-button>
            </div>
          </div>
        </div>

        <!-- 底部：审查点及核心目的 -->
        <div class="review-options-panel">
          <h3 class="panel-title">审查点及核心目的</h3>
          
          <!-- 审查点选择 -->
          <div class="review-points-section">
            <h4 class="section-label">审查点选择 (可多选)</h4>
            <el-checkbox-group v-model="selectedReviewPoints" class="review-points-group">
              <el-checkbox
                v-for="point in allSuggestedReviewPoints"
                :key="point"
                :label="point"
                :value="point"
                border
              ></el-checkbox>
            </el-checkbox-group>
          </div>

          <!-- 审查核心目的 -->
          <div class="review-purposes-section">
            <h4 class="section-label">审查核心目的 (可自定义)</h4>
            <div v-for="(purpose, index) in customPurposes" :key="index" class="purpose-row">
              <el-autocomplete
                v-model="purpose.value"
                :fetch-suggestions="querySearchCorePurposes"
                placeholder="搜索或输入新目的"
                class="w-full"
                trigger-on-focus
              ></el-autocomplete>
              <el-button 
                type="primary" link
                @click="removePurpose(index)"
                class="remove-btn"
              >
                <el-icon><RemoveFilled /></el-icon>
              </el-button>
            </div>
            <el-button 
              type="primary" link
              @click="addPurpose" 
              class="add-purpose-btn"
            >
              <el-icon><CirclePlusFilled /></el-icon>
              添加目的
            </el-button>
          </div>
        </div>

        <!-- 审查项选择（需求驱动） -->
        <div class="review-items-section">
          <h3 class="panel-title">选择审查内容</h3>
          <p class="panel-desc">系统已根据文件特征自动配置，您可按需调整。</p>

          <div class="review-items-list">
            <!-- 规范性审查 -->
            <div class="review-item">
              <div class="review-item-main">
                <el-switch v-model="reviewItems.standardReview.enabled" />
                <div class="review-item-info">
                  <div class="review-item-title">
                    规范性审查
                    <el-tag v-if="reviewItems.standardReview.recommended" size="small" type="success" effect="plain">AI 推荐</el-tag>
                  </div>
                  <div class="review-item-desc">对照标准规范检查文件合规性，基于知识库进行 RAG 检索审查</div>
                </div>
              </div>
              <div v-if="reviewItems.standardReview.enabled" class="review-item-config">
                <el-select v-model="reviewItems.standardReview.knowledgeCategoryIds" placeholder="选择知识库（可多选）" style="width: 100%" multiple collapse-tags collapse-tags-tooltip>
                  <el-option v-for="kb in knowledgeCategories" :key="kb.id" :label="kb.name" :value="kb.id" />
                </el-select>
                <div v-if="reviewItems.standardReview.reason" class="config-reason">
                  <el-icon><InfoFilled /></el-icon>
                  {{ reviewItems.standardReview.reason }}
                </div>
              </div>
            </div>

            <!-- 参照比对 -->
            <div class="review-item" :class="{ disabled: refFileList.length === 0 }">
              <div class="review-item-main">
                <el-switch v-model="reviewItems.docCompare.enabled" :disabled="refFileList.length === 0" />
                <div class="review-item-info">
                  <div class="review-item-title">
                    参照比对
                    <el-tag v-if="refFileList.length > 0" size="small" type="primary" effect="plain">已上传 {{ refFileList.length }} 个参照文件</el-tag>
                    <el-tag v-else size="small" type="info" effect="plain">需上传参照文件</el-tag>
                  </div>
                  <div class="review-item-desc">将待审文件与参照文件（指导书、参数规范书等）进行比对，检查是否符合参照文件要求</div>
                </div>
              </div>
              <div v-if="reviewItems.docCompare.enabled && refFileList.length > 0" class="review-item-config">
                <div class="config-reason">
                  <el-icon><InfoFilled /></el-icon>
                  参照文件将作为比对基准，逐份检查待审文件与参照文件的差异和不一致
                </div>
              </div>
            </div>

            <!-- 文件内一致性 -->
            <div class="review-item">
              <div class="review-item-main">
                <el-switch v-model="reviewItems.intraFileConsistency.enabled" />
                <div class="review-item-info">
                  <div class="review-item-title">
                    文件内一致性
                    <el-tag v-if="reviewItems.intraFileConsistency.recommended" size="small" type="success" effect="plain">AI 推荐</el-tag>
                  </div>
                  <div class="review-item-desc">检查每个文件内部的参数值、语义描述是否前后一致，避免上下文出现数值矛盾或描述冲突</div>
                </div>
              </div>
              <div v-if="reviewItems.intraFileConsistency.enabled" class="review-item-config">
                <div class="config-reason">
                  <el-icon><InfoFilled /></el-icon>
                  例如：同一参数在不同位置值不一致（温度 100 vs 50），同一人物描述矛盾（工程师 vs 学生）
                </div>
              </div>
            </div>

            <!-- 文字校对 -->
            <div class="review-item">
              <div class="review-item-main">
                <el-switch v-model="reviewItems.typoCheck.enabled" />
                <div class="review-item-info">
                  <div class="review-item-title">
                    文字校对
                    <el-tag v-if="reviewItems.typoCheck.recommended" size="small" type="success" effect="plain">AI 推荐</el-tag>
                  </div>
                  <div class="review-item-desc">检查错别字、语法错误、术语一致性，使用纯 LLM + 术语库进行校对</div>
                </div>
              </div>
            </div>

            <!-- 图纸识别 -->
            <div v-if="hasDrawingFiles" class="review-item">
              <div class="review-item-main">
                <el-switch v-model="reviewItems.drawingRecognition.enabled" />
                <div class="review-item-info">
                  <div class="review-item-title">
                    图纸识别
                    <el-tag size="small" type="warning" effect="plain">检测到图纸文件</el-tag>
                  </div>
                  <div class="review-item-desc">表格结构化、公式识别、图纸智能分析，使用多模态 AI 进行深度解析</div>
                </div>
              </div>
            </div>

            <!-- 规则库检查 -->
            <div class="review-item" :class="{ disabled: ruleLibraries.length === 0 }">
              <div class="review-item-main">
                <el-switch v-model="reviewItems.ruleLibrary.enabled" :disabled="ruleLibraries.length === 0" />
                <div class="review-item-info">
                  <div class="review-item-title">
                    规则库检查
                    <el-tag v-if="ruleLibraries.length === 0" size="small" type="info" effect="plain">系统无规则库</el-tag>
                    <el-tag v-if="reviewItems.ruleLibrary.recommended" size="small" type="success" effect="plain">AI 推荐</el-tag>
                  </div>
                  <div class="review-item-desc">按规则库条目逐条检查（格式、命名、编码等），不调用 AI</div>
                </div>
              </div>
              <div v-if="reviewItems.ruleLibrary.enabled && ruleLibraries.length > 0" class="review-item-config">
                <el-select v-model="reviewItems.ruleLibrary.ruleLibraryId" placeholder="选择规则库" style="width: 100%">
                  <el-option v-for="rl in ruleLibraries" :key="rl.id" :label="rl.name" :value="rl.id" />
                </el-select>
                <div v-if="reviewItems.ruleLibrary.reason" class="config-reason">
                  <el-icon><InfoFilled /></el-icon>
                  {{ reviewItems.ruleLibrary.reason }}
                </div>
              </div>
            </div>
          </div>

          <!-- 高级选项 -->
          <div class="advanced-section">
            <div class="advanced-toggle" @click="advancedOpen = !advancedOpen">
              <el-icon><ArrowDown v-if="!advancedOpen" /><ArrowUp v-else /></el-icon>
              <span>高级选项</span>
              <span v-if="manualMode" class="manual-mode-hint">手动模式: {{ MODE_DISPLAY_NAMES[manualMode] || manualMode }}</span>
            </div>
            <div v-if="advancedOpen" class="advanced-content">
              <p class="advanced-hint">手动指定审查模式（覆盖自动推荐）</p>
              <el-radio-group v-model="manualMode" class="mode-radio-group">
                <el-radio value="">自动推荐（{{ derivedModeDisplay }}）</el-radio>
                <el-radio value="FULL_REVIEW">全量审查</el-radio>
                <el-radio value="LIBRARY_REVIEW">以库审文</el-radio>
                <el-radio value="DOC_REVIEW">以文审文</el-radio>
                <el-radio value="CONSISTENCY">全文一致性</el-radio>
                <el-radio value="TYPO_GRAMMAR">错别字/语法</el-radio>
                <el-radio value="MULTIMODAL">多模态识别</el-radio>
                <el-radio value="CUSTOM_RULE">自定义规则</el-radio>
              </el-radio-group>
              <div v-if="manualMode" class="config-reason" style="margin-top: 8px;">
                <el-icon><InfoFilled /></el-icon>
                手动模式已覆盖自动推荐，审查策略由您指定
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Step 2: 审查中/结果展示 -->
    <div v-if="currentStep === 2" class="review-step">
      <div class="review-header">
        <h2 class="review-title">AI 审查报告</h2>
        <div class="review-actions">
          <el-switch v-model="showPlainLanguage" active-text="大白话模式" />
          <el-button @click="exportWord">导出Word</el-button>
          <el-button @click="exportExcel">导出Excel</el-button>
          <el-button @click="goBackToConfirm">返回修改配置</el-button>
        </div>
      </div>

      <!-- Tab导航 -->
      <el-tabs v-model="activeAiTab" class="review-tabs">
        <el-tab-pane label="总览" name="summary">
          <div class="tab-content">
            <h3>争议点</h3>
            <div v-if="reviewData.dispute_points?.length" class="issues-list">
              <div v-for="(item, index) in reviewData.dispute_points" :key="index" class="issue-card">
                <p class="issue-title">{{ disputeTitle(item, index) }}</p>
                <p class="issue-desc">{{ disputeDescription(item) }}</p>
              </div>
            </div>
            <div v-else class="empty-state">未发现争议点</div>

            <h3 style="margin-top: 24px;">缺失条款</h3>
            <div v-if="reviewData.missing_clauses?.length" class="issues-list">
              <div v-for="(item, index) in reviewData.missing_clauses" :key="index" class="issue-card">
                <p class="issue-title">{{ missingClauseTitle(item, index) }}</p>
                <p class="issue-desc">{{ item.description || '该条款缺失，建议补充' }}</p>
              </div>
            </div>
            <div v-else class="empty-state">条款完整</div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="修改" name="modification">
          <div class="tab-content">
            <!-- 批量操作栏 -->
            <div v-if="reviewData.modification_suggestions?.length" class="batch-actions-bar">
              <el-checkbox
                :model-value="allSelected"
                :indeterminate="batchPartialSelected"
                @change="toggleAll"
              >
                全选 ({{ batchSelectedCount }}/{{ reviewData.modification_suggestions.length }})
              </el-checkbox>
              <el-button
                type="primary"
                size="small"
                :disabled="batchSelectedCount === 0"
                @click="batchAdopt"
              >
                一键采纳所选 ({{ batchSelectedCount }})
              </el-button>
            </div>

            <div v-if="reviewData.modification_suggestions?.length" class="suggestions-list">
              <div v-for="(item, index) in reviewData.modification_suggestions" :key="index" class="suggestion-card" :class="{ 'batch-selected': batchSelected.has(index) }">
                <div class="suggestion-header">
                  <el-checkbox
                    :model-value="batchSelected.has(index)"
                    @change="toggleItem(index)"
                  />
                  <p class="suggestion-title">{{ suggestionTitle(item, index) }}</p>
                </div>
                
                <!-- 大白话模式 -->
                <div v-if="showPlainLanguage" class="plain-language-box">
                  <p class="plain-label">📢 大白话建议：</p>
                  <p class="plain-text">{{ item.plain_language || suggestionReason(item) }}</p>
                </div>

                <!-- 详细模式 -->
                <div v-else class="detail-mode">
                  <div class="detail-item">
                    <p class="detail-label">原文：</p>
                    <blockquote class="detail-quote original">{{ suggestionOriginal(item) || 'AI 未返回可直接定位的原文，请参考建议条款手动核对。' }}</blockquote>
                  </div>
                  <div class="detail-item">
                    <p class="detail-label">建议：</p>
                    <blockquote class="detail-quote suggested">{{ suggestionText(item) }}</blockquote>
                  </div>
                  <div class="detail-item">
                    <p class="detail-label">理由：</p>
                    <p class="detail-reason">{{ suggestionReason(item) }}</p>
                  </div>
                </div>
                
                <div class="suggestion-actions">
                  <el-button size="small" @click="previewSuggestion(item)">查看变更</el-button>
                  <el-button 
                    size="small" 
                    type="primary"
                    @click="adoptSuggestion(item)"
                  >
                    {{ item.adopted ? '已采纳' : '一键采纳建议' }}
                  </el-button>
                </div>
              </div>
            </div>
            <div v-else class="empty-state">未发现修改建议</div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="依据" name="laws">
          <div class="tab-content">
            <h3>相关法律依据</h3>
            <div v-if="reviewData.relevant_laws?.length" class="laws-list">
              <div v-for="(item, index) in reviewData.relevant_laws" :key="index" class="law-card">
                <p class="law-title">{{ item.law || item.title }}</p>
                <p class="law-clause">{{ item.clause || item.article }}</p>
                <p class="law-content">{{ item.content }}</p>
              </div>
            </div>
            <div v-else class="empty-state">未检索到相关法律依据</div>
          </div>
        </el-tab-pane>

        <el-tab-pane label="工作台" name="workspace">
          <div class="tab-content">
            <div class="workspace-section">
              <h3>选中文本专项审查</h3>
              <el-input
                v-model="focusedReviewText"
                type="textarea"
                :rows="6"
                placeholder="可从左侧选中文本后读取，也可手动粘贴某一条款或段落"
              />
              <el-input
                v-model="focusedReviewQuestion"
                placeholder="专项问题，例如：审查这段条款是否合规，并给出修改建议"
                style="margin-top: 12px;"
              />
              <div class="workspace-actions">
                <el-button 
                  type="primary" 
                  :disabled="focusedReviewLoading || !focusedReviewText.trim()"
                  @click="submitFocusedReview"
                >
                  {{ focusedReviewLoading ? '审查中...' : '开始专项审查' }}
                </el-button>
              </div>
            </div>

            <div v-if="focusedReviewResult" class="focused-result">
              <h3>专项审查结论</h3>
              <p class="result-summary">{{ focusedReviewResult.risk_summary }}</p>
              <div v-if="focusedReviewResult.plain_language" class="plain-language-box">
                <p class="plain-label">大白话说明</p>
                <p class="plain-text">{{ focusedReviewResult.plain_language }}</p>
              </div>
              <div v-if="focusedReviewResult.suggested_text" class="suggested-text-box">
                <p class="detail-label">建议替换文本</p>
                <p class="suggested-text">{{ focusedReviewResult.suggested_text }}</p>
              </div>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 加载遮罩 -->
    <div v-if="loading && currentStep < 2" class="loading-overlay">
      <div class="loading-content">
        <p class="loading-title">{{ loadingMessage }}</p>
        <div v-if="analysisProgress.length" class="analysis-progress-steps">
          <div
            v-for="(item, index) in visibleAnalysisProgress"
            :key="index"
            class="progress-step"
            :class="`progress-step--${progressStatusClass(item.status)}`"
          >
            <div class="progress-marker">
              <span v-if="item.status === 'completed'">✓</span>
              <span v-else-if="item.status === 'failed'">!</span>
            </div>
            <div class="progress-info">
              <div class="progress-title">
                <span>{{ progressStepLabel(item.step) }}</span>
                <span class="progress-status">{{ progressStatusLabel(item.status) }}</span>
              </div>
              <p v-if="item.message" class="progress-message">{{ item.message }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 采纳预览对话框 -->
    <el-dialog
      v-model="previewDialogVisible"
      title="采纳变更预览"
      width="720px"
      :close-on-click-modal="false"
    >
      <div v-if="previewItem" class="preview-compare">
        <div class="preview-panel preview-before">
          <div class="preview-panel-header">
            <span class="preview-badge badge-before">采纳前</span>
          </div>
          <div class="preview-panel-body">
            <p>{{ suggestionOriginal(previewItem) || '（原文未提取）' }}</p>
          </div>
        </div>
        <div class="preview-arrow">→</div>
        <div class="preview-panel preview-after">
          <div class="preview-panel-header">
            <span class="preview-badge badge-after">采纳后</span>
          </div>
          <div class="preview-panel-body">
            <p>{{ suggestionText(previewItem) }}</p>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="previewDialogVisible = false">关闭</el-button>
        <el-button type="primary" @click="adoptFromPreview">
          {{ previewItem?.adopted ? '已采纳' : '采纳此建议' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import type { UploadFile, FormInstance, FormRules } from 'element-plus'
import {
  Upload, UploadFilled, Check, MagicStick, InfoFilled, VideoPlay,
  RemoveFilled, CirclePlusFilled, Document, Link, FolderAdd, Delete,
  Loading, ArrowDown, ArrowUp,
} from '@element-plus/icons-vue'
import { createTaskApi, preAnalyzeApi, uploadOnlyApi, exportTaskReportApi, exportTaskReportWordApi } from '@/api/task'
import { getAllKnowledgeCategoriesApi } from '@/api/knowledge-category'
import { getRuleLibrariesApi } from '@/api/rule-library'
import { useUserStore } from '@/stores/user'
import DwgPreview from '@/components/DwgPreview.vue'

const router = useRouter()
const userStore = useUserStore()
const formRef = ref<FormInstance>()

// ===== 步骤控制 =====
const currentStep = ref(0) // 0: 上传, 1: 确认, 2: 审查中

// ===== 文件上传 =====
const fileList = ref<UploadFile[]>([])
const uploadRef = ref()
const refFileList = ref<UploadFile[]>([])
const referenceUploadRef = ref()
const dwgParsedDataMap = ref<Record<string, any>>({})

const totalFileSize = computed(() =>
  fileList.value.reduce((sum, f) => sum + (f.size || 0), 0) +
  refFileList.value.reduce((sum, f) => sum + (f.size || 0), 0)
)

const dwgPreviewFiles = computed(() =>
  fileList.value.filter(f => f.name.toLowerCase().endsWith('.dwg') && f.raw)
)

const handleFileChange = (_file: UploadFile, newFileList: UploadFile[]) => {
  fileList.value = newFileList
}
const handleFileRemove = (_file: UploadFile, newFileList: UploadFile[]) => {
  fileList.value = newFileList
}
const handleExceed = (files: File[], fileList: File[]) => {
  ElMessage.warning(`最多只能选择 10 个待审文件。当前已选择 ${fileList.length} 个文件。`)
}
const removeFile = (index: number) => {
  fileList.value.splice(index, 1)
}

const handleReferenceFileChange = (_file: UploadFile, newFileList: UploadFile[]) => {
  refFileList.value = newFileList
}
const handleReferenceFileRemove = (_file: UploadFile, newFileList: UploadFile[]) => {
  refFileList.value = newFileList
}
const removeReferenceFile = (index: number) => {
  refFileList.value.splice(index, 1)
}

const onDwgParsed = (fileName: string, data: any) => {
  dwgParsedDataMap.value[fileName] = data
}
const onDwgParseError = (fileName: string, _err: any) => {
  console.warn('[SmartReview] DWG parse error:', fileName)
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

// ===== 表单 =====
const form = reactive({ title: '' })
const rules: FormRules = {
  title: [{ required: true, message: '请输入任务标题', trigger: 'blur' }],
}

// ===== 预分析 =====
const preAnalyzed = ref(false)
const preAnalyzing = ref(false)
const preAnalysisData = reactive({
  contractType: '',
  potentialParties: [] as string[],
  suggestedReviewPoints: [] as string[],
  suggestedCorePurposes: [] as string[],
})

let preAnalyzeTimer: ReturnType<typeof setTimeout> | null = null

// 监听文件列表变化，后台进行预分析（不自动跳转步骤）
// 仅在已在步骤1时触发（如用户返回重新上传），步骤0的预分析由 goToStep1 处理
watch(fileList, (newList) => {
  if (preAnalyzeTimer) clearTimeout(preAnalyzeTimer)
  if (newList.length > 0) {
    // 标记预分析未完成（因为文件列表变化了）
    preAnalyzed.value = false
    preAnalyzing.value = true

    // 仅在已在步骤1时自动触发预分析（用户返回修改文件的场景）
    if (currentStep.value === 1) {
      preAnalyzeTimer = setTimeout(() => runPreAnalysis(newList), 800)
    }
  } else {
    // 文件列表为空时，重置预分析状态
    preAnalyzed.value = false
    preAnalyzing.value = false
  }
}, { deep: true })

// 使用服务器文件名进行预分析
const runPreAnalysisWithServerFiles = async (serverFiles: Array<{ name: string; size: number }>) => {
  preAnalyzing.value = true
  try {
    const { data } = await preAnalyzeApi(serverFiles)
    applyPreAnalysisData(data)
    preAnalyzed.value = true
    console.log('[SmartReview] 服务器文件预分析成功')
  } catch (e) {
    console.warn('[SmartReview] 服务器文件预分析失败:', e)
    // 不设置 preAnalyzed.value = true，让调用方决定是否降级
    throw e
  } finally {
    preAnalyzing.value = false
  }
}

// 应用预分析数据到界面
const applyPreAnalysisData = (data: any) => {
  console.log('[SmartReview] applyPreAnalysisData 接收到的数据:', JSON.stringify({
    suggestedReviewPoints: data.suggestedReviewPoints,
    suggestedCorePurposes: data.suggestedCorePurposes,
    contractType: data.contractType,
    documentTypeLabel: data.documentTypeLabel,
    recommendations: data.recommendations,
  }, null, 2))

  // 应用推荐结果
  if (data.suggestedPerspective) {
    config.perspective = data.suggestedPerspective
  }
  // 兼容两种字段名：contractType 或 documentType
  if (data.contractType) {
    preAnalysisData.contractType = data.contractType
  } else if (data.documentTypeLabel) {
    preAnalysisData.contractType = data.documentTypeLabel
  }

  // 根据预分析结果设置审查项
  const rec = data.recommendations
  if (!rec) {
    console.log('[SmartReview] 无推荐数据，跳过审查项设置')
    return
  }

  // 规范性审查
  reviewItems.standardReview.recommended = !!rec.libraryReview?.enabled
  reviewItems.standardReview.reason = rec.libraryReview?.reason || ''
  if (rec.libraryReview?.categoryId) {
    reviewItems.standardReview.knowledgeCategoryIds = [rec.libraryReview.categoryId]
  }

  // 参照比对（由 refFileList 驱动，无需预分析推荐）
  reviewItems.docCompare.enabled = refFileList.value.length > 0

  // 文件内一致性
  reviewItems.intraFileConsistency.recommended = !!rec.generalChecks?.crossFileCheck?.enabled
  if (rec.generalChecks?.crossFileCheck?.enabled) {
    reviewItems.intraFileConsistency.enabled = true
  }

  // 文字校对
  reviewItems.typoCheck.recommended = !!rec.generalChecks?.typoCheck?.enabled
  if (rec.generalChecks?.typoCheck?.enabled) {
    reviewItems.typoCheck.enabled = true
  }

  // 规则库检查
  reviewItems.ruleLibrary.recommended = !!rec.ruleLibrary?.enabled
  reviewItems.ruleLibrary.reason = rec.ruleLibrary?.reason || ''
  if (rec.ruleLibrary?.libraryId) {
    reviewItems.ruleLibrary.ruleLibraryId = rec.ruleLibrary.libraryId
  }

  // 保存推荐理由
  preAnalysisReasons.value = {
    library: rec.libraryReview?.reason,
    ruleLibrary: rec.ruleLibrary?.reason,
    typo: rec.generalChecks?.typoCheck?.reason,
    crossFile: rec.generalChecks?.crossFileCheck?.reason,
  }

  // 更新预分析数据
  const suggestedPoints = data.suggestedReviewPoints || []
  console.log('[SmartReview] suggestedReviewPoints 长度:', suggestedPoints.length, '内容:', suggestedPoints)
  if (suggestedPoints.length > 0) {
    preAnalysisData.suggestedReviewPoints = suggestedPoints
    allSuggestedReviewPoints.value = [...suggestedPoints]
    selectedReviewPoints.value = [...suggestedPoints]
    console.log('[SmartReview] 已更新审查点为AI生成的值')
  } else {
    console.warn('[SmartReview] suggestedReviewPoints 为空，保持默认值')
  }
  
  const suggestedPurposes = data.suggestedCorePurposes || []
  console.log('[SmartReview] suggestedCorePurposes 长度:', suggestedPurposes.length, '内容:', suggestedPurposes)
  if (suggestedPurposes.length > 0) {
    preAnalysisData.suggestedCorePurposes = suggestedPurposes
    allSuggestedCorePurposes.value = [...suggestedPurposes]
    customPurposes.value = suggestedPurposes.map((p: string) => ({ value: p }))
    console.log('[SmartReview] 已更新核心目的为AI生成的值')
  } else {
    console.warn('[SmartReview] suggestedCorePurposes 为空，保持默认值')
  }
}

const runPreAnalysis = async (files: UploadFile[]) => {
  preAnalyzing.value = true
  try {
    const fileListData = files.map(f => ({ name: f.name, size: f.size || 0 }))
    const { data } = await preAnalyzeApi(fileListData)
    applyPreAnalysisData(data)
    preAnalyzed.value = true
    console.log('[SmartReview] 原始文件预分析成功')
  } catch (e) {
    console.warn('[SmartReview] 原始文件预分析失败:', e)
    // 不设置 preAnalyzed.value = true，让调用方处理
    throw e
  } finally {
    preAnalyzing.value = false
  }
}

// 下一步：进入预审配置（非阻塞，立即跳转，后台上传+预分析）
const goToStep1 = () => {
  console.log('[SmartReview] goToStep1 被调用')
  console.log('[SmartReview] fileList.length:', fileList.value.length)
  console.log('[SmartReview] preAnalyzed.value:', preAnalyzed.value)

  if (fileList.value.length === 0) {
    ElMessage.warning('请至少选择一个待审文件')
    return
  }

  // 立即跳转到步骤1
  currentStep.value = 1

  // 如果已经预分析过，不需要再做
  if (preAnalyzed.value) {
    backgroundStatus.value = 'idle'
    return
  }

  // 后台启动上传+预分析流程（fire-and-forget）
  backgroundStatus.value = 'uploading'
  ;(async () => {
    try {
      console.log('[SmartReview] 后台开始上传文件...')
      const uploadedFileNames = await uploadFilesForPreAnalysis()
      console.log('[SmartReview] 后台上传完成，返回文件:', uploadedFileNames)
      backgroundUploadedServerFiles.value = uploadedFileNames || []

      if (uploadedFileNames && uploadedFileNames.length > 0) {
        backgroundStatus.value = 'pre-analyzing'
        console.log('[SmartReview] 后台开始预分析...')
        await runPreAnalysisWithServerFiles(uploadedFileNames)
      } else {
        throw new Error('文件上传返回空列表')
      }

      backgroundStatus.value = 'done'
      ElMessage.success('AI 预分析完成，已自动填入推荐配置')
      // 3秒后自动隐藏状态提示
      if (backgroundStatusHideTimer) clearTimeout(backgroundStatusHideTimer)
      backgroundStatusHideTimer = setTimeout(() => {
        backgroundStatus.value = 'idle'
      }, 3000)
    } catch (err) {
      console.error('[SmartReview] 后台预分析失败:', err)
      // 降级：使用原始文件名进行预分析
      try {
        backgroundStatus.value = 'pre-analyzing'
        await runPreAnalysis(fileList.value)
        backgroundStatus.value = 'done'
        ElMessage.success('AI 预分析完成（降级模式）')
        if (backgroundStatusHideTimer) clearTimeout(backgroundStatusHideTimer)
        backgroundStatusHideTimer = setTimeout(() => {
          backgroundStatus.value = 'idle'
        }, 3000)
      } catch (preErr) {
        console.error('[SmartReview] 降级预分析也失败:', preErr)
        backgroundStatus.value = 'failed'
        ElMessage.warning('预分析失败，您可手动配置后直接开始分析')
      }
    }
  })()
}

// 轻量级文件上传（仅用于预分析，不需要创建任务）
const uploadFilesForPreAnalysis = async (): Promise<Array<{ name: string; size: number }>> => {
  const formData = new FormData()
  
  // 添加待审文件
  for (const file of fileList.value) {
    if (file.raw) {
      formData.append('files', file.raw)
    }
  }
  
  // 添加参照文件（如果有）
  for (const refFile of refFileList.value) {
    if (refFile.raw) {
      formData.append('refFiles', refFile.raw)
    }
  }
  
  // 使用axios调用轻量级上传API
  // 注意：响应拦截器已将 response.data 提取为内部 data 对象（即 { files: [...] }）
  const response = await uploadOnlyApi(formData)
  const responseData = response as any
  const { files } = responseData?.data || responseData || {}
  
  if (!files || files.length === 0) {
    throw new Error('上传返回空文件列表')
  }
  
  // 返回服务器存储的文件信息
  return files.map((f: any) => ({
    name: f.filePath ? f.filePath.split('/').pop() : f.fileName,
    size: f.fileSize || 0
  }))
}

const preAnalysisReasons = ref<Record<string, string>>({})

// ===== 后台上传+预分析状态跟踪 =====
// 'idle' | 'uploading' | 'pre-analyzing' | 'done' | 'failed'
const backgroundStatus = ref<'idle' | 'uploading' | 'pre-analyzing' | 'done' | 'failed'>('idle')
const backgroundUploadedServerFiles = ref<Array<{ name: string; size: number }>>([])
let backgroundStatusHideTimer: ReturnType<typeof setTimeout> | null = null

// ===== localStorage 状态持久化 =====
const STORAGE_KEY = 'smartReview_draft_v3'

interface PersistedState {
  currentStep: number
  title: string
  preAnalyzed: boolean
  preAnalysisData: typeof preAnalysisData
  reviewItems: typeof reviewItems
  manualMode: string
  selectedReviewPoints: string[]
  customPurposes: Array<{ value: string }>
  allSuggestedReviewPoints: string[]
  allSuggestedCorePurposes: string[]
  selectedTemplateId: string
  fileNames: string[]
  refFileNames: string[]
  savedAt: number
}

const saveState = () => {
  try {
    const state: PersistedState = {
      currentStep: currentStep.value,
      title: form.title,
      preAnalyzed: preAnalyzed.value,
      preAnalysisData: { ...preAnalysisData },
      reviewItems: JSON.parse(JSON.stringify(reviewItems)),
      manualMode: manualMode.value,
      selectedReviewPoints: [...selectedReviewPoints.value],
      customPurposes: customPurposes.value.map(p => ({ value: p.value })),
      allSuggestedReviewPoints: [...allSuggestedReviewPoints.value],
      allSuggestedCorePurposes: [...allSuggestedCorePurposes.value],
      selectedTemplateId: selectedTemplateId.value,
      fileNames: fileList.value.map(f => f.name),
      refFileNames: refFileList.value.map(f => f.name),
      savedAt: Date.now(),
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (e) {
    // localStorage 不可用或存储满时静默失败
  }
}

const restoreState = (): boolean => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return false
    const state: PersistedState = JSON.parse(raw)
    // 30分钟内有效
    if (Date.now() - state.savedAt > 30 * 60 * 1000) {
      clearSavedState()
      return false
    }
    if (state.currentStep !== undefined) currentStep.value = state.currentStep
    if (state.title) form.title = state.title
    if (state.preAnalyzed) preAnalyzed.value = state.preAnalyzed
    if (state.preAnalysisData) {
      if (state.preAnalysisData.contractType) preAnalysisData.contractType = state.preAnalysisData.contractType
      if (state.preAnalysisData.potentialParties?.length) preAnalysisData.potentialParties = state.preAnalysisData.potentialParties
      if (state.preAnalysisData.suggestedReviewPoints?.length) preAnalysisData.suggestedReviewPoints = state.preAnalysisData.suggestedReviewPoints
      if (state.preAnalysisData.suggestedCorePurposes?.length) preAnalysisData.suggestedCorePurposes = state.preAnalysisData.suggestedCorePurposes
    }
    if (state.reviewItems) Object.assign(reviewItems, state.reviewItems)
    if (state.manualMode) manualMode.value = state.manualMode
    if (state.selectedReviewPoints?.length) selectedReviewPoints.value = state.selectedReviewPoints
    if (state.customPurposes?.length) customPurposes.value = state.customPurposes
    if (state.allSuggestedReviewPoints?.length) allSuggestedReviewPoints.value = state.allSuggestedReviewPoints
    if (state.allSuggestedCorePurposes?.length) allSuggestedCorePurposes.value = state.allSuggestedCorePurposes
    if (state.selectedTemplateId) selectedTemplateId.value = state.selectedTemplateId
    return true
  } catch (e) {
    return false
  }
}

const clearSavedState = () => {
  try { localStorage.removeItem(STORAGE_KEY) } catch (e) { /* ignore */ }
}

// ===== 审查配置（需求驱动） =====
const config = reactive({
  perspective: '',
})

// 审查项状态
const reviewItems = reactive({
  standardReview: { enabled: true, knowledgeCategoryIds: [] as string[], recommended: false, reason: '' },
  docCompare: { enabled: false, recommended: false },
  intraFileConsistency: { enabled: false, recommended: false },
  typoCheck: { enabled: false, recommended: false },
  drawingRecognition: { enabled: false },
  ruleLibrary: { enabled: false, ruleLibraryId: '', recommended: false, reason: '' },
})

// 高级选项
const advancedOpen = ref(false)
const manualMode = ref('')

// 模式显示名称
const MODE_DISPLAY_NAMES: Record<string, string> = {
  FULL_REVIEW: '全量审查',
  LIBRARY_REVIEW: '以库审文',
  DOC_REVIEW: '以文审文',
  CONSISTENCY: '全文一致性',
  TYPO_GRAMMAR: '错别字/语法',
  MULTIMODAL: '多模态识别',
  CUSTOM_RULE: '自定义规则',
}

// 是否有图纸文件
const hasDrawingFiles = computed(() =>
  fileList.value.some(f => /\.(dwg|dxf)$/i.test(f.name))
)

// 根据审查项推导审查模式
const derivedMode = computed(() => {
  if (manualMode.value) return manualMode.value

  const active = Object.entries(reviewItems)
    .filter(([_, v]) => v.enabled)
    .map(([k]) => k)

  if (active.length === 0) return 'FULL_REVIEW'

  // 单项 → 专用模式
  if (active.length === 1) {
    if (active[0] === 'standardReview') return 'LIBRARY_REVIEW'
    if (active[0] === 'docCompare') return 'DOC_REVIEW'
    if (active[0] === 'typoCheck') return 'TYPO_GRAMMAR'
    if (active[0] === 'drawingRecognition') return 'MULTIMODAL'
    if (active[0] === 'ruleLibrary') return 'CUSTOM_RULE'
  }

  // 多项 → FULL_REVIEW
  return 'FULL_REVIEW'
})

const derivedModeDisplay = computed(() => MODE_DISPLAY_NAMES[derivedMode.value] || derivedMode.value)

// 知识库子库列表
const knowledgeCategories = ref<Array<{ id: string; name: string }>>([])

// 规则库列表
const ruleLibraries = ref<Array<{ id: string; name: string }>>([])

// 审查模板列表
const reviewTemplates = ref<Array<{ id: string; name: string }>>([])
const selectedTemplateId = ref('general')

// 审查点和核心目的
const allSuggestedReviewPoints = ref<string[]>([])
const allSuggestedCorePurposes = ref<string[]>([])
const selectedReviewPoints = ref<string[]>([])
const customPurposes = ref<Array<{ value: string }>>([{ value: '' }])

// 监听参照文件上传，自动启用参照比对
watch(refFileList, (newList) => {
  reviewItems.docCompare.enabled = newList.length > 0
})

// 监听关键状态变化，自动保存到 localStorage
watch([currentStep, () => form.title, preAnalyzed], () => saveState(), { deep: true })
watch(preAnalysisData, () => saveState(), { deep: true })
watch(reviewItems, () => saveState(), { deep: true })
watch([selectedReviewPoints, customPurposes, selectedTemplateId], () => saveState(), { deep: true })

// ===== 结果展示 =====
const activeAiTab = ref('summary')
const showPlainLanguage = ref(false)
const loading = ref(false)
const loadingMessage = ref('')
const analysisProgress = ref<Array<any>>([])

const visibleAnalysisProgress = computed(() => analysisProgress.value.slice(-6))

const progressStepLabels: Record<string, string> = {
  pre_analysis: '合同预分析',
  extract_text: '提取合同正文',
  knowledge_search: '检索法条与案例',
  llm_review: '生成审查结论',
  finalize: '保存审查结果',
}

const progressStatusLabels: Record<string, string> = {
  running: '进行中',
  completed: '已完成',
  failed: '失败',
}

const progressStepLabel = (step: string) => progressStepLabels[step] || step || '处理中'
const progressStatusLabel = (status: string) => progressStatusLabels[status] || status || '处理中'
const progressStatusClass = (status: string) => {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  return 'running'
}

// 审查数据
const reviewData = reactive({
  dispute_points: [] as any[],
  missing_clauses: [] as any[],
  modification_suggestions: [] as any[],
  relevant_laws: [] as any[],
})

// 工具函数
const firstText = (...values: any[]) => values.find(value => typeof value === 'string' && value.trim()) || ''
const joinLines = (...values: any[]) => values.filter(value => typeof value === 'string' && value.trim()).join('\n')

const disputeTitle = (item: any, index: number) => firstText(item.title, item.type, `风险点 ${index + 1}`)
const disputeDescription = (item: any) => firstText(
  item.description,
  joinLines(
    item.original_clause && `原文：${item.original_clause}`,
    item.legal_reference && `法律依据：${item.legal_reference}`,
    item.dispute_rationale && `风险说明：${item.dispute_rationale}`,
  )
)
const missingClauseTitle = (item: any, index: number) => firstText(item.title, item.clause_type, `缺失条款 ${index + 1}`)
const suggestionTitle = (item: any, index: number) => firstText(item.title, item.clause, `修改建议 ${index + 1}`)
const suggestionOriginal = (item: any) => firstText(item.original_text, item.original_clause)
const suggestionText = (item: any) => firstText(item.suggested_text, item.modification)
const suggestionReason = (item: any) => firstText(item.reason, item.rationale)

// 专项审查
const focusedReviewText = ref('')
const focusedReviewQuestion = ref('')
const focusedReviewResult = ref<any>(null)
const focusedReviewLoading = ref(false)

// 批量采纳
const batchSelected = reactive(new Set<number>())
const batchSelectedCount = computed(() => batchSelected.size)
const allSelected = computed(() =>
  reviewData.modification_suggestions.length > 0 &&
  batchSelected.size === reviewData.modification_suggestions.length
)
const batchPartialSelected = computed(() =>
  batchSelected.size > 0 && batchSelected.size < reviewData.modification_suggestions.length
)
const toggleAll = (val: boolean) => {
  if (val) {
    reviewData.modification_suggestions.forEach((_, i) => batchSelected.add(i))
  } else {
    batchSelected.clear()
  }
}
const toggleItem = (index: number) => {
  if (batchSelected.has(index)) {
    batchSelected.delete(index)
  } else {
    batchSelected.add(index)
  }
}
const batchAdopt = () => {
  if (batchSelected.size === 0) {
    ElMessage.warning('请先选择要采纳的建议')
    return
  }
  batchSelected.forEach((i) => {
    const item = reviewData.modification_suggestions[i]
    if (item && !item.adopted) {
      item.adopted = true
    }
  })
  ElMessage.success(`已批量采纳 ${batchSelected.size} 条建议`)
  batchSelected.clear()
}

// ===== 操作函数 =====
const goBackToUpload = () => {
  currentStep.value = 0
  fileList.value = []
  refFileList.value = []
}

const goBackToConfirm = () => {
  currentStep.value = 1
}

const startAnalysis = async () => {
  if (!config.perspective) {
    ElMessage.warning('请选择您的审查立场。')
    return
  }
  // 直接提交任务，后端会自动触发审查流程
  await submitTask()
}

const addPurpose = () => {
  customPurposes.value.push({ value: '' })
}

const removePurpose = (index: number) => {
  customPurposes.value.splice(index, 1)
}

const querySearchCorePurposes = (queryString: string, cb: any) => {
  const results = queryString
    ? allSuggestedCorePurposes.value.filter(p => p.toLowerCase().includes(queryString.toLowerCase()))
    : allSuggestedCorePurposes.value
  cb(results.map(p => ({ value: p })))
}

// 采纳预览
const previewDialogVisible = ref(false)
const previewItem = ref<any>(null)

const previewSuggestion = (item: any) => {
  previewItem.value = item
  previewDialogVisible.value = true
}

const adoptFromPreview = () => {
  if (previewItem.value && !previewItem.value.adopted) {
    previewItem.value.adopted = true
    ElMessage.success('已采纳建议')
  }
  previewDialogVisible.value = false
}

const adoptSuggestion = (item: any) => {
  // TODO: 实现采纳功能
  item.adopted = !item.adopted
  ElMessage.success(item.adopted ? '已采纳建议' : '已取消采纳')
}

const exportWord = async () => {
  try {
    // SmartReview中暂无taskId，提示用户先完成审查
    ElMessage.info('导出Word功能在审查结果页面可用，请完成审查后导出')
  } catch (e) {
    ElMessage.error('导出Word失败')
  }
}

const exportExcel = async () => {
  try {
    ElMessage.info('导出Excel功能在审查结果页面可用，请完成审查后导出')
  } catch (e) {
    ElMessage.error('导出Excel失败')
  }
}

const submitFocusedReview = async () => {
  if (!focusedReviewText.value.trim()) return
  focusedReviewLoading.value = true
  try {
    // TODO: 调用后端API进行专项审查
    await new Promise(resolve => setTimeout(resolve, 1500))
    focusedReviewResult.value = {
      risk_summary: '专项审查完成，发现以下风险点...',
      plain_language: '用大白话来说，这段内容存在一些问题...',
      suggested_text: '建议修改为：...',
    }
    ElMessage.success('专项审查完成')
  } catch (err) {
    ElMessage.error('专项审查失败')
  } finally {
    focusedReviewLoading.value = false
  }
}

const canSubmit = computed(() => {
  if (!form.title.trim()) return false
  // 至少启用一项审查
  const hasActiveItem = Object.values(reviewItems).some(v => v.enabled)
  if (!hasActiveItem) return false
  // 参照比对需要参照文件
  if (reviewItems.docCompare.enabled && refFileList.value.length === 0) return false
  // 规则库检查需要选择规则库
  if (reviewItems.ruleLibrary.enabled && !reviewItems.ruleLibrary.ruleLibraryId) return false
  return true
})

// ===== 提交 =====
const submitting = ref(false)

const submitTask = async () => {
  if (!userStore.token) {
    ElMessage.error('请先登录后再创建任务')
    router.push('/login')
    return
  }

  // 表单验证
  try {
    await formRef.value?.validate()
  } catch {
    return
  }

  submitting.value = true
  try {
    const fd = new FormData()
    fd.append('title', form.title)

    // 审查模式（由审查项组合推导或手动指定）
    fd.append('reviewMode', derivedMode.value)

    // 知识库（规范性审查启用时）
    if (reviewItems.standardReview.enabled && reviewItems.standardReview.knowledgeCategoryIds.length > 0) {
      fd.append('knowledgeCategoryIds', JSON.stringify(reviewItems.standardReview.knowledgeCategoryIds))
    }

    // 审查立场
    if (config.perspective) {
      fd.append('perspective', config.perspective)
    }

    // 预分析数据（完整对象，包含文件类型、签约方等）
    if (preAnalyzed.value) {
      fd.append('preAnalysisData', JSON.stringify(preAnalysisData))
    }

    // 用户选中的审查点
    if (selectedReviewPoints.value.length > 0) {
      fd.append('reviewPoints', JSON.stringify(selectedReviewPoints.value))
    }

    // 用户自定义的核心目的（过滤空值）
    const validPurposes = customPurposes.value
      .map(p => p.value.trim())
      .filter(v => v.length > 0)
    if (validPurposes.length > 0) {
      fd.append('corePurposes', JSON.stringify(validPurposes))
    }

    // 选择的审查模板
    if (selectedTemplateId.value) {
      fd.append('selectedTemplateId', selectedTemplateId.value)
    }

    // 规则库（规则库检查启用时）
    if (reviewItems.ruleLibrary.enabled && reviewItems.ruleLibrary.ruleLibraryId) {
      fd.append('standardIds', JSON.stringify([reviewItems.ruleLibrary.ruleLibraryId]))
    }

    // 文件内一致性开关
    fd.append('intraFileConsistency', String(reviewItems.intraFileConsistency.enabled))

    // 文件
    fileList.value.forEach(f => { if (f.raw) fd.append('files', f.raw) })

    // 参照文件
    refFileList.value.forEach(f => { if (f.raw) fd.append('refFiles', f.raw) })

    // DWG 解析数据
    if (Object.keys(dwgParsedDataMap.value).length > 0) {
      fd.append('dwgParsedData', JSON.stringify(dwgParsedDataMap.value))
    }

    const { data } = await createTaskApi(fd)
    ElMessage.success('审查任务已创建')
    clearSavedState() // 任务创建成功，清除草稿
    router.push(`/review/${data.id}`)
  } catch (e: any) {
    console.error('[SmartReview] 创建任务失败详细错误:', e)
    console.error('[SmartReview] 响应数据:', e?.response?.data)
    console.error('[SmartReview] 响应状态:', e?.response?.status)
    console.error('[SmartReview] 请求配置:', e?.config?.url, e?.config?.method)
    ElMessage.error(e?.response?.data?.message || e?.message || '创建任务失败')
  } finally {
    submitting.value = false
  }
}

// ===== 初始化 =====
onMounted(async () => {
  // 恢复上次的草稿状态
  const restored = restoreState()
  if (restored && currentStep.value > 0) {
    console.log('[SmartReview] 已恢复草稿状态, step:', currentStep.value)
  }
  
  try {
    const [catRes, libRes] = await Promise.all([
      getAllKnowledgeCategoriesApi(),
      getRuleLibrariesApi(),
    ])
    knowledgeCategories.value = (catRes.data || []).map((c: any) => ({ id: c.id, name: c.name }))
    ruleLibraries.value = (libRes.data || []).map((l: any) => ({ id: l.id, name: l.name }))
    
    // TODO: 加载审查模板列表
    reviewTemplates.value = [
      { id: 'general', name: '通用审查模板' },
      { id: 'service', name: '服务/采购合同审查模板' },
    ]
  } catch (e) {
    console.warn('[SmartReview] 加载知识库/规则库列表失败:', e)
  }
})
</script>

<style scoped>
/* 步骤条 - 参考项目风格 */
.step-header {
  background: white;
  border-radius: 8px;
  padding: 12px 20px;
  margin-bottom: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #9CA3AF;
  transition: all 0.3s;
}

.step-item.active {
  color: #3B82F6;
}

.step-item.completed {
  color: #10B981;
}

.step-circle {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 2px solid currentColor;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  transition: all 0.3s;
}

.step-item.active .step-circle {
  background: #3B82F6;
  border-color: #3B82F6;
  color: white;
}

.step-item.completed .step-circle {
  background: #10B981;
  border-color: #10B981;
  color: white;
}

.step-label {
  font-size: 13px;
  font-weight: 600;
}

.step-line {
  flex: 1;
  max-width: 60px;
  height: 2px;
  background: #E5E7EB;
  transition: all 0.3s;
}

.step-line.active {
  background: #3B82F6;
}

/* 主容器 */
.smart-review {
  max-width: 1200px;
  margin: 0 auto;
  padding: 16px 20px;
}

/* 上传步骤 */
.upload-step {
  text-align: center;
}

.step-title {
  margin-bottom: 20px;
}

.page-title {
  font-size: 28px;
  font-weight: 800;
  color: #111827;
  margin: 0 0 6px;
}

.page-subtitle {
  font-size: 14px;
  color: #6B7280;
  margin: 0;
}

.upload-container {
  max-width: 800px;
  margin: 0 auto;
}

/* 待审文件上传区域 */
.primary-upload-section {
  margin-bottom: 20px;
}

/* 参考文件上传区域 */
.reference-upload-section {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 2px dashed #E5E7EB;
}

/* 区域标题 */
.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 16px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 12px;
}

.section-description {
  font-size: 13px;
  color: #6B7280;
  margin: 0 0 12px;
  line-height: 1.5;
}

/* 参考文件上传区 */
.reference-upload :deep(.el-upload-dragger) {
  padding: 24px 20px;
  border-radius: 10px;
  border: 2px dashed #D1D5DB;
  background: #F9FAFB;
  transition: all 0.15s;
}

.reference-upload :deep(.el-upload-dragger:hover) {
  border-color: #10B981;
  background: #F0FDF4;
}

.reference-upload .upload-icon {
  color: #6B7280;
}

/* 文件列表区域 */
.file-list-section {
  margin-top: 12px;
}

.file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: white;
  border-radius: 6px;
  border: 1px solid #E5E7EB;
  transition: all 0.15s;
}

.file-item:hover {
  border-color: #3B82F6;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
}

.file-item.reference-file {
  background: #F9FAFB;
  border-color: #D1D5DB;
}

.file-item.reference-file:hover {
  border-color: #10B981;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.1);
}

.file-icon {
  color: #3B82F6;
  font-size: 18px;
}

.file-item.reference-file .file-icon {
  color: #10B981;
}

.file-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 11px;
  color: #9CA3AF;
  flex-shrink: 0;
}

/* 步骤操作按钮 */
.step-actions {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}

/* 上传拖拽区 */
.upload-dragger :deep(.el-upload-dragger) {
  padding: 36px 20px;
  border-radius: 10px;
  border: 2px dashed #E5E7EB;
  background: #FAFAFA;
  transition: all 0.15s;
}

.upload-dragger :deep(.el-upload-dragger:hover) {
  border-color: #3B82F6;
  background: #EFF6FF;
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.upload-icon {
  color: #9CA3AF;
}

.upload-text {
  font-size: 15px;
  color: #6B7280;
}

.upload-link {
  font-weight: 700;
  color: #3B82F6;
  cursor: pointer;
}

.upload-hint {
  font-size: 12px;
  color: #9CA3AF;
  margin: 0;
}

/* 确认步骤 */
.confirm-step {
  max-width: 1000px;
  margin: 0 auto;
}

/* 后台上传/预分析状态横幅 */
.background-status-alert {
  margin-bottom: 16px;
  border-radius: 8px;
}

.background-status-alert :deep(.el-alert__title) {
  font-weight: 600;
}

.background-status-alert :deep(.el-alert__content) {
  font-size: 13px;
  line-height: 1.5;
}

.title-input-section {
  margin-bottom: 20px;
}

.upload-success {
  text-align: center;
  margin-bottom: 32px;
}

.success-text {
  font-size: 16px;
  color: #111827;
  margin: 0 0 8px;
}

.file-name {
  font-weight: 700;
  color: #3B82F6;
}

.ai-hint {
  font-size: 14px;
  color: #6B7280;
  margin: 0;
}

.type-text {
  font-weight: 700;
  color: #111827;
}

/* 配置网格 */
.config-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
  margin-bottom: 24px;
}

.config-panel {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
}

.config-panel .panel-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 8px;
}

.config-panel .panel-desc {
  font-size: 14px;
  color: #6B7280;
  margin: 0 0 16px;
}

.select-label {
  display: block;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 8px;
}

.config-panel .panel-actions {
  margin-top: 24px;
  justify-content: flex-end;
}

/* 审查选项面板 */
.review-options-panel {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
  margin-bottom: 24px;
}

.review-options-panel .panel-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 20px;
}

.review-points-section {
  margin-bottom: 24px;
}

.section-label {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin: 0 0 12px;
}

.review-points-group {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.review-points-group :deep(.el-checkbox) {
  margin-right: 0;
}

.review-purposes-section .purpose-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.remove-btn {
  color: #EF4444;
  padding: 4px;
}

.add-purpose-btn {
  margin-top: 8px;
  color: #3B82F6;
}

/* 预分析配置 */
.review-items-section {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
}

.review-items-section .panel-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 4px;
}

.review-items-section .panel-desc {
  font-size: 14px;
  color: #6B7280;
  margin: 0 0 20px;
}

.review-items-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.review-item {
  padding: 16px;
  border: 1px solid #E5E7EB;
  border-radius: 10px;
  background: #FAFAFA;
  transition: all 0.2s ease;
}

.review-item:hover {
  border-color: #D1D5DB;
  background: #F9FAFB;
}

.review-item.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.review-item-main {
  display: flex;
  align-items: flex-start;
  gap: 14px;
}

.review-item-info {
  flex: 1;
  min-width: 0;
}

.review-item-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin-bottom: 4px;
}

.review-item-desc {
  font-size: 13px;
  color: #6B7280;
  line-height: 1.5;
}

.review-item-config {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #E5E7EB;
}

.config-reason {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 8px;
  font-size: 13px;
  color: #6B7280;
  line-height: 1.5;
}

.config-reason .el-icon {
  color: #3B82F6;
  margin-top: 2px;
  flex-shrink: 0;
}

/* 高级选项 */
.advanced-section {
  margin-top: 16px;
  border-top: 1px solid #E5E7EB;
  padding-top: 12px;
}

.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 14px;
  color: #6B7280;
  user-select: none;
}

.advanced-toggle:hover {
  color: #374151;
}

.manual-mode-hint {
  margin-left: 8px;
  font-size: 12px;
  color: #F59E0B;
  font-weight: 600;
}

.advanced-content {
  margin-top: 12px;
  padding: 16px;
  background: #F9FAFB;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
}

.advanced-hint {
  font-size: 13px;
  color: #6B7280;
  margin: 0 0 12px;
}

.mode-radio-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pre-analyzing {
  padding: 24px;
}

/* 审查步骤 */
.review-step {
  background: white;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  border: 1px solid #E5E7EB;
}

.review-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid #E5E7EB;
}

.review-title {
  font-size: 20px;
  font-weight: 700;
  color: #111827;
  margin: 0;
}

.review-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.review-tabs {
  padding: 24px;
}

.tab-content h3 {
  font-size: 16px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 16px;
}

.issues-list, .suggestions-list, .laws-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.batch-actions-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #F0F7FF;
  border: 1px solid #BAE0FF;
  border-radius: 8px;
  margin-bottom: 16px;
}

.issue-card, .suggestion-card, .law-card {
  padding: 16px;
  background: #FAFAFA;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.suggestion-card.batch-selected {
  border-color: #1890FF;
  box-shadow: 0 0 0 1px rgba(24, 144, 255, 0.2);
}

.suggestion-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.issue-title, .suggestion-title, .law-title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
  margin: 0 0 8px;
}

.issue-desc, .law-clause, .law-content {
  font-size: 14px;
  color: #6B7280;
  margin: 0;
  line-height: 1.6;
}

/* 大白话模式 */
.plain-language-box {
  margin-top: 12px;
  padding: 12px;
  background: #F0FDF4;
  border-radius: 8px;
  border-left: 4px solid #10B981;
}

.plain-label {
  font-size: 12px;
  font-weight: 700;
  color: #15803D;
  margin: 0 0 4px;
}

.plain-text {
  font-size: 14px;
  color: #15803D;
  margin: 0;
  line-height: 1.6;
}

/* 详细模式 */
.detail-mode {
  margin-top: 12px;
}

.detail-item {
  margin-bottom: 12px;
}

.detail-label {
  font-size: 12px;
  font-weight: 600;
  color: #6B7280;
  margin: 0 0 4px;
}

.detail-quote {
  padding: 12px;
  border-radius: 6px;
  font-size: 14px;
  line-height: 1.6;
  margin: 0;
}

.detail-quote.original {
  background: #FEF2F2;
  border-left: 4px solid #EF4444;
  color: #991B1B;
}

.detail-quote.suggested {
  background: #F0FDF4;
  border-left: 4px solid #10B981;
  color: #15803D;
}

.detail-reason {
  font-size: 14px;
  color: #374151;
  margin: 0;
  line-height: 1.6;
}

.suggestion-actions {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #E5E7EB;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.workspace-section {
  margin-bottom: 24px;
}

.workspace-actions {
  margin-top: 12px;
}

.focused-result {
  padding: 16px;
  background: #FAFAFA;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
}

.result-summary {
  font-size: 14px;
  color: #374151;
  margin: 12px 0;
  line-height: 1.6;
}

.suggested-text-box {
  margin-top: 12px;
}

.suggested-text {
  padding: 12px;
  background: #F0FDF4;
  border-radius: 6px;
  font-size: 14px;
  color: #15803D;
  line-height: 1.6;
  margin: 8px 0 0;
}

.empty-state {
  text-align: center;
  padding: 32px;
  color: #9CA3AF;
  font-size: 14px;
}

/* 加载遮罩 */
.loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.loading-content {
  background: white;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  border: 1px solid #E5E7EB;
  max-width: 480px;
  width: 100%;
}

.loading-title {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 16px;
  text-align: center;
}

.analysis-progress-steps {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress-step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 8px;
  border-radius: 6px;
}

.progress-step--running {
  background: #EFF6FF;
}

.progress-step--completed {
  background: #F0FDF4;
}

.progress-step--failed {
  background: #FEF2F2;
}

.progress-marker {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.progress-step--running .progress-marker {
  background: #3B82F6;
  color: white;
}

.progress-step--completed .progress-marker {
  background: #10B981;
  color: white;
}

.progress-step--failed .progress-marker {
  background: #EF4444;
  color: white;
}

.progress-info {
  flex: 1;
}

.progress-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.progress-status {
  font-size: 12px;
  font-weight: 500;
  color: #6B7280;
}

.progress-message {
  font-size: 12px;
  color: #6B7280;
  margin: 4px 0 0;
}

/* 采纳预览对话框 */
.preview-compare {
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.preview-panel {
  flex: 1;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #E5E7EB;
}

.preview-panel-header {
  padding: 8px 12px;
  background: #F9FAFB;
  border-bottom: 1px solid #E5E7EB;
}

.preview-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 2px 10px;
  border-radius: 4px;
}

.badge-before {
  background: #FEF2F2;
  color: #DC2626;
}

.badge-after {
  background: #F0FDF4;
  color: #16A34A;
}

.preview-panel-body {
  padding: 14px;
  font-size: 14px;
  line-height: 1.7;
  color: #374151;
}

.preview-before .preview-panel-body {
  background: #FEF2F2;
}

.preview-after .preview-panel-body {
  background: #F0FDF4;
}

.preview-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  color: #9CA3AF;
  min-width: 40px;
  padding-top: 40px;
}
</style>
