<template>
  <el-alert v-if="show" class="load-fail-alert" type="error" show-icon :closable="false">
    <template #title>{{ message }}</template>
    <div class="load-fail-alert__actions">
      <el-button size="small" @click="$emit('retry')">重试</el-button>
    </div>
  </el-alert>
</template>

<script setup lang="ts">
/**
 * 后台页面通用的「配置/数据加载失败」横幅。
 * 存在意义：静默失败会让表单显示代码默认值而非线上真实值，
 * 用户一旦点保存就把假配置写库——必须显式暴露并允许重试。
 */
withDefaults(defineProps<{
  show: boolean
  message?: string
}>(), {
  message: '数据加载失败，当前显示的可能不是最新内容',
})

defineEmits<{ retry: [] }>()
</script>

<style scoped>
.load-fail-alert {
  margin-bottom: 16px;
}

.load-fail-alert__actions {
  margin-top: 8px;
}
</style>
