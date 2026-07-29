<template>
  <div v-if="report" class="self-check-report-panel">
    <div class="sc-summary-bar">
      <el-tag type="info" effect="plain">检查 {{ items.length }} 条引用</el-tag>
      <el-tag type="success" effect="plain">完全匹配 {{ matchedCount }} 条</el-tag>
      <el-tag v-if="errorCount > 0" type="danger" effect="plain">存在问题 {{ errorCount }} 条</el-tag>
      <el-tag v-else type="success" effect="plain">全部正确</el-tag>
      <span class="sc-lib-info">{{ report.standardLibraryInfo?.name }}（{{ report.standardLibraryInfo?.total }} 条）</span>
    </div>
    <el-table
      :data="items"
      border stripe size="small"
      highlight-current-row
      @current-change="(row: any) => emit('select-item', row)"
    >
      <el-table-column type="index" label="#" width="42" />
      <el-table-column prop="sourceFile" label="来源文件" min-width="130" show-overflow-tooltip />
      <el-table-column label="文档中的标准" min-width="150">
        <template #default="{ row: it }">
          <div>{{ it.docStandardNo || '-' }}</div>
          <div class="sc-name-sub">{{ it.docStandardName || '' }}</div>
        </template>
      </el-table-column>
      <el-table-column label="错误类型" min-width="170">
        <template #default="{ row: it }">
          <template v-if="it.errorTypes?.length > 0">
            <el-tag v-for="et in it.errorTypes" :key="et" :type="errorTagType(et)" size="small" effect="dark" style="margin-right:3px;margin-bottom:2px;">
              {{ errorLabel(et) }}
            </el-tag>
          </template>
          <el-tag v-else-if="it.matchResult?.matched" type="success" size="small" effect="plain">一致</el-tag>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="正确标准" min-width="180" show-overflow-tooltip>
        <template #default="{ row: it }">
          <template v-if="it.matchResult?.matched">
            <div class="correct-text">{{ it.matchResult.libraryStandardNo || '-' }}</div>
            <div class="sc-name-sub correct-text">{{ it.matchResult.libraryStandardName || '' }}</div>
            <el-tag v-if="it.matchResult.libraryStandardStatus === 'ABOLISHED'" type="danger" size="small" effect="plain" style="margin-top:2px;">已废止</el-tag>
            <el-tag v-else-if="it.matchResult.libraryStandardStatus === 'UPCOMING'" type="warning" size="small" effect="plain" style="margin-top:2px;">即将实施</el-tag>
          </template>
          <span v-else>-</span>
        </template>
      </el-table-column>
      <el-table-column label="级别" width="52">
        <template #default="{ row: it }">
          <span v-if="(it.matchResult?.matchLevel ?? 0) > 0">L{{ it.matchResult.matchLevel }}</span>
          <span v-else class="no-match">∅</span>
        </template>
      </el-table-column>
    </el-table>
    <el-button type="primary" size="small" style="margin-top:10px;" @click="emit('export')">
      <el-icon><Download /></el-icon> 导出 Excel 报告
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Download } from '@element-plus/icons-vue'
import type { SelfCheckReport, SelfCheckReportItem } from './composables/useSelfCheck'

const props = defineProps<{
  report: SelfCheckReport | null
  items: SelfCheckReportItem[]
  errorTagType: (et: string) => 'danger' | 'warning' | 'info' | 'success' | 'primary'
  errorLabel: (et: string) => string
}>()

const emit = defineEmits<{
  (e: 'select-item', row: SelfCheckReportItem): void
  (e: 'export'): void
}>()

const matchedCount = computed(() =>
  props.items.filter((it) => it.matchResult?.matched && (it.errorTypes?.length ?? 0) === 0).length
)
const errorCount = computed(() => props.items.filter((it) => (it.errorTypes?.length ?? 0) > 0).length)
</script>

<style scoped>
.self-check-report-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  flex: 1;
  overflow: auto;
  min-width: 0;
  min-height: 0;
}

.sc-summary-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  background: var(--el-fill-color-lighter);
  border-radius: 8px;
}

.sc-lib-info {
  font-size: 12px;
  color: var(--el-text-color-placeholder);
  margin-left: auto;
}

.sc-name-sub {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.correct-text {
  color: var(--el-color-success);
}

.no-match {
  color: var(--el-color-danger);
  font-weight: 700;
  font-size: 16px;
}
</style>
