<template>
  <div class="knowledge-qa">
    <!-- 头部 -->
    <div class="qa-header">
      <span class="qa-title">知识库问答</span>
      <span class="qa-sub">Agent 检索知识库（MaxKB）后生成回答</span>
    </div>

    <!-- 消息区 -->
    <div ref="threadRef" class="qa-thread">
      <div v-if="messages.length === 0" class="qa-empty">
        <el-icon :size="36" color="#9ca3af"><Search /></el-icon>
        <p>输入问题，Agent 将检索知识库后回答</p>
        <div class="qa-suggestions">
          <button
            v-for="s in suggestions"
            :key="s"
            class="qa-suggestion"
            @click="ask(s)"
          >
            {{ s }}
          </button>
        </div>
      </div>

      <div v-for="m in messages" :key="m.id" class="qa-message" :class="m.role">
        <div v-if="m.role === 'assistant'" class="qa-avatar">AI</div>
        <div class="qa-bubble" v-html="renderMarkdown(textOf(m))" />
      </div>

      <div v-if="isLoading" class="qa-typing">
        <el-icon class="is-loading"><Loading /></el-icon>
        <span>Agent 正在检索知识库并生成回答…</span>
      </div>
    </div>

    <!-- 输入区 -->
    <div class="qa-input">
      <el-input
        v-model="input"
        type="textarea"
        :rows="2"
        resize="none"
        placeholder="输入问题，Enter 发送，Shift+Enter 换行"
        @keydown.enter.exact.prevent="submit"
      />
      <div class="qa-input-actions">
        <el-button
          type="primary"
          :icon="Promotion"
          :loading="isLoading"
          :disabled="!input.trim()"
          @click="submit"
        >
          发送
        </el-button>
        <el-button v-if="isLoading" type="danger" plain :icon="VideoPause" @click="stop">
          停止
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import { Search, Promotion, VideoPause, Loading } from '@element-plus/icons-vue'
import { useUserStore } from '@/stores/user'
import { useMarkdown } from '@/composables/useMarkdown'

/**
 * KnowledgeQA — 知识库问答（集成入 Node Agent）
 *
 * 2026-08-03：替代 OpenSpec 的 ProjectQA（原调 Python Agent /agent/workflow/chat/stream）。
 * 现在直接走 Node Agent 的 /api/agent/chat/stream，Agent 通过内置工具
 * search_maxkb_knowledge 检索知识库后生成回答。无 sessionId 时后端自动建会话。
 */

const userStore = useUserStore()
const { renderMarkdown } = useMarkdown()

const transport = new DefaultChatTransport({
  api: '/api/agent/chat/stream',
  headers: () => ({ Authorization: `Bearer ${userStore.token}` }),
  credentials: 'include',
})

const { messages, status, sendMessage, stop } = useChat({ transport })

const isLoading = computed(
  () => status.value === 'submitted' || status.value === 'streaming',
)

const input = ref('')

const suggestions = [
  '最新审查相关的规范要求有哪些？',
  '帮我检索施工方案编制的标准要点',
  '本项目知识库中关于质量验收的条款',
]

/** 从 UIMessage 提取纯文本（text parts 拼接） */
function textOf(m: { parts?: Array<{ type: string; text?: string }> }): string {
  if (!m.parts) return ''
  return (m.parts as Array<{ type: string; text?: string }>)
    .filter(p => p.type === 'text' && p.text)
    .map(p => p.text)
    .join('\n')
}

function ask(q: string) {
  input.value = q
  submit()
}

function submit() {
  const q = input.value.trim()
  if (!q || isLoading.value) return
  input.value = ''
  sendMessage({ text: q })
}

// 自动滚动到底部
const threadRef = ref<HTMLElement | null>(null)
watch(
  () => messages.value.length,
  async () => {
    await nextTick()
    if (threadRef.value) threadRef.value.scrollTop = threadRef.value.scrollHeight
  },
)
</script>

<style scoped>
.knowledge-qa {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 480px;
  background: var(--bg, #fff);
  border-radius: 8px;
  border: 1px solid var(--border, #e5e7eb);
  overflow: hidden;
}

.qa-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border, #e5e7eb);
  background: var(--bg-panel, #fafafa);
}

.qa-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text, #1f2937);
}

.qa-sub {
  font-size: 12px;
  color: var(--text-dim, #9ca3af);
}

.qa-thread {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: thin;
}

.qa-empty {
  margin: auto;
  text-align: center;
  color: var(--text-dim, #9ca3af);
}

.qa-suggestions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
  align-items: center;
}

.qa-suggestion {
  background: var(--bg-subtle, #f3f4f6);
  border: 1px solid var(--border, #e5e7eb);
  border-radius: 16px;
  padding: 6px 14px;
  font-size: 13px;
  color: var(--text, #1f2937);
  cursor: pointer;
  transition: background 0.15s;
}

.qa-suggestion:hover {
  background: var(--bg-hover, #eef2ff);
}

.qa-message {
  display: flex;
  gap: 8px;
  max-width: 85%;
}

.qa-message.user {
  align-self: flex-end;
}

.qa-message.assistant {
  align-self: flex-start;
}

.qa-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--accent, #2563eb);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.qa-bubble {
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
  background: var(--assistant-bg, #f3f4f6);
  color: var(--text, #1f2937);
}

.qa-message.user .qa-bubble {
  background: var(--user-bg, #2563eb);
  color: #fff;
}

.qa-typing {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim, #9ca3af);
  padding: 4px 0;
}

.qa-input {
  padding: 12px 16px;
  border-top: 1px solid var(--border, #e5e7eb);
  background: var(--bg-panel, #fafafa);
}

.qa-input-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
