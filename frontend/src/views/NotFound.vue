<template>
  <div class="not-found">
    <div class="not-found__code">404</div>
    <div class="not-found__title">页面不存在</div>
    <div class="not-found__desc">您访问的页面可能已被移除或链接有误</div>
    <el-button type="primary" @click="goHome">返回审查中心</el-button>
  </div>
</template>

<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

const goHome = () => {
  router.push('/review-center')
}
</script>

<style scoped>
.not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--color-bg, #f5f7fa);
  text-align: center;
}

.not-found__code {
  font-size: 96px;
  font-weight: 700;
  color: var(--el-color-primary);
  line-height: 1;
}

.not-found__title {
  margin-top: 16px;
  font-size: 20px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}

.not-found__desc {
  margin: 8px 0 24px;
  font-size: 14px;
  color: var(--el-text-color-secondary);
}
</style>
