<template>
  <el-dropdown v-if="!isSelfCheck" @command="(cmd: string) => emit('command', cmd)" trigger="click">
    <el-button class="export-action-btn">
      <el-icon><Download /></el-icon> 导出报告
      <el-icon class="el-icon--right"><ArrowDown /></el-icon>
    </el-button>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item command="word">
          <el-icon><Document /></el-icon>导出 Word
        </el-dropdown-item>
        <el-dropdown-item command="excel">
          <el-icon><Tickets /></el-icon>导出 Excel
        </el-dropdown-item>
        <el-dropdown-item divided command="print">
          <el-icon><Printer /></el-icon>打印报告
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { Download, ArrowDown, Document, Tickets, Printer } from '@element-plus/icons-vue'

defineProps<{
  isSelfCheck: boolean
}>()

const emit = defineEmits<{
  (e: 'command', cmd: string): void
}>()
</script>
