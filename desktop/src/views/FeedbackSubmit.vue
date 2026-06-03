<template>
  <div class="feedback-submit-container">
    <el-card shadow="never" class="feedback-card">
      <template #header>
        <div class="card-header">
          <h3>提交反馈建议</h3>
          <p class="header-desc">我们重视您的每一条反馈，这将帮助我们持续改进产品</p>
        </div>
      </template>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-width="100px"
        label-position="top"
        class="feedback-form"
      >
        <!-- 反馈类别 -->
        <el-form-item label="反馈类别" prop="category">
          <el-radio-group v-model="form.category">
            <el-radio-button value="BUG_REPORT">Bug报告</el-radio-button>
            <el-radio-button value="SUGGESTION">建议</el-radio-button>
            <el-radio-button value="FEATURE_REQUEST">功能请求</el-radio-button>
            <el-radio-button value="OTHER">其他</el-radio-button>
          </el-radio-group>
        </el-form-item>

        <!-- 反馈标题 -->
        <el-form-item label="标题" prop="title">
          <el-input
            v-model="form.title"
            placeholder="请输入反馈标题（2-50个字符）"
            maxlength="50"
            show-word-limit
            clearable
          />
        </el-form-item>

        <!-- 反馈内容 -->
        <el-form-item label="详细内容" prop="content">
          <el-input
            v-model="form.content"
            type="textarea"
            :rows="8"
            placeholder="请详细描述您的反馈内容，包括：&#10;1. 问题描述或建议内容&#10;2. 复现步骤（如果是Bug）&#10;3. 期望的结果&#10;4. 其他补充说明"
            maxlength="2000"
            show-word-limit
            resize="vertical"
          />
        </el-form-item>

        <!-- 文件上传 -->
        <el-form-item label="附件上传（可选）">
          <div class="upload-section">
            <el-upload
              v-model:file-list="fileList"
              :action="uploadUrl"
              :auto-upload="false"
              :on-change="handleFileChange"
              :before-upload="beforeUpload"
              :on-remove="handleFileRemove"
              :limit="10"
              :on-exceed="handleExceed"
              multiple
              drag
              accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            >
              <el-icon class="el-icon--upload"><upload-filled /></el-icon>
              <div class="el-upload__text">
                将文件拖到此处，或<em>点击上传</em>
              </div>
              <template #tip>
                <div class="el-upload__tip">
                  支持图片、PDF、Word、Excel格式，单文件不超过10MB，最多10个文件，总大小不超过50MB
                </div>
              </template>
            </el-upload>

            <!-- 文件列表预览 -->
            <div v-if="fileList.length > 0" class="file-preview-list">
              <h4>已选文件：</h4>
              <el-tag
                v-for="(file, index) in fileList"
                :key="index"
                closable
                @close="handleFileRemove(file)"
                class="file-tag"
              >
                <el-icon><Document /></el-icon>
                {{ file.name }} ({{ formatFileSize(file.size) }})
              </el-tag>
            </div>
          </div>
        </el-form-item>

        <!-- 提交按钮 -->
        <el-form-item>
          <el-button
            type="primary"
            @click="handleSubmit"
            :loading="submitting"
            size="large"
          >
            {{ submitting ? '提交中...' : '提交反馈' }}
          </el-button>
          <el-button @click="handleReset" size="large">重置</el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { ElMessage, type FormInstance, type FormRules, type UploadUserFile } from 'element-plus'
import { UploadFilled, Document } from '@element-plus/icons-vue'
import { createFeedbackApi } from '@/api/feedback'
import type { FeedbackCategory } from '@/types/models'

const formRef = ref<FormInstance>()
const submitting = ref(false)
const fileList = ref<UploadUserFile[]>([])

// 表单数据
const form = reactive({
  category: 'SUGGESTION' as FeedbackCategory,
  title: '',
  content: '',
})

// 表单验证规则
const rules: FormRules = {
  category: [
    { required: true, message: '请选择反馈类别', trigger: 'change' },
  ],
  title: [
    { required: true, message: '请输入反馈标题', trigger: 'blur' },
    { min: 2, max: 50, message: '标题长度为2-50个字符', trigger: 'blur' },
  ],
  content: [
    { required: true, message: '请输入反馈内容', trigger: 'blur' },
    { min: 10, max: 2000, message: '内容长度为10-2000个字符', trigger: 'blur' },
  ],
}

// 上传URL（实际由前端处理）
const uploadUrl = computed(() => '/api/feedback')

// 文件大小限制
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const MAX_TOTAL_SIZE = 50 * 1024 * 1024 // 50MB

// 文件上传前验证
const beforeUpload = (file: File) => {
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]

  if (!allowedTypes.includes(file.type)) {
    ElMessage.error(`文件格式不支持: ${file.name}`)
    return false
  }

  if (file.size > MAX_FILE_SIZE) {
    ElMessage.error(`文件大小超过10MB限制: ${file.name}`)
    return false
  }

  return true
}

// 文件改变
const handleFileChange = (file: UploadUserFile, files: UploadUserFile[]) => {
  // 验证总大小
  const totalSize = files.reduce((sum, f) => sum + (f.size || 0), 0)
  if (totalSize > MAX_TOTAL_SIZE) {
    ElMessage.error('文件总大小超过50MB限制')
    files.pop()
    return
  }
}

// 文件移除
const handleFileRemove = (file: UploadUserFile) => {
  const index = fileList.value.indexOf(file)
  if (index > -1) {
    fileList.value.splice(index, 1)
  }
}

// 文件超出限制
const handleExceed = () => {
  ElMessage.warning('最多只能上传10个文件')
}

// 格式化文件大小
const formatFileSize = (bytes?: number): string => {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i]
}

// 提交表单
const handleSubmit = async () => {
  if (!formRef.value) return

  await formRef.value.validate(async (valid) => {
    if (!valid) return

    submitting.value = true
    try {
      // 构建FormData
      const formData = new FormData()
      formData.append('title', form.title)
      formData.append('content', form.content)
      formData.append('category', form.category)

      // 添加文件
      fileList.value.forEach((file) => {
        if (file.raw) {
          formData.append('files', file.raw)
        }
      })

      // 提交
      await createFeedbackApi(formData)
      ElMessage.success('反馈提交成功！')

      // 重置表单
      handleReset()
    } catch (error: any) {
      ElMessage.error(error.response?.data?.error || '提交失败，请稍后重试')
    } finally {
      submitting.value = false
    }
  })
}

// 重置表单
const handleReset = () => {
  formRef.value?.resetFields()
  fileList.value = []
  form.category = 'SUGGESTION'
}
</script>

<style scoped>
.feedback-submit-container {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}

.feedback-card {
  border-radius: 8px;
}

.card-header h3 {
  margin: 0 0 8px;
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}

.header-desc {
  margin: 0;
  font-size: 14px;
  color: #909399;
}

.feedback-form {
  padding: 20px 0;
}

.upload-section {
  width: 100%;
}

.file-preview-list {
  margin-top: 16px;
}

.file-preview-list h4 {
  margin: 0 0 8px;
  font-size: 14px;
  color: #606266;
}

.file-tag {
  margin-right: 8px;
  margin-bottom: 8px;
}

:deep(.el-upload-dragger) {
  padding: 40px;
}

:deep(.el-upload__tip) {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}
</style>
