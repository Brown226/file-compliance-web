<template>
  <el-dialog v-model="dialogVisible" title="标记误报" width="460px" destroy-on-close>
    <el-form label-position="top">
      <el-form-item label="误报原因（选填）">
        <el-input
          v-model="reasonInput"
          type="textarea"
          :rows="3"
          placeholder="请说明为何认为此结果是误报，例如：这不是错别字，是专业术语"
          maxlength="500"
          show-word-limit
        />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogVisible = false">取消</el-button>
      <el-button type="primary" @click="handleConfirm" :loading="submitting">确认标记</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  modelValue: boolean
  submitting: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [reason: string]
}>()

const dialogVisible = ref(props.modelValue)
const reasonInput = ref('')

watch(() => props.modelValue, (val) => {
  dialogVisible.value = val
  if (val) reasonInput.value = ''
})

watch(dialogVisible, (val) => {
  emit('update:modelValue', val)
})

const handleConfirm = () => {
  emit('confirm', reasonInput.value.trim())
}
</script>
