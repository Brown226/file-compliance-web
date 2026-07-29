<template>
  <div class="review-center">
    <Workspace />
  </div>
</template>

<script setup lang="ts">
import Workspace from '@/views/Workspace.vue'
</script>

<style scoped>
.review-center {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
