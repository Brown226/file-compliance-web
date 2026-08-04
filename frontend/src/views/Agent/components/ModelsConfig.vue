<template>
  <!-- Agent 对话内的 Provider 配置弹窗：复用统一公共组件（参考项目 pi 两级树风格） -->
  <ProviderConfigPanel mode="dialog" @close="emit('close')" @saved="emit('saved')" />
</template>

<script setup lang="ts">
import ProviderConfigPanel from '@/components/provider-config/ProviderConfigPanel.vue'

const emit = defineEmits<{ close: []; saved: [] }>()
</script>
