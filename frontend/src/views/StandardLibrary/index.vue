<template>
  <div class="standard-library-container">
    <el-tabs v-model="activeTab" class="standard-tabs">
      <el-tab-pane label="本地标准" name="local">
        <LocalStandardTab />
      </el-tab-pane>
      <el-tab-pane label="MaxKB 知识库" name="maxkb">
        <MaxKBTab />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import LocalStandardTab from './LocalStandardTab.vue'
import MaxKBTab from './MaxKBTab.vue'

const activeTab = ref('local')
</script>

<style scoped>
.standard-library-container { padding: 20px; height: 100%; }
.standard-tabs { height: 100%; }
</style>
