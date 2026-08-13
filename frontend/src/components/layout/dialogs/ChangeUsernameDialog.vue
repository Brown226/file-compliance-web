<template>
  <el-dialog v-model="visible" title="修改登录账号" width="420px" destroy-on-close>
    <el-form ref="usernameFormRef" :model="usernameForm" :rules="usernameRules" label-width="100px">
      <el-form-item label="当前账号">
        <el-input :model-value="userStore.userInfo?.username" disabled />
      </el-form-item>
      <el-form-item label="新账号" prop="newUsername">
        <el-input v-model="usernameForm.newUsername" placeholder="请输入新登录账号" maxlength="50" show-word-limit />
      </el-form-item>
      <el-form-item label="登录密码" prop="password">
        <el-input v-model="usernameForm.password" type="password" show-password placeholder="请输入当前密码验证身份" />
      </el-form-item>
    </el-form>
    <template #footer>
      <span class="dialog-footer">
        <el-button @click="visible = false">取消</el-button>
        <el-button type="primary" :loading="usernameLoading" @click="submitUsernameChange">确认修改</el-button>
      </span>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { changeUsernameApi, loginApi } from '@/api/auth'
import { useUserStore } from '@/stores/user'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

const visible = computed({
  get: () => props.modelValue,
  set: (val: boolean) => emit('update:modelValue', val),
})

const userStore = useUserStore()

const usernameLoading = ref(false)
const usernameFormRef = ref<FormInstance>()

const usernameForm = reactive({
  newUsername: '',
  password: '',
})

const usernameRules = reactive<FormRules>({
  newUsername: [
    { required: true, message: '请输入新登录账号', trigger: 'blur' },
    { min: 2, message: '账号长度不能小于2位', trigger: 'blur' },
    { max: 50, message: '账号长度不能超过50位', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]+$/, message: '账号只能包含字母、数字和下划线', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入当前密码验证身份', trigger: 'blur' },
  ],
})

// 打开对话框时预填当前账号并重置表单校验状态
watch(visible, (val) => {
  if (val) {
    usernameForm.newUsername = userStore.userInfo?.username || ''
    usernameForm.password = ''
    usernameFormRef.value?.resetFields()
  }
})

const submitUsernameChange = async () => {
  if (!usernameFormRef.value) return
  await usernameFormRef.value.validate(async (valid) => {
    if (valid) {
      usernameLoading.value = true
      try {
        await changeUsernameApi({
          newUsername: usernameForm.newUsername,
          password: usernameForm.password,
        })
        ElMessage.success('登录账号修改成功')
        visible.value = false
        // 用新账号重新登录刷新用户信息
        const { data } = await loginApi({
          username: usernameForm.newUsername,
          password: usernameForm.password,
        })
        userStore.setToken(data.token)
        userStore.setUserInfo(data.user)
      } catch (error: any) {
        ElMessage.error(error?.response?.data?.message || '修改失败')
      } finally {
        usernameLoading.value = false
      }
    }
  })
}
</script>
