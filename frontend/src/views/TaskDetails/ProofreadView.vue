<template>
  <div class="proofread-view">
    <div class="toolbar">
      <div class="toolbar-left">
        <span class="issue-count">共发现 {{ issues.length }} 个问题</span>
        <el-tag size="small" type="danger">{{ errorCount }} 个错误</el-tag>
        <el-tag size="small" type="warning">{{ warningCount }} 个警告</el-tag>
        <el-tag size="small" type="info">{{ infoCount }} 个提示</el-tag>
      </div>
      <div class="toolbar-right">
        <el-button size="small" @click="acceptAll">全部采纳</el-button>
        <el-button size="small" @click="ignoreAll">全部忽略</el-button>
        <el-switch
          v-if="originalText"
          v-model="showHighlight"
          active-text="高亮"
          inactive-text="纯文本"
          style="margin-left: 12px"
        />
      </div>
    </div>

    <!-- 双栏视图（有全文时显示） -->
    <div v-if="originalText" class="dual-panel">
      <div class="panel original-panel">
        <div class="panel-header">原文</div>
        <div class="panel-content" ref="originalRef">
          <span
            v-for="(seg, idx) in originalSegments"
            :key="idx"
            :class="['text-segment', seg.class]"
            @click="seg.issueIndex != null && focusIssue(seg.issueIndex)"
          >{{ seg.text }}</span>
        </div>
      </div>
      <div class="panel corrected-panel">
        <div class="panel-header">修改建议</div>
        <div class="panel-content" ref="correctedRef">
          <span
            v-for="(seg, idx) in correctedSegments"
            :key="idx"
            :class="['text-segment', seg.class]"
          >{{ seg.text }}</span>
        </div>
      </div>
    </div>

    <!-- 底部问题列表 -->
    <div class="issue-list">
      <div
        v-for="(issue, idx) in activeIssues"
        :key="issue.id || idx"
        :class="['issue-item', `severity-${issue.severity}`, { 'is-active': activeIssueIndex === idx }]"
        @click="focusIssue(idx)"
      >
        <div class="issue-header">
          <el-tag :type="severityTagType(issue.severity)" size="small" effect="dark">
            {{ issue.severity === 'error' ? '错误' : issue.severity === 'warning' ? '警告' : '提示' }}
          </el-tag>
          <span class="issue-type">{{ issue.issueType }}</span>
          <span class="issue-desc">{{ issue.description }}</span>
        </div>
        <div class="issue-diff">
          <span class="original-text">{{ issue.originalText }}</span>
          <el-icon><ArrowRight /></el-icon>
          <span class="suggested-text">{{ issue.suggestedText || '（无建议）' }}</span>
        </div>
        <div class="issue-actions">
          <el-button size="small" type="primary" @click.stop="acceptIssue(idx)">采纳</el-button>
          <el-button size="small" @click.stop="ignoreIssue(idx)">忽略</el-button>
        </div>
      </div>
      <el-empty v-if="activeIssues.length === 0" description="所有问题已处理" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ArrowRight } from '@element-plus/icons-vue';
import type { IssueDetail } from './types/issue';

const props = defineProps<{
  /** 全文原文（可选，有则显示双栏高亮视图） */
  originalText?: string;
  /** 校对问题列表 */
  issues: IssueDetail[];
}>();

const emit = defineEmits<{
  accept: [index: number];
  ignore: [index: number];
  acceptAll: [];
  ignoreAll: [];
}>();

const showHighlight = ref(true);
const activeIssueIndex = ref<number | null>(null);

// 已处理的问题（采纳/忽略后从列表中移除）
const acceptedSet = ref(new Set<number>());
const ignoredSet = ref(new Set<number>());

const activeIssues = computed(() =>
  props.issues.filter((_, idx) => !acceptedSet.value.has(idx) && !ignoredSet.value.has(idx))
);

const errorCount = computed(() => activeIssues.value.filter(i => i.severity === 'error').length);
const warningCount = computed(() => activeIssues.value.filter(i => i.severity === 'warning').length);
const infoCount = computed(() => activeIssues.value.filter(i => i.severity === 'info').length);

// 将原文分段：普通文本 + 高亮问题
const originalSegments = computed(() => {
  if (!props.originalText || !showHighlight.value) {
    return [{ text: props.originalText || '', class: '', issueIndex: undefined as number | undefined }];
  }

  const segments: Array<{ text: string; class: string; issueIndex?: number }> = [];
  let remaining = props.originalText;

  const sortedIssues = activeIssues.value
    .map((issue, idx) => {
      const realIdx = props.issues.indexOf(issue);
      return { issue, idx: realIdx, offset: (issue as any).textPosition?.charOffset };
    })
    .sort((a, b) => (a.offset ?? -1) - (b.offset ?? -1));

  for (const { issue, idx } of sortedIssues) {
    let pos = -1;
    if ((issue as any).textPosition?.charOffset != null) {
      pos = (issue as any).textPosition.charOffset;
      if (pos < 0 || pos >= remaining.length) pos = -1;
    }
    if (pos === -1) {
      pos = remaining.indexOf(issue.originalText);
    }
    if (pos === -1) continue;

    if (pos > 0) {
      segments.push({ text: remaining.slice(0, pos), class: '', issueIndex: undefined });
    }

    segments.push({
      text: issue.originalText,
      class: `highlight-${issue.severity}`,
      issueIndex: idx,
    });

    remaining = remaining.slice(pos + issue.originalText.length);
  }

  if (remaining) {
    segments.push({ text: remaining, class: '', issueIndex: undefined });
  }

  return segments.length > 0 ? segments : [{ text: props.originalText, class: '', issueIndex: undefined }];
});

// 修改后的文本（采纳建议后）
const correctedSegments = computed(() => {
  if (!props.originalText || !showHighlight.value) {
    return [{ text: props.originalText || '', class: '' }];
  }

  let text = props.originalText;
  const corrections: Array<{ original: string; suggested: string; severity: string }> = [];

  activeIssues.value.forEach(issue => {
    corrections.push({
      original: issue.originalText,
      suggested: issue.suggestedText || issue.originalText,
      severity: issue.severity,
    });
  });

  corrections.sort((a, b) => text.indexOf(b.original) - text.indexOf(a.original));

  const segments: Array<{ text: string; class: string }> = [];
  corrections.forEach(corr => {
    const pos = text.lastIndexOf(corr.original);
    if (pos === -1) return;

    const after = text.slice(pos + corr.original.length);
    if (after) segments.unshift({ text: after, class: '' });

    segments.unshift({ text: corr.suggested, class: `highlight-${corr.severity}` });

    text = text.slice(0, pos);
  });

  if (text) segments.unshift({ text, class: '' });

  return segments.length > 0 ? segments : [{ text: props.originalText || '', class: '' }];
});

function focusIssue(index: number) {
  activeIssueIndex.value = index;
}

function severityTagType(severity: string) {
  return severity === 'error' ? 'danger' : severity === 'warning' ? 'warning' : 'info';
}

function acceptIssue(index: number) {
  acceptedSet.value.add(index);
  emit('accept', index);
}

function ignoreIssue(index: number) {
  ignoredSet.value.add(index);
  emit('ignore', index);
}

function acceptAll() {
  activeIssues.value.forEach((_, i) => {
    const realIdx = props.issues.indexOf(activeIssues.value[i]);
    acceptedSet.value.add(realIdx);
  });
  emit('acceptAll');
}

function ignoreAll() {
  activeIssues.value.forEach((_, i) => {
    const realIdx = props.issues.indexOf(activeIssues.value[i]);
    ignoredSet.value.add(realIdx);
  });
  emit('ignoreAll');
}
</script>

<style scoped>
.proofread-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  gap: 12px;
}

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #f5f7fa;
  border-radius: 4px;
  flex-shrink: 0;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dual-panel {
  display: flex;
  gap: 12px;
  flex: 1;
  min-height: 300px;
  max-height: 50%;
}

.panel {
  flex: 1;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.panel-header {
  padding: 8px 12px;
  background: #f5f7fa;
  border-bottom: 1px solid #e4e7ed;
  font-weight: bold;
  font-size: 13px;
  flex-shrink: 0;
}

.panel-content {
  padding: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.8;
  font-size: 14px;
  flex: 1;
  overflow-y: auto;
}

.text-segment {
  cursor: pointer;
  transition: background-color 0.2s;
}

.highlight-error {
  background-color: #fef0f0;
  border-bottom: 2px solid #f56c6c;
}

.highlight-warning {
  background-color: #fdf6ec;
  border-bottom: 2px solid #e6a23c;
}

.highlight-info {
  background-color: #f0f9eb;
  border-bottom: 2px solid #67c23a;
}

.issue-list {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  flex-shrink: 0;
}

.issue-item {
  padding: 8px 12px;
  border-bottom: 1px solid #ebeef5;
  cursor: pointer;
  transition: background-color 0.2s;
}

.issue-item:hover { background-color: #f5f7fa; }
.issue-item.is-active { background-color: #ecf5ff; }
.issue-item:last-child { border-bottom: none; }

.issue-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.issue-type {
  font-size: 12px;
  color: #909399;
}

.issue-desc {
  font-size: 13px;
  color: #303133;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.issue-diff {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-family: monospace;
  font-size: 13px;
}

.original-text {
  color: #f56c6c;
  text-decoration: line-through;
}

.suggested-text {
  color: #67c23a;
  font-weight: bold;
}

.issue-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
</style>