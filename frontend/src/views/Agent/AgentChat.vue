<template>
  <div class="agent-layout" :class="{ dark: isDark }" @dragover.prevent="onDragOver" @dragleave.prevent="onDragLeave" @drop.prevent="onDrop">
    <!-- 移动端侧栏抽屉遮罩 -->
    <div
      class="sidebar-overlay-backdrop"
      :class="{ 'is-open': sidebarOpen }"
      @click="sidebarOpen = false"
    />

    <!-- 左侧：会话列表（可拖拽宽度） -->
    <aside
      ref="sidebarContainerRef"
      class="sidebar-container"
      :class="[sidebarOpen ? 'sidebar-open' : 'sidebar-closed', sidebarIsResizing ? 'sidebar-resizing' : '']"
    >
      <AgentSessionList
        ref="sessionListRef"
        :current-session-id="sessionId"
        @select="handleSelectSession"
        @new-chat="handleNewChat"
        @open-config="handleOpenConfig"
        @deleted-current="handleDeletedCurrentSession"
      />
    </aside>

    <!-- 左侧拖拽分隔条 -->
    <div
      v-if="sidebarOpen"
      ref="sidebarSeparatorRef"
      class="panel-resize-handle"
      :class="{ 'is-resizing': sidebarIsResizing }"
      v-bind="sidebarSeparatorProps"
    />

    <!-- 中间：对话区域 -->
    <main class="center-column">
      <!-- 顶部工具栏（36px，对齐参考项目结构） -->
      <header class="top-toolbar">
        <div class="toolbar-left">
          <button class="toolbar-icon-btn toolbar-side-btn" :class="{ 'is-open': sidebarOpen }" :title="sidebarOpen ? '收起侧边栏' : '展开侧边栏'" @click="sidebarOpen = !sidebarOpen">
            <!-- 打开 = 左侧面板图标；收起 = 三条横线（对齐参考侧栏开关） -->
            <svg v-if="sidebarOpen" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg>
            <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="7" x2="21" y2="7" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="17" x2="21" y2="17" /></svg>
          </button>
          <button class="toolbar-icon-btn toolbar-side-btn" :title="isDark ? '切换到亮色模式' : '切换到暗色模式'" @click="toggleTheme">
            <el-icon :size="15"><Moon v-if="!isDark" /><Sunny v-else /></el-icon>
          </button>
          <!-- 自动命名按钮（对齐参考：位于顶栏左侧按钮组，主题切换之后） -->
          <button
            class="toolbar-icon-btn auto-name-btn"
            :disabled="autoNameStatus === 'loading' || !sessionId || messages.length === 0"
            :title="'自动生成会话标题'"
            @click="handleAutoName"
          >
            <el-icon :size="15" v-if="autoNameStatus === 'loading'" class="is-loading"><Loading /></el-icon>
            <el-icon :size="15" v-else-if="autoNameStatus === 'success'"><Check /></el-icon>
            <el-icon :size="15" v-else><MagicStick /></el-icon>
            <span class="auto-name-label">{{ autoNameLabel }}</span>
          </button>
          <div class="toolbar-title">
            <span class="title-text">Agent 审查助手</span>
          </div>
        </div>
        <div class="toolbar-right">
          <!-- P1-② 批量文档处理按钮 -->
          <button
            class="toolbar-icon-btn batch-btn"
            :class="{ 'is-open': batchOpen }"
            :title="'批量文档处理'"
            @click="batchOpen = !batchOpen"
          >
            <el-icon :size="15"><Files /></el-icon>
          </button>
          <!-- P2-⑭ 收藏与全局搜索按钮 -->
          <button
            class="toolbar-icon-btn library-btn"
            :class="{ 'is-open': libraryOpen }"
            :title="'收藏与全局搜索'"
            @click="libraryOpen = !libraryOpen"
          >
            <el-icon :size="15"><Star /></el-icon>
          </button>
          <!-- token 统计按钮（对齐参考：可点击，悬停 tooltip 明细，点击展开会话信息面板） -->
          <button
            v-if="stats"
            class="token-stats"
            :class="{ 'is-open': sessionInfoOpen }"
            :title="statsTooltip"
            @click="sessionInfoOpen = !sessionInfoOpen"
          >
            <span v-if="stats.tokens?.input > 0" class="stat-item">
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" /></svg>
              {{ formatToken(stats.tokens.input) }}
            </span>
            <span v-if="stats.tokens?.output > 0" class="stat-item">
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" /></svg>
              {{ formatToken(stats.tokens.output) }}
            </span>
            <span v-if="stats.tokens?.cacheRead > 0" class="stat-item">
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 5a3.5 3.5 0 1 1-1-2.45" /><polyline points="6.5 1.5 8.5 2.5 7.5 4.5" /></svg>
              {{ formatToken(stats.tokens.cacheRead) }}
            </span>
            <span v-if="stats.cost > 0" class="stat-item stat-cost">${{ formatCost(stats.cost) }}</span>
            <span v-if="stats.contextUsage?.contextWindow" class="stat-item" :class="contextUsageClass">
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" /><line x1="1" y1="9" x2="9" y2="9" /></svg>
              {{ contextUsageText }}
            </span>
          </button>
        </div>
      </header>

      <!-- 会话信息面板（对齐参考 AppShell：会话信息 / 消息 / Token 三栏） -->
      <div v-if="sessionInfoOpen && stats" class="session-info-panel">
        <!-- 第一栏：会话信息 -->
        <div class="session-info-col">
          <div class="sip-title">会话信息</div>
          <div class="sip-rows">
            <template v-if="stats.sessionName">
              <div class="sip-row-label">名称</div>
              <div class="sip-row-value">{{ stats.sessionName }}</div>
              <div class="sip-row-action"><button class="sip-copy-btn" :title="copiedField === 'name' ? '已复制' : '复制名称'" @click="copySessionField('name', stats.sessionName)">{{ copiedField === 'name' ? '✓' : '⧉' }}</button></div>
            </template>
            <div class="sip-row-label">存储</div>
            <div class="sip-row-value">数据库会话</div>
            <div class="sip-row-action" />
            <div class="sip-row-label">ID</div>
            <div class="sip-row-value">{{ stats.sessionId }}</div>
            <div class="sip-row-action"><button class="sip-copy-btn" :title="copiedField === 'id' ? '已复制' : '复制 ID'" @click="copySessionField('id', stats.sessionId)">{{ copiedField === 'id' ? '✓' : '⧉' }}</button></div>
          </div>
        </div>
        <!-- 第二栏：消息 -->
        <div class="session-info-col">
          <div class="sip-title">消息</div>
          <div class="sip-rows">
            <div class="sip-row-label">用户</div><div class="sip-row-value sip-num">{{ stats.userMessages }}</div>
            <div class="sip-row-label">助手</div><div class="sip-row-value sip-num">{{ stats.assistantMessages }}</div>
            <div class="sip-row-label">工具调用</div><div class="sip-row-value sip-num">{{ stats.toolCalls }}</div>
            <div class="sip-row-label">工具结果</div><div class="sip-row-value sip-num">{{ stats.toolResults }}</div>
            <div class="sip-row-label">总计</div><div class="sip-row-value sip-num">{{ stats.totalMessages }}</div>
          </div>
        </div>
        <!-- 第三栏：Token -->
        <div class="session-info-col">
          <div class="sip-title">Token</div>
          <div class="sip-rows">
            <div class="sip-row-label">输入</div><div class="sip-row-value sip-num">{{ stats.tokens.input }}</div>
            <div class="sip-row-label">输出</div><div class="sip-row-value sip-num">{{ stats.tokens.output }}</div>
            <div v-if="stats.tokens.cacheRead > 0" class="sip-row-label">缓存读取</div><div v-if="stats.tokens.cacheRead > 0" class="sip-row-value sip-num">{{ stats.tokens.cacheRead }}</div>
            <div v-if="stats.tokens.cacheWrite > 0" class="sip-row-label">缓存写入</div><div v-if="stats.tokens.cacheWrite > 0" class="sip-row-value sip-num">{{ stats.tokens.cacheWrite }}</div>
            <div class="sip-row-label">总计</div><div class="sip-row-value sip-num">{{ stats.tokens.total }}</div>
            <div v-if="stats.cost > 0" class="sip-row-label">费用</div><div v-if="stats.cost > 0" class="sip-row-value sip-num">${{ stats.cost.toFixed(4) }}</div>
            <div v-if="stats.contextUsage?.contextWindow" class="sip-row-label">上下文</div>
            <div v-if="stats.contextUsage?.contextWindow" class="sip-row-value sip-num">
              {{ stats.contextUsage.percent !== null ? `${stats.contextUsage.percent.toFixed(1)}%` : '?' }} / {{ formatCompact(stats.contextUsage.contextWindow) }}
            </div>
          </div>
        </div>
      </div>

      <!-- 聊天内容区 -->
      <div class="chat-content">
        <!-- ===== 统一对话界面（知识问答 = 工具预设 qa，仅启用知识检索工具）===== -->
        <!-- ===== 空会话：参考式极简品牌 + 居中输入框 ===== -->
        <div v-if="isEmptyNew" class="empty-chat">
          <div class="empty-inner">
            <div class="empty-header">
              <span class="brand-logo">审</span>
              <span class="brand-name">Agent 审查助手</span>
            </div>
            <div class="empty-hint">文档合规智能审查工作台 · 上传待审文件或直接描述需求</div>
            <!-- 已上传文件标签：紧贴输入框上方，从左往右排列 -->
            <div v-if="uploadedFiles.length > 0" class="uploaded-files">
              <div
                v-for="(f, i) in uploadedFiles"
                :key="i"
                class="file-chip"
                :class="['kind-' + (f.kind || 'other'), { 'has-path': f.path }]"
                @click="f.path && openFileInPanel(f.path, f.name)"
              >
                <el-icon v-if="f.kind === 'image'" :size="14"><Picture /></el-icon>
                <el-icon v-else-if="f.kind === 'pdf'" :size="14"><Tickets /></el-icon>
                <el-icon v-else-if="f.kind === 'excel'" :size="14"><Grid /></el-icon>
                <el-icon v-else :size="14"><Document /></el-icon>
                <span class="file-name" :title="f.path ? '在右侧面板打开预览' : '尚未保存路径'">{{ f.name }}</span>
                <span class="file-size">{{ formatSize(f.size) }}</span>
                <button class="file-remove" title="移除" @click.stop="uploadedFiles.splice(i, 1)">
                  <el-icon :size="12"><Close /></el-icon>
                </button>
              </div>
            </div>
            <div class="empty-chat-input">
              <ChatInputArea
                :model-options="modelOptions"
                :model-key="modelKey"
                :thinking-level="thinkingLevel"
                :tool-preset="toolPreset"
                :is-loading="isLoading"
                :input-value="inputValue"
                :attached-images="attachedImages"
                :uploading="uploading"
                :compacting="compacting"
                :can-compact="canCompact"
                @update:inputValue="inputValue = $event"
                @update:attachedImages="attachedImages = $event"
                @send="handleSend"
                @stop="handleStop"
                @model-change="handleModelChange"
                @thinking-change="handleThinkingChange"
                @preset-change="handlePresetChange"
                @compact="handleCompact"
                @upload="customUpload"
              />
            </div>
          </div>
        </div>

        <!-- ===== 有消息：消息列表 + 底部输入 ===== -->
        <template v-else>
        <!-- 消息列表（外层 wrap：供 ChatMinimap 绝对定位，避免随滚动容器滚动） -->
        <div class="messages-wrap">
        <div ref="messagesContainer" class="messages-container">
          <div class="chat-column">
          <div
            v-for="(message, idx) in messages"
            :key="message.id"
            :ref="collectMessageEl(idx)"
            class="message-row"
            :class="message.role"
          >
            <div class="bubble-wrap">
              <!-- 助手消息：模型标签行（对齐参考：11px text-dim，flex 居中） -->
              <div v-if="message.role === 'assistant' && getMessageModelLabel(message)" class="assistant-model-label">
                <span>{{ getMessageModelLabel(message) }}</span>
              </div>

              <div class="bubble" :class="message.role">
                <!-- 过程详情折叠组（assistant，对齐参考 ProcessDetailsGroup：回顾历史时把 thinking + 工具调用整体一键折叠） -->
                <template v-if="message.role === 'assistant' && hasProcessParts(message)">
                  <div class="process-details-group">
                    <button
                      class="process-details-toggle"
                      :title="processOpenFor(message, idx) ? '收起过程详情' : '展开过程详情'"
                      @click="toggleProcess(message.id)"
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" :style="{ transform: processOpenFor(message, idx) ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }">
                        <polyline points="4 2.5 7.5 6 4 9.5" />
                      </svg>
                      <span>过程详情</span>
                      <span class="process-details-meta">· {{ getProcessMeta(message).messageCount }} 条消息 · {{ getProcessMeta(message).toolCallCount }} 次工具调用</span>
                    </button>
                    <div v-if="processOpenFor(message, idx)" class="process-details-body">
                      <!-- thinking / reasoning 折叠块（assistant，对齐参考 ThinkingBlock） -->
                      <div
                        v-for="(think, ti) in getThinkingParts(message)"
                        :key="'think-' + ti"
                        class="thinking-block"
                      >
                        <button class="thinking-toggle" @click="toggleThinking(message.id + '-t' + ti)">
                          <span>思考过程</span>
                          <span v-if="think.duration" class="thinking-duration">{{ think.duration }}s</span>
                        </button>
                        <div v-if="thinkingOpen[message.id + '-t' + ti]" class="thinking-text">{{ think.text }}</div>
                      </div>
                      <!-- 工具调用 chip（assistant，对齐参考 ToolCallBlock） -->
                      <div
                        v-for="part in getToolCallParts(message)"
                        :key="(part as any).toolCallId || (part as any).id"
                        class="tool-call-wrap"
                      >
                        <ToolCallChip :part="part as any" />
                      </div>
                    </div>
                  </div>
                </template>

                <!-- P0-⑨ 知识来源卡片（assistant，展示 RAG 检索来源 + 点击锚点定位） -->
                <template v-if="message.role === 'assistant' && getSources(message).length > 0">
                  <div class="kb-source-group">
                    <div class="kb-source-header">
                      <span>📎 知识来源</span>
                      <span class="kb-source-count">{{ getSources(message).length }}</span>
                    </div>
                    <div class="kb-source-list">
                      <button
                        v-for="(src, si) in getSources(message)"
                        :key="si"
                        class="kb-source-item"
                        :title="src.excerpt || src.documentName"
                        @click="locateSource(message, src)"
                      >
                        <span class="kb-source-doc">{{ src.documentName }}</span>
                        <span v-if="src.section" class="kb-source-tag">§{{ src.section }}</span>
                        <span v-if="src.page" class="kb-source-tag">P{{ src.page }}</span>
                        <span class="kb-source-sim">{{ formatSimilarity(src.similarity) }}</span>
                      </button>
                    </div>
                  </div>
                </template>

                <!-- 结构化审查结果 -->
                <template v-if="message.role === 'assistant' && hasIssues(message)">
                  <div
                    v-if="extractIssuesFromMessage(message).beforeText"
                    class="markdown-body markdown-content"
                    v-html="renderMarkdown(extractIssuesFromMessage(message).beforeText)"
                  />
                  <AgentIssueList
                    :issues="extractIssuesFromMessage(message).issues"
                    @locate-issue="locateIssue(message, $event)"
                  />
                  <div
                    v-if="extractIssuesFromMessage(message).afterText"
                    class="markdown-body markdown-content"
                    v-html="renderMarkdown(extractIssuesFromMessage(message).afterText)"
                  />
                </template>

                <!-- 普通文本（最终答案 / 用户消息） -->
                <template v-else-if="hasAnswerText(message)">
                  <!-- 流式回答用节流组件渲染：每个 delta 全量重解析 markdown 是 O(n²)，长回答尾部会卡 -->
                  <StreamedMarkdown
                    v-if="message.role === 'assistant'"
                    :text="getMessageText(message)"
                    :streaming="isStreamingTail(message, idx)"
                    class="markdown-body markdown-content"
                  />
                  <!-- 用户消息：文件标签块 + 剩余文本（对齐参考：上传文件在消息里显示为可视化标签） -->
                  <div v-else class="user-message-content">
                    <div v-if="extractUploadedFileNames(getMessageText(message)).length > 0" class="uploaded-files-in-msg">
                      <div
                        v-for="(fname, fi) in extractUploadedFileNames(getMessageText(message))"
                        :key="fi"
                        class="file-chip"
                        :class="'kind-' + getFileKind(fname)"
                      >
                        <el-icon v-if="getFileKind(fname) === 'image'" :size="14"><Picture /></el-icon>
                        <el-icon v-else-if="getFileKind(fname) === 'pdf'" :size="14"><Tickets /></el-icon>
                        <el-icon v-else-if="getFileKind(fname) === 'excel'" :size="14"><Grid /></el-icon>
                        <el-icon v-else :size="14"><Document /></el-icon>
                        <span class="file-name">{{ fname }}</span>
                      </div>
                    </div>
                    <div
                      v-if="!isOnlyFileTagMessage(getMessageText(message))"
                      class="markdown-body markdown-user-message markdown-content"
                      v-html="renderMarkdown(getUserMessageTextWithoutFileTag(getMessageText(message)))"
                    />
                  </div>
                </template>

                <!-- 报告下载 -->
                <template v-if="message.role === 'assistant' && extractReportLinks(message).length > 0">
                  <div class="report-actions">
                    <template v-for="(link, i) in extractReportLinks(message)" :key="i">
                      <!-- 预览：联动右侧面板（filePath 打开右栏查看器） -->
                      <el-button
                        v-if="link.filePath"
                        type="primary"
                        size="small"
                        :icon="View"
                        @click="openFileInPanel(link.filePath, link.fileName)"
                      >
                        预览 {{ link.fileName }}
                      </el-button>
                      <el-button
                        v-if="link.kind === 'md' && link.url"
                        size="small"
                        :icon="Download"
                        @click="downloadMd(link.url, link.fileName)"
                      >
                        下载
                      </el-button>
                      <el-button v-else-if="link.kind === 'pdf'" type="success" size="small" :icon="Printer" @click="openPrintPage(link.url)">
                        打印为 PDF
                      </el-button>
                    </template>
                  </div>
                </template>
              </div>

              <!-- 气泡底部行：操作按钮 + 时间戳（对齐参考：flex 靠右、gap 8、marginTop 4、时间戳 marginLeft auto） -->
              <div class="bubble-footer">
                <div class="msg-actions">
                  <button
                    v-if="getMessageText(message) && !isStreamingTail(message, idx)"
                    class="msg-action icon-only"
                    :class="{ 'is-active': msgCopied[message.id] }"
                    :title="msgCopied[message.id] ? '已复制' : '复制消息'"
                    @click="copyMessageText(message)"
                  >
                    <el-icon :size="16"><CopyDocument /></el-icon>
                  </button>
                  <button
                    v-if="getMessageText(message) && !isStreamingTail(message, idx)"
                    class="msg-action icon-only"
                    :class="{ 'is-saved': msgSaved[message.id] }"
                    :title="msgSaved[message.id] ? '已收藏' : '收藏'"
                    @click="saveMessage(message)"
                  >
                    <el-icon :size="16"><StarFilled v-if="msgSaved[message.id]" /><Star v-else /></el-icon>
                  </button>
                  <button
                    v-if="message.role === 'assistant' && idx === messages.length - 1 && !isLoading && messages.length > 0"
                    class="msg-action icon-only"
                    title="重新生成"
                    @click="handleRegenerate"
                  >
                    <el-icon :size="16"><Refresh /></el-icon>
                  </button>
                </div>
                <span v-if="message.createdAt" class="msg-time">{{ formatTime(message.createdAt) }}</span>
              </div>
            </div>
          </div>

          <!-- 运行指示（对齐参考：纯文字脉冲） -->
          <div v-if="showTypingIndicator" class="running-indicator">
            <span class="running-text">{{ runningText }}</span>
          </div>
          </div>
        </div>

        <!-- 消息迷你导航（一比一复刻参考项目 ChatMinimap：turn 节点 + hover 大纲预览 + 拖拽跳转）
             置于 messages-wrap 内、滚动容器之外，absolute 固定右侧不随内容滚动；
             getter 形式实时获取最新 DOM，规避 template ref 传给 prop 的时机问题 -->
        <ChatMinimap
          :messages="messages"
          :get-scroll-container="() => messagesContainer"
          :get-message-refs="() => messageEls"
        />
        </div>

        <!-- 输入栏（底部复用 ChatInputArea）：文件标签放入其中，
             与输入框共用 max-width 820 居中约束，避免超出输入框范围 -->
        <footer class="input-area">
          <!-- 已上传文件标签：紧贴输入框上方，与输入框同宽同中心 -->
          <div v-if="uploadedFiles.length > 0" class="uploaded-files uploaded-files-input">
            <div
              v-for="(f, i) in uploadedFiles"
              :key="i"
              class="file-chip"
              :class="['kind-' + (f.kind || 'other'), { 'has-path': f.path }]"
              @click="f.path && openFileInPanel(f.path, f.name)"
            >
              <el-icon v-if="f.kind === 'image'" :size="14"><Picture /></el-icon>
              <el-icon v-else-if="f.kind === 'pdf'" :size="14"><Tickets /></el-icon>
              <el-icon v-else-if="f.kind === 'excel'" :size="14"><Grid /></el-icon>
              <el-icon v-else :size="14"><Document /></el-icon>
              <span class="file-name" :title="f.path ? '在右侧面板打开预览' : '尚未保存路径'">{{ f.name }}</span>
              <span class="file-size">{{ formatSize(f.size) }}</span>
              <button class="file-remove" title="移除" @click.stop="uploadedFiles.splice(i, 1)">
                <el-icon :size="12"><Close /></el-icon>
              </button>
            </div>
          </div>
          <ChatInputArea
            :model-options="modelOptions"
            :model-key="modelKey"
            :thinking-level="thinkingLevel"
            :tool-preset="toolPreset"
            :is-loading="isLoading"
            :input-value="inputValue"
            :attached-images="attachedImages"
            :uploading="uploading"
            :compacting="compacting"
            :can-compact="canCompact"
            @update:inputValue="inputValue = $event"
            @update:attachedImages="attachedImages = $event"
            @send="handleSend"
            @stop="handleStop"
            @model-change="handleModelChange"
            @thinking-change="handleThinkingChange"
            @preset-change="handlePresetChange"
            @compact="handleCompact"
            @upload="customUpload"
          />
        </footer>

        </template>

        <!-- 拖拽上传遮罩（对齐参考：三个同心蓝涟漪 + 中央插图） -->
        <div v-if="isDragOver" class="drop-zone-overlay">
          <span class="drop-ripple" />
          <span class="drop-ripple" style="animation-delay: 0.8s" />
          <span class="drop-ripple" style="animation-delay: 1.6s" />
          <svg
            width="280"
            height="280"
            viewBox="0 0 140 140"
            fill="none"
            style="position: relative; z-index: 1; filter: drop-shadow(0 6px 18px rgba(37, 99, 235, 0.18));"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.50)" stroke-width="1.8" />
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="rgba(37,99,235,0.16)" stroke="rgba(37,99,235,0.40)" stroke-width="1.4" stroke-linejoin="round" />
            <circle cx="96" cy="58" r="8" fill="rgba(37,99,235,0.22)" stroke="rgba(37,99,235,0.55)" stroke-width="1.6" />
            <path d="M70 16 L70 26 M70 114 L70 124 M16 70 L26 70 M114 70 L124 70 M46 30 L53 37 M87 103 L94 110 M103 37 L110 30 M37 103 L30 110" stroke="rgba(37,99,235,0.45)" stroke-width="1.4" stroke-linecap="round" />
          </svg>
        </div>
      </div>
    </main>

    <!-- 右侧拖拽分隔条 -->
    <div
      v-if="rightPanelOpen"
      ref="rightSeparatorRef"
      class="panel-resize-handle right-panel-resize-handle"
      :class="{ 'is-resizing': rightIsResizing }"
      v-bind="rightSeparatorProps"
    />

    <!-- 右侧：业务面板（记忆/技能/工作区，套用参考视觉） -->
    <div
      class="right-panel-overlay-backdrop"
      :class="{ 'is-open': rightPanelOpen }"
      @click="rightPanelOpen = false"
    />
    <aside
      ref="rightContainerRef"
      class="right-panel-container"
      :class="[rightPanelOpen ? 'right-panel-open' : 'right-panel-closed', rightIsResizing ? 'right-panel-resizing' : '']"
    >
      <AgentSidePanel
        :current-session-id="sessionId"
        :uploaded-files="uploadedFiles"
        :open-file-path="openingFilePath"
        :locate="locateTarget"
        @close-file="handleCloseFile"
      />
    </aside>

    <!-- 左栏底部工具栏触发的配置弹窗（Models / Skills / 记忆） -->
    <AgentConfigDialogs
      v-model:model-visible="configDialogs.models"
      v-model:skills-visible="configDialogs.skills"
      v-model:memory-visible="configDialogs.memory"
      @models-saved="loadModelOptions"
    />

    <!-- P2-⑭ 收藏与全局搜索面板 -->
    <AgentLibraryPanel
      v-model="libraryOpen"
      :current-session-id="sessionId"
      @jump-to-session="handleJumpToSession"
    />

    <!-- P1-② 批量文档处理面板 -->
    <AgentBatchPanel
      v-model="batchOpen"
      :uploaded-files="uploadedFiles"
    />

    <!-- 右上角固定浮动按钮：右面板开关（对齐参考项目；图标与左侧栏开关同系列 panel-right） -->
    <button
      class="right-panel-fab"
      :class="{ 'is-open': rightPanelOpen }"
      :title="rightPanelOpen ? '收起右侧面板' : '展开右侧面板'"
      :aria-expanded="rightPanelOpen"
      @click="rightPanelOpen = !rightPanelOpen"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
    </button>

    <!-- Task 44：ask_user 主动提问对话框（四形态） -->
    <AskUserDialog
      :visible="askDialogVisible"
      :question="askPending?.question || ''"
      :method="askPending?.method || 'input'"
      :options="askPending?.options"
      :timeout-sec="askPending?.timeoutSec"
      @submit="onSubmitAsk"
      @cancel="onCancelAsk"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, reactive, onBeforeUnmount } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Document,
  Upload,
  Download,
  Printer,
  Close,
  Loading,
  Check,
  MagicStick,
  Moon,
  Sunny,
  Star,
  StarFilled,
  Files,
  View,
  Picture,
  Tickets,
  Grid,
  CopyDocument,
  Refresh,
} from '@element-plus/icons-vue'
import type { UIMessage } from 'ai'
import { useAgentChat } from '@/composables/useAgentChat'
import { useMarkdown } from '@/composables/useMarkdown'
import { useResizablePanel } from '@/composables/useResizablePanel'
import { useUserStore } from '@/stores/user'
import {
  getSessionStatsApi,
  autoNameSessionApi,
  getSessionApi,
  updateSessionSettingsApi,
  listAgentModelsApi,
  compactSessionApi,
  saveAgentItemApi,
  type SessionStats,
  type AgentModelOption,
} from '@/api/agent'
import ToolCallChip from './components/ToolCallChip.vue'
import StreamedMarkdown from './components/StreamedMarkdown.vue'
import AgentIssueList from './components/AgentIssueList.vue'
import AgentSessionList from './components/AgentSessionList.vue'
import AgentSidePanel from './components/AgentSidePanel.vue'
import AgentConfigDialogs from './components/AgentConfigDialogs.vue'
import AgentLibraryPanel from './components/AgentLibraryPanel.vue'
import AgentBatchPanel from './components/AgentBatchPanel.vue'
import ChatInputArea from './components/ChatInputArea.vue'
import ChatMinimap from './components/ChatMinimap.vue'
import AskUserDialog from './components/AskUserDialog.vue'
import { getPendingAskApi, type PendingAskResult } from '@/api/agent'
import './agent-theme.css'

const userStore = useUserStore()
const { renderMarkdown } = useMarkdown()

// ===== 主题切换（对齐参考项目：.agent-layout.dark + localStorage 持久化）=====
const THEME_STORAGE_KEY = 'agent-theme-dark'
const isDark = ref(false)
try {
  isDark.value = localStorage.getItem(THEME_STORAGE_KEY) === '1'
} catch { /* 隐私模式下存储不可用，默认亮色 */ }
function toggleTheme() {
  isDark.value = !isDark.value
  try {
    localStorage.setItem(THEME_STORAGE_KEY, isDark.value ? '1' : '0')
  } catch { /* ignore */ }
}
const { messages, sendMessage, stop, regenerate, isLoading, status, error, sessionId, loadHistory, startNewSession, modelKey, toolPreset, thinkingLevel, setSettings, pendingAskAnswer } = useAgentChat()

const sessionListRef = ref<InstanceType<typeof AgentSessionList> | null>(null)

// ===== 可拖拽面板 =====
const sidebarContainerRef = ref<HTMLElement | null>(null)
const rightContainerRef = ref<HTMLElement | null>(null)
const sidebarOpen = ref(true)
// 右侧面板默认关闭（大王 2026-08-04：每次自动打开体验不佳）
const rightPanelOpen = ref(false)

const sidebarPanel = useResizablePanel({
  cssVariable: '--sidebar-width',
  defaultWidth: 260,
  minWidth: 180,
  maxWidth: 480,
  storageKey: 'agent-sidebar-width',
  growthDirection: 'right',
  containerRef: sidebarContainerRef,
})
const rightPanel = useResizablePanel({
  cssVariable: '--right-panel-width',
  defaultWidth: 560,
  minWidth: 300,
  maxWidth: 1200,
  storageKey: 'agent-right-panel-width',
  growthDirection: 'left',
  containerRef: rightContainerRef,
})
// 注意：separatorProps 里的事件是 onPointerdown 形式，Vue 模板 v-bind 需要小写
// 这里手动映射为 v-bind 兼容的 props
const sidebarSeparatorProps = computed(() => remapSeparatorProps(sidebarPanel.separatorProps, sidebarPanel.isResizing.value))
const rightSeparatorProps = computed(() => remapSeparatorProps(rightPanel.separatorProps, rightPanel.isResizing.value))
const sidebarIsResizing = sidebarPanel.isResizing
const rightIsResizing = rightPanel.isResizing

function remapSeparatorProps(p: any, resizing: boolean): any {
  return {
    role: p.role,
    'aria-orientation': p['aria-orientation'],
    'aria-label': p['aria-label'],
    'aria-valuemin': p['aria-valuemin'],
    'aria-valuemax': p['aria-valuemax'],
    'aria-valuenow': p['aria-valuenow'],
    'aria-valuetext': p['aria-valuetext'],
    tabindex: p.tabindex,
    onPointerdown: p.onPointerdown,
    onPointermove: p.onPointermove,
    onPointerup: p.onPointerup,
    onPointercancel: p.onPointercancel,
    onLostpointercapture: p.onLostpointercapture,
    onKeydown: p.onKeydown,
    onDblclick: p.onDblclick,
    class: resizing ? 'is-resizing' : '',
  }
}

// ===== 过程详情折叠组（对齐参考 ProcessDetailsGroup：一键折叠所有 thinking + 工具调用）=====
const processOpen = reactive<Record<string, boolean>>({})
function toggleProcess(id: string) {
  processOpen[id] = !processOpen[id]
}
function hasProcessParts(message: UIMessage): boolean {
  if (message.role !== 'assistant') return false
  return getThinkingParts(message).length > 0 || getToolCallParts(message).length > 0
}
function isStreamingTail(message: UIMessage, idx: number): boolean {
  return isLoading.value && idx === messages.value.length - 1 && message.role === 'assistant'
}
function processOpenFor(message: UIMessage, idx: number): boolean {
  if (processOpen[message.id] !== undefined) return processOpen[message.id]
  // 流式尾部默认展开（用户能看到工具执行中）；回顾历史默认折叠（对齐参考）
  return isStreamingTail(message, idx)
}
function getProcessMeta(message: UIMessage): { messageCount: number; toolCallCount: number } {
  const toolCallCount = getToolCallParts(message).length
  const messageCount = getThinkingParts(message).length + toolCallCount
  return { messageCount, toolCallCount }
}
function hasAnswerText(message: UIMessage): boolean {
  return getMessageText(message).length > 0
}

// ===== P0-⑨ 知识引用溯源：来源卡片 =====
interface KnowledgeSource {
  type?: string
  documentName: string
  knowledgeName?: string
  similarity?: number
  page?: number
  section?: string
  excerpt?: string
}
function getSources(message: UIMessage): KnowledgeSource[] {
  if (message.role !== 'assistant') return []
  const raw = (message as any).sources
  if (!Array.isArray(raw)) return []
  return raw.filter((s: any) => s && typeof s === 'object' && s.documentName)
}
function formatSimilarity(v: number | undefined): string {
  if (v === undefined || typeof v !== 'number') return ''
  const pct = Math.round(v * 100)
  return pct >= 0 ? `${pct}%` : ''
}
/** 点击来源：在右栏打开对应文件并传页码锚点给 AgentFileViewer */
function locateSource(message: UIMessage, src: KnowledgeSource) {
  // 从消息的 tool-call part 里找 filePath（search_knowledge 前通常有 read_file / extract_text）
  let filePath = ''
  for (const p of (message.parts as any[])) {
    const input = p?.input
    if (input && typeof input === 'object' && typeof input.filePath === 'string') {
      filePath = input.filePath
      break
    }
  }
  if (!filePath) {
    // 找不到文件路径则退化为仅提示（不打断）
    return
  }
  openFileInPanel(filePath, filePath.split(/[\\/]/).pop() || filePath)
  locateTarget.value = { filePath, page: src.page, section: src.section }
  void src // 保持签名稳定
}

/**
 * P2-⑬ 行级批注：从消息的 tool-call part 里找 filePath，打开文件并把 issue 定位信息
 * 传给 AgentFileViewer。优先用 locateMeta 的行号区间（highlightLines），
 * 其次退化为原文文本命中（highlight）。
 */
function locateIssue(message: UIMessage, issue: any) {
  let filePath = ''
  for (const p of (message.parts as any[])) {
    const input = p?.input
    if (input && typeof input === 'object' && typeof input.filePath === 'string') {
      filePath = input.filePath
      break
    }
  }
  if (!filePath) {
    ElMessage.warning('未找到关联文件，无法定位原文')
    return
  }
  openFileInPanel(filePath, filePath.split(/[\\/]/).pop() || filePath)

  // 1) 优先：locateMeta 行号区间（后端 enrichLocateMeta 已补 lineHint/lineHintEnd）
  const lm = issue?.locateMeta
  const lineHint = lm?.hint?.lineHint
  if (typeof lineHint === 'number' && lineHint > 0) {
    const endHint = lm?.hint?.lineHintEnd
    const start = lineHint
    const end = typeof endHint === 'number' && endHint > start ? endHint : start
    locateTarget.value = { filePath, highlightLines: [start, end] as [number, number] }
    return
  }

  // 2) 退化：用 issue 原文片段做文本命中高亮（截前 60 字符）
  const hl = (issue?.originalText || '').trim().slice(0, 60)
  locateTarget.value = hl ? { filePath, highlight: hl } : { filePath }
}

// ===== thinking 折叠状态 =====
const thinkingOpen = reactive<Record<string, boolean>>({})
function toggleThinking(key: string) {
  thinkingOpen[key] = !thinkingOpen[key]
}
function getThinkingParts(message: UIMessage): Array<{ text: string; duration?: string }> {
  // ai-sdk v4 的 thinking part 类型可能是 'reasoning' 或 'thinking'
  return message.parts
    .filter((p: any) => p?.type === 'reasoning' || p?.type === 'thinking')
    .map((p: any) => ({ text: p.text || p.reasoning || p.reasoningTextDetail || '' }))
}

// ===== 消息复制（对齐参考：hover 淡入、11px、复制图标 + 文字、已复制变 accent）=====
const msgCopied = reactive<Record<string, boolean>>({})
async function copyMessageText(message: UIMessage) {
  const text = getMessageText(message)
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    msgCopied[message.id] = true
    setTimeout(() => { msgCopied[message.id] = false }, 1500)
  } catch {
    /* 剪贴板不可用时静默失败 */
  }
}

// ===== P2-⑭ 结果沉淀：收藏 / 搜索面板 =====
const libraryOpen = ref(false)
// P1-② 批量文档处理面板
const batchOpen = ref(false)

// 跳转到搜索结果对应会话
function handleJumpToSession(targetSessionId: string) {
  if (targetSessionId && targetSessionId !== sessionId.value) {
    handleSelectSession(targetSessionId)
  }
  // 会话切换后由 watch(sessionId) 加载消息；这里聚焦到消息区
  nextTick(() => {
    // 修复：原选择器 '.chat-messages-container' 与模板实际类名 '.messages-container' 不符，
    // 搜索跳转后滚动定位始终无效。改用模板 ref 直接定位。
    const el = messagesContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// ===== P2-⑭ 结果沉淀：收藏 =====
const msgSaved = reactive<Record<string, boolean>>({})
async function saveMessage(message: UIMessage) {
  const text = getMessageText(message)
  if (!text) return
  if (msgSaved[message.id]) return
  try {
    const title = text.slice(0, 30).replace(/\s+/g, ' ') || '收藏'
    await saveAgentItemApi({
      type: message.role === 'assistant' ? 'qa' : 'question',
      title: title + (message.role === 'assistant' ? '' : '…'),
      content: text,
      sourceSessionId: sessionId.value || undefined,
      sourceMessageId: message.id,
    })
    msgSaved[message.id] = true
  } catch (e: any) {
    ElMessage.error(`收藏失败：${e?.message || '未知错误'}`)
  }
}

// ===== 助手消息模型标签（对齐参考：modelNames[provider:model]）=====
function getMessageModelLabel(message: UIMessage): string {
  const m = message as any
  if (typeof m.model === 'string' && m.model) return m.model
  if (typeof m.provider === 'string' && m.provider) return m.provider
  return ''
}

// ===== token 统计 + 会话信息面板 + 自动命名 =====
const stats = ref<SessionStats | null>(null)
const sessionInfoOpen = ref(false)
const copiedField = ref<'name' | 'id' | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | null = null
async function copySessionField(field: 'name' | 'id', value: string) {
  try {
    await navigator.clipboard.writeText(value)
    copiedField.value = field
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => { copiedField.value = null }, 1500)
  } catch { /* 剪贴板不可用时静默失败 */ }
}

// 顶栏按钮悬停 tooltip：完整统计明细（对齐参考）
const statsTooltip = computed(() => {
  const t = stats.value?.tokens
  if (!t) return ''
  const lines = [
    `输入 ${t.input.toLocaleString()}`,
    `输出 ${t.output.toLocaleString()}`,
    `缓存读取 ${t.cacheRead.toLocaleString()}`,
    `缓存写入 ${t.cacheWrite.toLocaleString()}`,
  ]
  if (stats.value?.cost > 0) lines.push(`费用 $${stats.value.cost.toFixed(4)}`)
  const cu = stats.value?.contextUsage
  if (cu?.contextWindow) {
    lines.push(`上下文 ${cu.percent !== null ? `${cu.percent.toFixed(1)}%` : '?'} / ${formatCompact(cu.contextWindow)}`)
  }
  return lines.join('  ·  ') + '\n点击查看会话信息'
})
function formatCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(0) + 'k'
  return String(n)
}

const autoNameStatus = ref<'idle' | 'loading' | 'success' | 'error'>('idle')
const autoNameLabel = computed(() => {
  switch (autoNameStatus.value) {
    case 'loading': return '生成中…'
    case 'success': return '已更新'
    case 'error': return '重试'
    default: return '生成标题'
  }
})

const contextUsageClass = computed(() => {
  if (!stats.value?.contextUsage?.percent) return ''
  const p = stats.value.contextUsage.percent
  if (p > 90) return 'stat-danger'
  if (p > 70) return 'stat-warning'
  return ''
})
const contextUsageText = computed(() => {
  const cu = stats.value?.contextUsage
  if (!cu?.contextWindow) return ''
  const pct = cu.percent
  return pct !== null ? `${pct.toFixed(0)}% / ${formatToken(cu.contextWindow)}` : `? / ${formatToken(cu.contextWindow)}`
})

async function refreshStats() {
  if (!sessionId.value) { stats.value = null; return }
  try {
    const res = await getSessionStatsApi(sessionId.value)
    stats.value = res.data
  } catch { /* 静默失败 */ }
}

async function handleAutoName() {
  if (!sessionId.value || autoNameStatus.value === 'loading') return
  autoNameStatus.value = 'loading'
  try {
    await autoNameSessionApi(sessionId.value)
    autoNameStatus.value = 'success'
    sessionListRef.value?.refresh?.()
    setTimeout(() => { autoNameStatus.value = 'idle' }, 2000)
  } catch (e) {
    autoNameStatus.value = 'error'
    ElMessage.error('自动命名失败：' + (e as Error).message)
    setTimeout(() => { autoNameStatus.value = 'idle' }, 2000)
  }
}

function formatToken(n: number | null | undefined): string {
  if (!n) return '0'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}
function formatCost(c: number): string {
  if (c <= 0) return ''
  if (c < 0.01) return '<0.01'
  return c.toFixed(2)
}

// ===== 输入栏设置：模型 / 思考强度 / 工具预设（per-session 持久化）=====
const modelOptions = ref<AgentModelOption[]>([])
async function loadModelOptions() {
  try {
    const res = await listAgentModelsApi()
    modelOptions.value = res.data.models
    // 无「系统默认」概念：modelKey 为空或已不在列表中时，默认选中第一个配置模型
    if (modelOptions.value.length > 0) {
      const current = modelKey.value
      const valid = current && modelOptions.value.some(o => o.key === current)
      if (!valid) {
        modelKey.value = modelOptions.value[0].key ?? null
        if (sessionId.value) persistSessionSettings()
      }
    }
  } catch { /* 静默失败：选择器保持为空 */ }
}
loadModelOptions()

async function persistSessionSettings() {
  if (!sessionId.value) return
  try {
    await updateSessionSettingsApi(sessionId.value, {
      modelKey: modelKey.value || null,
      toolPreset: toolPreset.value,
      thinkingLevel: thinkingLevel.value || null,
    })
  } catch (e) {
    ElMessage.error('保存会话设置失败：' + (e as Error).message)
  }
}

// el-select clearable 清空后值为 ''/undefined，统一归 null（= 系统默认 / 不覆盖）
function handleModelChange(v: string | null) {
  modelKey.value = v || null
  persistSessionSettings()
}
function handleThinkingChange(v: string | null) {
  thinkingLevel.value = v || null
  persistSessionSettings()
}
function handlePresetChange(v: string) {
  toolPreset.value = v
  persistSessionSettings()
}

// ===== 手动压缩上下文 =====
const compacting = ref(false)
async function handleCompact() {
  if (!sessionId.value || compacting.value || messages.value.length === 0) return
  compacting.value = true
  try {
    const d = (await compactSessionApi(sessionId.value)).data
    if (d.truncatedMessages > 0) {
    } else {
      ElMessage.info('当前消息量未达压缩阈值，无需压缩')
    }
    refreshStats()
  } catch (e) {
    ElMessage.error('压缩失败：' + (e as Error).message)
  } finally {
    compacting.value = false
  }
}

// ===== 会话切换 =====
async function handleSelectSession(sid: string) {
  try {
    await loadHistory(sid)
    uploadedFiles.value = []
    attachedImages.value = []
    openingFilePath.value = null
    refreshStats()
    // 加载会话设置（模型/工具预设/思考强度），失败不阻断主流程
    try {
      const detail = (await getSessionApi(sid)).data
      setSettings({
        modelKey: detail.modelKey,
        toolPreset: detail.toolPreset,
        thinkingLevel: detail.thinkingLevel,
      })
    } catch { /* 设置加载失败不阻断 */ }
  } catch (e) {
    ElMessage.error('加载会话历史失败：' + (e as Error).message)
  }
}

function handleNewChat() {
  // 用 startNewSession 替代 clearSession：生成新的 sessionId（UUID），
  // 保证首条消息能持久化到后端，左侧会话列表立即出现历史记录
  startNewSession()
  uploadedFiles.value = []
  attachedImages.value = []
  openingFilePath.value = null
  stats.value = null
  // 无「系统默认」：新建会话默认选中第一个配置模型
  const firstKey = modelOptions.value[0]?.key ?? null
  setSettings({ modelKey: firstKey, toolPreset: 'full', thinkingLevel: null })
  // 立即刷新会话列表（新会话可能已由 startNewSession 生成）
  sessionListRef.value?.refresh?.()
}

/** 删除当前会话后清理本地状态（修复：原实现删除后 UI 仍显示已删会话，继续发送会重建空会话） */
function handleDeletedCurrentSession() {
  startNewSession()
  uploadedFiles.value = []
  attachedImages.value = []
  openingFilePath.value = null
  stats.value = null
  sessionListRef.value?.refresh?.()
}

const inputValue = ref('')
const messagesContainer = ref<HTMLDivElement | null>(null)
const uploading = ref(false)

/** 上传文件类型（用于标签区分） */
type FileKind = 'image' | 'pdf' | 'word' | 'excel' | 'ppt' | 'text' | 'other'

/** 按扩展名推断文件类型 */
function getFileKind(name: string): FileKind {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico'].includes(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (['doc', 'docx'].includes(ext)) return 'word'
  if (['xls', 'xlsx', 'csv', 'tsv'].includes(ext)) return 'excel'
  if (['ppt', 'pptx'].includes(ext)) return 'ppt'
  if (['txt', 'md', 'markdown', 'json', 'log', 'xml', 'yaml', 'yml', 'js', 'ts', 'tsx', 'jsx', 'vue', 'css', 'html', 'py', 'sh', 'sql'].includes(ext)) return 'text'
  return 'other'
}

const uploadedFiles = ref<Array<{ name: string; size: number; path?: string; kind?: FileKind }>>([])
// 粘贴图片附件（dataUrl + 预览；粘贴/移除逻辑在 ChatInputArea 组件内）
const attachedImages = ref<Array<{ dataUrl: string; previewUrl: string; fileName?: string }>>([])
// 右栏文件查看器：待打开文件路径（传给 AgentSidePanel，触发文件 tab）
const openingFilePath = ref<string | null>(null)
// P0-⑨ 知识引用溯源：来源锚点定位目标（传给 AgentSidePanel → AgentFileViewer）
const locateTarget = ref<{ filePath: string; page?: number; section?: string; highlight?: string; highlightLines?: [number, number] } | null>(null)
/** 在右侧面板打开文件预览（对齐参考：点击上传文件 → 右栏 TabBar + 查看器） */
function openFileInPanel(filePath: string, fileName?: string) {
  openingFilePath.value = null
  // 用 setTimeout 确保同路径也能重新触发 watch
  setTimeout(() => {
    openingFilePath.value = filePath
    rightPanelOpen.value = true
  }, 0)
}
function handleCloseFile(_filePath: string) {
  if (openingFilePath.value) openingFilePath.value = null
}

// 左栏底部工具栏：Models / Skills / 记忆 三个配置弹窗
const configDialogs = reactive({ models: false, skills: false, memory: false })
function handleOpenConfig(type: 'models' | 'skills' | 'memory') {
  configDialogs[type] = true
}

/** 将粘贴的图片 dataUrl 上传到服务器，返回 filePath（失败抛错，由调用方提示） */
async function uploadImageDataUrl(dataUrl: string): Promise<string | null> {
  // 从 dataUrl 推导真实扩展名（原实现一律存 .png，jpg 也变 png）
  const mimeMatch = dataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);/)
  const mimeExt = mimeMatch && mimeMatch[1] ? mimeMatch[1].toLowerCase().replace('jpeg', 'jpg') : 'png'
  const blob = await (await fetch(dataUrl)).blob()
  const formData = new FormData()
  formData.append('file', blob, `paste-${Date.now()}.${mimeExt}`)
  if (sessionId.value) formData.append('sessionId', sessionId.value)
  // 上传加 60s 超时 + 401 明确提示（原实现原生 fetch 无超时无错误处理，失败静默丢弃）
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch('/api/agent/upload', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userStore.token}` },
      body: formData,
      signal: controller.signal,
    })
    if (!res.ok) {
      if (res.status === 401) throw new Error('登录已过期，请重新登录')
      const errText = await res.text().catch(() => '')
      throw new Error(errText || `上传失败 (${res.status})`)
    }
    const data = await res.json()
    return data?.data?.filePath ?? null
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error('图片上传超时（60s），请重试')
    throw e
  } finally {
    clearTimeout(timeoutId)
  }
}

function getMessageText(message: UIMessage): string {
  return message.parts.filter(p => p.type === 'text').map(p => (p as { text: string }).text).join('')
}

/** 从用户消息文本中提取已上传文件名列表（匹配 "[已上传文件：a、b]" 标记） */
function extractUploadedFileNames(text: string): string[] {
  if (!text) return []
  const match = text.match(/\[已上传文件：([^\]]+)\]/)
  if (!match) return []
  return match[1].split(/[、,，]/).map(s => s.trim()).filter(Boolean)
}

/** 用户消息：移除文件标签标记行后剩余的纯文本（供渲染） */
function getUserMessageTextWithoutFileTag(text: string): string {
  if (!text) return ''
  return text.replace(/\[已上传文件：[^\]]*\](\n+)?/g, '').trim()
}

/** 用户消息：是否为纯文件标签消息（无其他文字） */
function isOnlyFileTagMessage(text: string): boolean {
  if (!text) return false
  const cleaned = getUserMessageTextWithoutFileTag(text)
  return cleaned.length === 0
}

function getToolCallParts(message: UIMessage): any[] {
  // 静态 tool part type 形如 'tool-<工具名>'；dynamic-tool part type 为 'dynamic-tool'，两者都要渲染
  return message.parts.filter((p: any) => {
    if (typeof p?.type !== 'string') return false
    return p.type.startsWith('tool-') || p.type === 'dynamic-tool'
  })
}

function extractIssuesFromMessage(message: UIMessage): { issues: any[]; beforeText: string; afterText: string } {
  if (message.role !== 'assistant') return { issues: [], beforeText: '', afterText: '' }
  const text = getMessageText(message)
  if (!text) return { issues: [], beforeText: '', afterText: '' }
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/g
  const matches: { content: string; index: number; endIndex: number }[] = []
  let m: RegExpExecArray | null
  while ((m = jsonBlockRegex.exec(text)) !== null) {
    matches.push({ content: m[1], index: m.index, endIndex: m.index + m[0].length })
  }
  for (const match of matches) {
    try {
      const parsed = JSON.parse(match.content)
      if (Array.isArray(parsed) && parsed.length > 0) {
        const first = parsed[0]
        if (first && typeof first === 'object' && ('issueType' in first || 'originalText' in first || 'severity' in first)) {
          return { issues: parsed, beforeText: text.slice(0, match.index).trim(), afterText: text.slice(match.endIndex).trim() }
        }
      }
    } catch { /* ignore */ }
  }
  return { issues: [], beforeText: text, afterText: '' }
}

function hasIssues(message: UIMessage): boolean {
  return extractIssuesFromMessage(message).issues.length > 0
}

interface ReportLink { kind: 'md' | 'pdf'; url: string; fileName?: string; filePath?: string }
function extractReportLinks(message: UIMessage): ReportLink[] {
  if (message.role !== 'assistant') return []
  const links: ReportLink[] = []
  const seen = new Set<string>()

  // 1) 从消息文本的 JSON 块提取（旧逻辑，兼容 LLM 文本输出）
  const text = getMessageText(message)
  if (text) {
    const jsonBlockRegex = /```json\s*\n([\s\S]*?)\n```/g
    let m: RegExpExecArray | null
    while ((m = jsonBlockRegex.exec(text)) !== null) {
      try {
        const parsed = JSON.parse(m[1])
        const objs = Array.isArray(parsed) ? parsed : [parsed]
        for (const obj of objs) {
          if (obj && typeof obj === 'object') {
            if (obj.pdfPrintUrl) {
              links.push({ kind: 'pdf', url: obj.pdfPrintUrl, fileName: obj.fileName, filePath: obj.filePath })
            } else if (obj.downloadUrl || obj.filePath) {
              links.push({ kind: 'md', url: obj.downloadUrl || '', fileName: obj.fileName, filePath: obj.filePath })
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  // 2) 从消息 parts 的工具输出提取（download_report / write_report 的 <tool_result>）
  //    这是主要来源——LLM 常不把 downloadUrl 转述进文本，但工具结果一定在 parts 里
  for (const p of (message.parts as any[])) {
    const rawName = typeof p?.toolName === 'string' ? p.toolName : ''
    if (rawName !== 'download_report' && rawName !== 'write_report') continue
    const out = p?.output
    if (typeof out !== 'string') continue
    const jsonMatch = out.match(/\{[\s\S]*\}/)
    if (!jsonMatch) continue
    try {
      const obj = JSON.parse(jsonMatch[0])
      const filePath = obj.filePath
      if (typeof filePath !== 'string' || !filePath) continue
      const fileName = obj.fileName || filePath.split(/[\\/]/).pop() || 'report'
      const downloadUrl = obj.downloadUrl || ''
      const isPdf = !!obj.pdfPrintUrl
      // 兼容：downloadUrl 可能是相对路径，直接用（后端静态服务）
      const key = filePath + (isPdf ? '|pdf' : '')
      // 同一报告 write_report 与 download_report 各返回一次（同 filePath）。
      // 去重：保留「有 downloadUrl/pdfPrintUrl」的那条（download_report 完整），
      //   若已存在同 key 且当前更完整则替换（保证「下载」按钮可用）
      const existingIdx = links.findIndex((l) => (l.filePath === filePath) && (isPdf ? l.kind === 'pdf' : l.kind === 'md'))
      const candidate = isPdf ? { kind: 'pdf' as const, url: obj.pdfPrintUrl, fileName, filePath } : { kind: 'md' as const, url: downloadUrl, fileName, filePath }
      if (existingIdx === -1) {
        links.push(candidate)
        seen.add(key)
      } else {
        // 已存在：若现有条目 url 为空而当前有 url → 用当前替换（优先 download_report）
        const existing = links[existingIdx]
        if (!existing.url && candidate.url) links[existingIdx] = candidate
      }
    } catch { /* ignore */ }
  }
  return links
}

/**
 * /uploads/agent_temp/** 已加 JWT 鉴权（后端 2026-08-07 修复）：
 * 为下载/打印链接追加 token query，保证登录用户仍可访问（非 agent_temp 路径原样返回）
 */
function withToken(url: string): string {
  // 判断依据：URL 中含 /uploads/agent_temp（下载链接以它开头；
  // 打印页是 /agent/report-print?src=/uploads/... 前端路由，token 需加在外层 query）
  if (!url || !url.includes('/uploads/agent_temp')) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(userStore.token)}`
}

function downloadMd(url: string, fileName?: string) {
  const a = document.createElement('a'); a.href = withToken(url); a.download = fileName || ''; document.body.appendChild(a); a.click(); document.body.removeChild(a)
}
function openPrintPage(printUrl: string) {
  // 打印页自身是前端路由（/agent/report-print），token 追加在外层 URL 的 query，
  // ReportPrint.vue 读取 location.search 中的 token 后再请求 /uploads 原文
  window.open(withToken(printUrl), '_blank', 'noopener,noreferrer')
}

const showTypingIndicator = computed(() => {
  if (!isLoading.value) return false
  const last = messages.value[messages.value.length - 1]
  if (!last || last.role !== 'assistant') return true
  return getMessageText(last).length === 0
})

// 空会话（无消息且未在请求中）：显示居中输入框
const isEmptyNew = computed(() => messages.value.length === 0 && !isLoading.value)
// 压缩上下文可用性
const canCompact = computed(() => Boolean(sessionId.value) && messages.value.length > 0)
// 运行指示文字（对齐参考：按状态动态显示）
const runningText = computed(() => {
  if (!isLoading.value) return ''
  const last = messages.value[messages.value.length - 1]
  if (last && getToolCallParts(last).length > 0) return '正在运行工具…'
  return '正在思考…'
})

// ===== ChatMinimap（一比一复刻参考：消息元素 ref 收集，供组件测量定位）=====
const messageEls = ref<(HTMLElement | null)[]>([])

function collectMessageEl(idx: number) {
  return (el: unknown) => {
    messageEls.value[idx] = el as HTMLElement | null
  }
}

async function handleSend() {
  const text = inputValue.value.trim()
  if ((!text && attachedImages.value.length === 0) || isLoading.value) return
  inputValue.value = ''
  const parts: string[] = []
  // 文件标签：只列文件名（后端按 sessionId 注入的文件列表里含完整路径，无需在前端塞路径）
  if (uploadedFiles.value.length > 0) {
    const names = uploadedFiles.value.map(f => f.name)
    parts.push(`[已上传文件：${names.join('、')}]`)
  }
  if (attachedImages.value.length > 0) {
    const paths: string[] = []
    for (const img of attachedImages.value) {
      try {
        const p = await uploadImageDataUrl(img.dataUrl)
        if (p) paths.push(p)
      } catch (e) {
        // 修复：图片上传失败不再静默丢弃（用户以为已发送实际没发）
        ElMessage.error(`图片上传失败：${(e as Error)?.message || '未知错误'}`)
      }
    }
    if (paths.length > 0) parts.push(`[已上传图片：${paths.join('、')}]`)
    attachedImages.value = []
  }
  let finalText = text
  if (parts.length > 0) finalText = `${parts.join('\n')}\n\n${text}`
  // 发送瞬间清空文件标签（对齐参考：输入框恢复干净，不保留已发送的文件）
  uploadedFiles.value = []
  await sendMessage({ text: finalText })
  // 发送后刷新会话列表（修复原有 bug：新会话不立即出现）
  sessionListRef.value?.refresh?.()
}

function handleStop() { stop() }
function handleRegenerate() { if (!isLoading.value) regenerate() }

async function customUpload(options: { file: File }) {
  const file = options.file
  uploading.value = true
  try {
    // 图片格式不标签化：恢复为缩略图预览（走 attachedImages，与粘贴图片一致）
    if (getFileKind(file.name) === 'image') {
      const dataUrl = await readFileAsDataUrl(file)
      attachedImages.value.push({ dataUrl, previewUrl: dataUrl, fileName: file.name })
      return
    }
    const formData = new FormData(); formData.append('file', file)
    if (sessionId.value) formData.append('sessionId', sessionId.value)
    // 上传加 60s 超时 + 401 明确提示（原实现无超时，失败仅靠外层 catch）
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60_000)
    let res: Response
    try {
      res = await fetch('/api/agent/upload', { method: 'POST', headers: { Authorization: `Bearer ${userStore.token}` }, body: formData, signal: controller.signal })
    } finally {
      clearTimeout(timeoutId)
    }
    if (res.status === 401) throw new Error('登录已过期，请重新登录')
    if (!res.ok) { const errText = await res.text().catch(() => ''); throw new Error(errText || `上传失败 (${res.status})`) }
    const data = await res.json()
    if (data?.data?.sessionId) sessionId.value = data.data.sessionId
    uploadedFiles.value.push({
      name: file.name,
      size: file.size,
      path: data?.data?.filePath,
      kind: getFileKind(file.name),
    })
  } catch (e) {
    ElMessage.error((e as Error)?.message || '上传失败')
  } finally { uploading.value = false }
}

/** 读取文件为 DataURL（图片缩略图预览用） */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB'
  return (bytes / 1048576).toFixed(1) + 'MB'
}
function formatTime(value: string | number | Date): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

// ===== 拖拽上传 =====
const isDragOver = ref(false)
let dragCounter = 0
function onDragOver() { /* dragover 需要 preventDefault 才能触发 drop */ }
function onDragLeave(e: DragEvent) {
  // 只有离开整个容器才隐藏遮罩
  if (e.relatedTarget === null) {
    dragCounter = 0
    isDragOver.value = false
  }
}
function onDrop(e: DragEvent) {
  dragCounter = 0
  isDragOver.value = false
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  for (const file of Array.from(files)) {
    customUpload({ file })
  }
}

// 消息变化时自动滚动到底部 + 更新 minimap 状态 + 记录流事件时间戳（卡死守卫用）
watch(messages, () => {
  lastStreamEventAt = Date.now()
  nextTick(() => {
    messageEls.value.length = messages.value.length
    const el = messagesContainer.value
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })
}, { flush: 'post', deep: false })

// 流式错误提示（修复：原实现 error 解构后无人消费，流中断/500/断网完全静默——
// ai-sdk useChat 内部把错误置入 error 且不 reject promise，用户看到的是"空会话"）
watch(error, (err) => {
  if (err) {
    const msg = (err as any)?.message || String(err)
    console.error('[Agent] 流式对话错误:', msg)
    ElMessage.error(`对话中断：${msg.slice(0, 200)}${msg.length > 200 ? '…' : ''}（可点击停止后重发）`)
  }
})
// status 变 error 时同样提示（部分路径 error 对象可能为空但 status 已置 error）
// 注意：静止守卫最终化时主动 stop() 可能把 status 置为 error，此时对话实际已成功完成，不弹错误提示
watch(status, (s, prev) => {
  if (s === 'error' && prev !== 'error' && !stuckFinalized) {
    ElMessage.error('对话流已中断，请重试发送或刷新页面')
  }
})

// 流式结束时刷新 token 统计 + 强制重建 tool part（ai-sdk useChat 的 messages 是 shallowRef，
// 流式过程中 tool part 的 state/input/output 原地修改不触发重渲染，
// 导致工具调用块始终停留在"执行中"。流结束时重建 part 对象，让 Vue 渲染出最终状态）
watch(isLoading, (now, prev) => {
  if (now && !prev) {
    // 新一轮流开始：重置卡死守卫（上一轮可能已被 final 化）
    stuckFinalized = false
    lastStreamEventAt = Date.now()
  }
  if (prev && !now) {
    refreshStats()
    sessionListRef.value?.refresh?.()
    // 流式结束：先把最后一条 assistant 消息的过程详情置为展开。
    // useChat 的 messages 是 shallowRef，流式中 tool part 的 state/input/output 原地修改不触发渲染；
    // forceRefreshMessages 重建 part 后虽然能渲染出最终状态（output-available / success），
    // 但此刻 isLoading 已变 false，isStreamingTail 随之失效，process-details 默认折叠——
    // 若不先展开，用户将永远看不到工具从「执行中」到「成功」的最终结果。
    const lastMsg = messages.value[messages.value.length - 1]
    if (lastMsg && lastMsg.role === 'assistant' && hasProcessParts(lastMsg)) {
      processOpen[lastMsg.id] = true
    }
    forceRefreshMessages()
    // Task 44：流式结束检测是否有挂起提问
    scheduleCheckPendingAsk()
  }
})

// ============================================================
// 兜底修复：工具对话流终止守卫（2026-08-26 判据重构）
// 背景：@ai-sdk/vue 在工具调用对话中，ai 包内部流处理可能挂在 finish-step
// 之后的 job 上（transform 永不返回），导致 status 卡在 streaming、
// watch(isLoading) 的结束分支永不触发、工具块永远显示「执行中…」。
//
// 判据说明（为什么不用引用比较）：useChat 的 messages 是 shallowRef，
// pushMessage 是原地 push、replaceMessage 是同数组内原地替换——数组引用
// 在整个流式过程中从不变化，「引用连续 N 次未变」恒为真，根本无法区分
// 活跃流与卡死流（旧实现即基于这一错误假设，且在步骤间生成间隙 >2.4s 时
// 会误杀健康流）。现改为时间戳判据：
//   - 快路径：工具 parts 已全部 final 且 >8s 无任何新消息事件 → 即文档记录
//     的 finish-step 挂起形态，立即最终化；
//   - 慢路径：>180s 无任何新消息事件 → 绝对兜底（覆盖 part 卡在中间态的
//     形态）。阈值必须远大于最慢合法工具的执行时长——长工具执行期间没有
//     消息事件，不能误杀。
// 幂等：stuckFinalized 置位后不再执行；新一轮发送（isLoading 上升沿）与
// 会话切换时重置。守卫定时器常驻不清除（旧实现在首次触发后 clearInterval
// 导致后续会话永远失去守卫保护）。
// ============================================================
let stuckFinalized = false
let lastStreamEventAt = Date.now()
const STUCK_FINAL_IDLE_MS = 8_000      // 快路径：parts 全 final 后的静默阈值
const STUCK_ABSOLUTE_IDLE_MS = 180_000 // 慢路径：绝对兜底静默阈值

const finalizeStuckStream = () => {
  if (stuckFinalized) return
  stuckFinalized = true
  const lastMsg = messages.value[messages.value.length - 1]
  if (lastMsg && lastMsg.role === 'assistant' && hasProcessParts(lastMsg)) {
    processOpen[lastMsg.id] = true
  }
  refreshStats()
  sessionListRef.value?.refresh?.()
  forceRefreshMessages()
  // 尝试让 status 回落（abort 已静止的流；即使失败，上面的最终化也已让 UI 定型）
  stop()
}

const stuckGuardTimer = window.setInterval(() => {
  if (stuckFinalized || !isLoading.value) return
  const idleMs = Date.now() - lastStreamEventAt
  if (idleMs <= STUCK_FINAL_IDLE_MS) return
  const msgs = messages.value
  const last = msgs?.[msgs.length - 1]
  const toolParts = last && last.role === 'assistant' ? getToolCallParts(last) : []
  const allFinal =
    toolParts.length > 0 &&
    toolParts.every((p: any) => p.state === 'output-available' || p.state === 'output-error')
  // 快路径：全 final + 静默（finish-step 挂起）；慢路径：超长静默绝对兜底
  if (!allFinal && idleMs <= STUCK_ABSOLUTE_IDLE_MS) return
  finalizeStuckStream()
}, 1000)

// 会话切换时重置守卫状态，保证新会话仍能触发兜底
watch(sessionId, () => {
  stuckFinalized = false
  lastStreamEventAt = Date.now()
})

// 组件卸载时清理轮询，避免定时器泄漏
onBeforeUnmount(() => window.clearInterval(stuckGuardTimer))

function forceRefreshMessages() {
  const msgs = messages.value
  if (!msgs || msgs.length === 0) return
  messages.value = msgs.map((m: any) => ({
    ...m,
    parts: (m.parts || []).map((p: any) => ({ ...p })),
  })) as any
}

// ============================================================
// Task 44：ask_user 主动提问 — 挂起检测 + 提问对话框 + 回复重发
// ============================================================
const askDialogVisible = ref(false)
const askPending = ref<PendingAskResult | null>(null)
// 轮询挂起提问时的防重入（避免流未完全结束就轮询）
let askPollTimer: number | null = null

/** 流式结束后检测会话是否被 Agent 挂起 */
async function checkPendingAsk() {
  const sid = sessionId.value
  if (!sid) return
  try {
    const res = await getPendingAskApi(sid)
    const data = res.data?.data || null
    if (data) {
      askPending.value = data
      askDialogVisible.value = true
    }
  } catch {
    // 轮询失败静默（如路由未就绪），不影响主流程
  }
}

/** 用户提交回复 → 带 pendingAskAnswer 重发，Agent 续跑 */
async function onSubmitAsk(answer: string) {
  const data = askPending.value
  if (!data) return
  askDialogVisible.value = false
  pendingAskAnswer.value = { requestId: data.requestId, answer }
  await sendMessage({ text: `[用户回复] ${answer}` })
  pendingAskAnswer.value = null
  askPending.value = null
}

function onCancelAsk() {
  const data = askPending.value
  askDialogVisible.value = false
  askPending.value = null
  if (!data) return
  // 取消 = 用「[用户取消]」信号重发一次，让后端 resolvePendingById 取出并关闭挂起，
  // 避免下次流式结束重复弹窗
  pendingAskAnswer.value = { requestId: data.requestId, answer: '[用户取消]' }
  sendMessage({ text: '[用户取消]' }).catch(() => {})
  pendingAskAnswer.value = null
}

/** 在流式结束的 watch 里触发检测（延后一拍，确保消息已落盘） */
function scheduleCheckPendingAsk() {
  if (askPollTimer) window.clearTimeout(askPollTimer)
  askPollTimer = window.setTimeout(() => {
    checkPendingAsk()
  }, 300)
}

// 会话变化时刷新统计
watch(sessionId, () => { refreshStats() })
</script>

<style scoped>
/* ===== 主布局 ===== */
.agent-layout {
  display: flex;
  height: 100%;
  width: 100%;
  background: var(--bg);
  position: relative;
  overflow: hidden;
}

/* ===== 中间列 ===== */
.center-column {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

/* ===== 顶部工具栏（对齐参考项目：36px 高、按钮 36×36 + borderRight 分隔）===== */
.top-toolbar {
  height: var(--toolbar-height, 36px);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  overflow: hidden;
}
.toolbar-left, .toolbar-right {
  display: flex;
  align-items: center;
  gap: 0;
  height: 100%;
  min-width: 0;
}
/* 右组预留 36px：右上角固定悬浮的右面板开关按钮（right-panel-fab）会盖住
   最右元素——token 统计标签的右端，故整体让位 36px 避免遮挡 */
.toolbar-right {
  padding-right: 36px;
}
.top-toolbar .toolbar-icon-btn {
  width: 36px;
  height: 36px;
  border-radius: 0;
  border-right: 1px solid var(--border);
  flex-shrink: 0;
}
.toolbar-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 5px;
  padding: 0;
  transition: background 0.12s, color 0.12s;
}
.toolbar-icon-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text);
}
.toolbar-icon-btn:disabled {
  color: var(--text-dim);
  cursor: not-allowed;
  opacity: 0.6;
}
.toolbar-icon-btn.is-loading .el-icon {
  animation: agent-spin 0.9s linear infinite;
}
.toolbar-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 12px;
  padding-right: 4px;
}
.title-text {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}

/* token 统计按钮（对齐参考：可点击 + hover 高亮 + 展开态；gap 10 / 11px / tabular-nums / 图标 gap 4） */
.token-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 100%;
  padding: 0 8px;
  font-size: var(--text-sm);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.token-stats:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.token-stats.is-open {
  background: var(--bg-selected);
  color: var(--text);
}
.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.stat-cost {
  color: var(--text);
  font-weight: 500;
}
.stat-warning { color: var(--warning); }
.stat-danger { color: var(--danger); }

/* ===== 会话信息面板（对齐参考 AppShell session-info-popover：三栏 / mono / 复制按钮）===== */
.session-info-panel {
  display: grid;
  grid-template-columns: minmax(360px, 1.7fr) minmax(140px, 0.55fr) minmax(190px, 0.75fr);
  gap: 24px;
  padding: 12px 16px;
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.10);
  font-size: 12px;
  line-height: 1.5;
  font-family: var(--font-mono);
  z-index: 5;
}
.session-info-col {
  min-width: 0;
}
.sip-title {
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text);
  margin-bottom: 6px;
}
.sip-rows {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  column-gap: 12px;
  row-gap: 4px;
  align-items: start;
}
.session-info-col:nth-child(2) .sip-rows,
.session-info-col:nth-child(3) .sip-rows {
  grid-template-columns: max-content max-content;
  column-gap: 14px;
  justify-content: start;
}
.sip-row-label {
  color: var(--text-dim);
  white-space: nowrap;
}
.sip-row-value {
  color: var(--text-muted);
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
  white-space: normal;
}
.sip-num {
  white-space: nowrap;
  text-align: right;
}
.sip-row-action {
  display: flex;
}
.sip-copy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  margin-top: -2px;
  color: var(--text-dim);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
  cursor: pointer;
  flex: 0 0 auto;
  font-size: 12px;
  line-height: 1;
  padding: 0;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.sip-copy-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--bg-hover);
}
@media (max-width: 900px) {
  .session-info-panel {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}

/* 自动命名按钮：带文字，窄屏隐藏文字 */
.top-toolbar .auto-name-btn {
  width: auto;
  padding: 0 12px;
  gap: 6px;
}
.auto-name-label {
  font-size: var(--text-sm);
  white-space: nowrap;
}
@media (max-width: 640px) {
  .auto-name-label { display: none; }
}

/* ===== 聊天内容区 ===== */
.chat-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* ===== 消息列表（max-width 820 居中 + 右侧 36px minimap 留白）===== */
/* messages-wrap：相对定位容器，供 ChatMinimap 绝对定位在右侧、不随滚动 */
.messages-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
}
.messages-container {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 0 8px;
  background: var(--bg);
}

.chat-column {
  max-width: 820px;
  margin: 0 auto;
  padding: 0 16px;
  padding-right: 52px; /* 16 + 36（minimap 位） */
}

/* ===== 空会话（对齐参考：极简品牌行 + 居中输入框）===== */
.empty-chat {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow-y: auto;
  padding: 32px 16px;
  padding-right: 52px; /* 36 minimap 留白 */
}
.empty-inner {
  width: 100%;
  max-width: 820px;
}
.empty-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.brand-logo {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  color: var(--accent);
  font-size: 15px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
.brand-name {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text);
}
.empty-hint {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 14px;
}
.empty-chat-input {
  width: 100%;
}

/* ===== 消息行（无头像，纯气泡，对齐参考）===== */
.message-row {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
  align-items: flex-start;
}
.message-row.user {
  flex-direction: row-reverse;
}

.bubble-wrap {
  max-width: calc(100% - 40px);
  min-width: 0;
}
.message-row.user .bubble-wrap {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

/* 气泡基础：无统一 padding/圆角，按角色分别定义（对齐参考项目） */
.bubble {
  font-size: 14px;
  line-height: 1.65;
  word-break: break-word;
  min-width: 0;
}
/* user：淡蓝底 + 蓝色描边 + 四角统一 12px 圆角（参考项目，无小角），宽度内容自适应 */
.bubble.user {
  background: var(--user-bg);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 12px;
  padding: 8px 12px;
  color: var(--text);
  width: fit-content;
  max-width: 85%;
}
/* assistant：直接平铺在消息流中，无背景/边框/圆角（参考项目） */
.bubble.assistant {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  color: var(--text);
}
.text-content {
  white-space: pre-wrap;
}

/* ===== 过程详情折叠组（对齐参考 ProcessDetailsGroup：12px muted、chevron 旋转 90°、一键折叠所有过程）===== */
.process-details-group {
  margin-bottom: 20px;
}
.process-details-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  padding: 2px 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  text-align: left;
  width: auto;
  transition: color 0.12s;
}
.process-details-toggle:hover { color: var(--text); }
.process-details-toggle svg {
  flex-shrink: 0;
  color: var(--text-dim);
}
.process-details-toggle > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.process-details-meta {
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.process-details-body {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* ===== thinking 折叠块（对齐参考：圆角6、折叠头 bg-panel）===== */
.thinking-block {
  margin: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  background: var(--bg);
}
.thinking-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: var(--bg-panel);
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-muted);
  cursor: pointer;
  text-align: left;
}
.thinking-toggle:hover { color: var(--text); }
.thinking-duration {
  margin-left: auto;
  font-size: var(--text-sm);
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.thinking-text {
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-muted);
  white-space: pre-wrap;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
}

/* ===== Markdown 内容（主体样式在 agent-theme.css）===== */
.markdown-content { font-size: 14px; line-height: 1.7; }

/* ===== 气泡底部行：操作按钮 + 时间戳（对齐参考：flex 靠右、gap 8、marginTop 4、时间戳 marginLeft auto）===== */
.bubble-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
  padding-left: 4px;
}
.msg-time {
  font-size: var(--text-sm);
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}
.msg-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s;
}
.bubble-wrap:hover .msg-actions,
.msg-actions:focus-within {
  opacity: 1;
  pointer-events: auto;
}
.msg-action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  font-size: var(--text-sm);
  font-weight: 400;
  padding: 3px 8px;
  height: 22px;
  border-radius: 5px;
  white-space: nowrap;
  transition: color 0.12s;
}
.msg-action:hover {
  color: var(--accent);
}
.msg-action.is-active {
  color: var(--accent);
}
/* 纯图标操作按钮（复制/收藏/重新生成）：加大方块、图标居中 */
.msg-action.icon-only {
  width: 30px;
  height: 28px;
  padding: 0;
  justify-content: center;
}
.msg-action.icon-only .el-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
/* 收藏激活态：填充色背景 + 实心星（不是只改边框/描边色） */
.msg-action.is-saved {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
  color: var(--accent);
  border-radius: 6px;
}
.msg-action.is-saved .el-icon {
  color: var(--accent);
}

/* ===== 助手消息模型标签行（对齐参考：11px text-dim，marginBottom 4）===== */
.assistant-model-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  color: var(--text-dim);
  margin-bottom: 4px;
}

/* ===== 用户消息 markdown（对齐参考 markdown-user-message：仅 white-space: pre-wrap，无额外段落 margin）===== */
.markdown-user-message p {
  white-space: pre-wrap;
  margin: 0;
}

/* ===== 报告操作 ===== */
.report-actions {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* ===== 工具 chip（间距由 process-details-body 的 flex gap 控制）===== */
.tool-call-wrap {
  margin: 0;
}

/* ===== 运行指示器（对齐参考：纯文字脉冲）===== */
.running-indicator {
  display: flex;
  align-items: center;
  padding: 8px 0 12px;
  font-size: 13px;
  color: var(--text-muted);
}
.running-text {
  animation: agent-pulse 1.5s infinite;
}

/* ===== 已上传文件（对齐参考：透明、居中 chip，无整条背景）===== */
.uploaded-files {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start; /* 从左往右依次排列 */
  gap: 6px;
  padding: 6px 0;
  background: transparent;
  flex-shrink: 0;
  max-width: 100%;
}
/* 有消息分支：标签已置于 .input-area 内，与输入框共用 max-width 820 居中约束
   （.input-area > *），横向 padding 由 input-area 提供（16px 左右 + 52px minimap 留白） */
.uploaded-files-input {
  padding: 6px 0 0;
}
/* 用户消息内的文件标签块：左对齐，标签之间 gap */
.uploaded-files-in-msg {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: 6px;
  margin-bottom: 6px;
}
.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px 3px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--text);
  transition: border-color 0.15s, background 0.15s;
  max-width: 100%;
}
.file-chip:hover { border-color: var(--text-dim); }
.file-chip.has-path { cursor: pointer; }
.file-chip.has-path:hover { background: var(--bg-hover); border-color: var(--accent); }
.file-chip .el-icon { flex-shrink: 0; }
/* 按类型区分标签颜色 */
.file-chip.kind-image .el-icon { color: var(--color-success); }   /* 图片：绿 */
.file-chip.kind-image { border-color: color-mix(in srgb, var(--color-success) 35%, var(--border)); }
.file-chip.kind-pdf .el-icon { color: var(--color-danger); }     /* PDF：红 */
.file-chip.kind-pdf { border-color: color-mix(in srgb, var(--color-danger) 35%, var(--border)); }
.file-chip.kind-word .el-icon { color: var(--color-primary-500); }    /* Word：蓝 */
.file-chip.kind-word { border-color: color-mix(in srgb, var(--color-primary-500) 35%, var(--border)); }
.file-chip.kind-excel .el-icon { color: var(--color-success-600); }   /* Excel：绿 */
.file-chip.kind-excel { border-color: color-mix(in srgb, var(--color-success-600) 35%, var(--border)); }
.file-chip.kind-ppt .el-icon { color: var(--severity-major); }     /* PPT：橙 */
.file-chip.kind-ppt { border-color: color-mix(in srgb, var(--severity-major) 35%, var(--border)); }
.file-chip.kind-text .el-icon { color: var(--accent); } /* 文本：主题色 */
.file-chip.kind-text { border-color: color-mix(in srgb, var(--accent) 30%, var(--border)); }
.file-chip.kind-other .el-icon { color: var(--text-dim); }
.file-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { color: var(--text-dim); font-size: var(--text-sm); }
.file-remove {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 1px;
  border-radius: 3px;
}
.file-remove:hover { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, var(--bg)); }

/* ===== 输入区（对齐参考：背景透明、无分隔线、max-width 820 居中）===== */
.input-area {
  padding: 0 16px 10px;
  padding-right: 52px; /* 36 minimap 留白 */
  background: transparent;
  flex-shrink: 0;
}
.input-area > * {
  max-width: 820px;
  margin-left: auto;
  margin-right: auto;
}


/* ===== 右上角固定浮动按钮：右侧面板开关（对齐参考项目）===== */
.right-panel-fab {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  background: var(--bg-panel);
  border: none;
  border-left: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
  cursor: pointer;
  transition: color 0.12s, background 0.12s;
}
.right-panel-fab:hover {
  background: var(--bg-hover);
  color: var(--text);
}
.right-panel-fab.is-open {
  color: var(--text);
}

/* 侧边栏开关：打开态高亮（与右面板开关 is-open 一致的激活色） */
.top-toolbar .toolbar-side-btn.is-open {
  color: var(--text);
}

/* ===== P0-⑨ 知识来源卡片 ===== */
.kb-source-group {
  margin-top: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel);
}
.kb-source-header {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-dim);
  margin-bottom: 6px;
}
.kb-source-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--bg-selected);
  color: var(--text);
  font-size: var(--text-sm);
}
.kb-source-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.kb-source-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
.kb-source-item:hover { background: var(--bg-hover); }
.kb-source-doc {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kb-source-tag {
  flex-shrink: 0;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--bg-selected);
  color: var(--text-muted);
  font-size: var(--text-sm);
  font-family: var(--font-mono);
}
.kb-source-sim {
  flex-shrink: 0;
  font-size: var(--text-sm);
  color: var(--accent);
}
</style>
