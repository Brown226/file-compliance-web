<template>
  <div class="new-task-container">
    <el-card class="box-card">
      <template #header>
        <div class="card-header">
          <span>新建审查任务</span>
        </div>
      </template>
      
      <el-form :model="form" :rules="rules" ref="formRef" label-width="120px" class="task-form">
        <el-form-item label="上传文件" prop="files" class="upload-item">
          <el-upload
            class="upload-area"
            drag
            multiple
            :auto-upload="false"
            :on-change="handleFileChange"
            :on-remove="handleFileRemove"
            :file-list="fileList"
            accept=".dwg,.doc,.docx,.xls,.xlsx,.pdf"
          >
            <el-icon class="el-icon--upload"><upload-filled /></el-icon>
            <div class="el-upload__text">
              将文件拖到此处，或 <em>点击上传</em>
            </div>
            <template #tip>
              <div class="el-upload__tip">
                支持批量上传 DWG, Word, Excel, PDF 格式文件。
              </div>
            </template>
            <template #file="{ file }">
              <div class="custom-file-item">
                <div class="file-info">
                  <el-icon class="file-icon"><Document /></el-icon>
                  <span class="file-name" :title="file.name">{{ file.name }}</span>
                </div>
                <div class="file-actions">
                  <span class="file-size">{{ formatFileSize(file.size) }}</span>
                  <el-button 
                    class="remove-btn" 
                    type="danger" 
                    link 
                    @click="handleRemoveCustom(file)"
                  >
                    <el-icon><Close /></el-icon>
                  </el-button>
                </div>
              </div>
            </template>
          </el-upload>
        </el-form-item>

        <el-form-item label="审查标准" prop="standard">
          <el-select v-model="form.standard" placeholder="请选择适用的审查标准" style="width: 100%">
            <el-option label="建筑工程设计文件编制深度规定 (2016版)" value="standard-1" />
            <el-option label="房屋建筑制图统一标准 (GB/T 50001-2017)" value="standard-2" />
            <el-option label="建筑设计防火规范 (GB 50016-2014)" value="standard-3" />
            <el-option label="企业自定义标准 V1.0" value="standard-4" />
          </el-select>
        </el-form-item>
        
        <el-form-item label="任务描述" prop="description">
          <el-input 
            v-model="form.description" 
            type="textarea" 
            :rows="3"
            placeholder="请输入任务描述 (选填)" 
          />
        </el-form-item>
        
        <el-form-item>
          <div class="form-actions">
            <el-button type="primary" :loading="submitting" @click="submitTask" size="large">开始审查</el-button>
            <el-button @click="resetForm" size="large">重置</el-button>
          </div>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { UploadFilled, Document, Close } from '@element-plus/icons-vue';
import type { UploadFile, UploadFiles, FormInstance, FormRules } from 'element-plus';

const router = useRouter();
const formRef = ref<FormInstance>();

const form = reactive({
  standard: '',
  description: ''
});

const rules = reactive<FormRules>({
  standard: [
    { required: true, message: '请选择适用的审查标准', trigger: 'change' }
  ]
});

const fileList = ref<UploadFile[]>([]);
const submitting = ref(false);

const allowedExtensions = ['.dwg', '.doc', '.docx', '.xls', '.xlsx', '.pdf'];

const handleFileChange = (uploadFile: UploadFile, uploadFiles: UploadFiles) => {
  const fileName = uploadFile.name.toLowerCase();
  const isValidType = allowedExtensions.some(ext => fileName.endsWith(ext));
  
  if (!isValidType) {
    ElMessage.error(`文件 ${uploadFile.name} 格式不正确，仅支持: ${allowedExtensions.join(', ')}`);
    // Element Plus 会自动把刚选的文件加到 uploadFiles，需要手动移除
    const index = uploadFiles.indexOf(uploadFile);
    if (index !== -1) {
      uploadFiles.splice(index, 1);
    }
  }
  
  fileList.value = [...uploadFiles];
};

const handleFileRemove = (_uploadFile: UploadFile, uploadFiles: UploadFiles) => {
  fileList.value = [...uploadFiles];
};

const handleRemoveCustom = (file: UploadFile) => {
  const index = fileList.value.findIndex(item => item.uid === file.uid);
  if (index !== -1) {
    fileList.value.splice(index, 1);
  }
};

const formatFileSize = (size?: number) => {
  if (size === undefined || size === null) return '未知大小';
  if (size === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(size) / Math.log(k));
  return parseFloat((size / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const submitTask = async () => {
  if (!formRef.value) return;
  
  await formRef.value.validate(async (valid) => {
    if (valid) {
      if (fileList.value.length === 0) {
        ElMessage.warning('请至少上传一个文件用于审查');
        return;
      }
      
      submitting.value = true;
      
      try {
        // 模拟 API 提交逻辑 (Mock API)
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        ElMessage.success('审查任务创建成功！');
        // 跳转到任务列表页 (TaskHistory)
        router.push('/tasks/history');
      } catch (error) {
        ElMessage.error('创建任务失败，请重试');
      } finally {
        submitting.value = false;
      }
    }
  });
};

const resetForm = () => {
  if (!formRef.value) return;
  formRef.value.resetFields();
  fileList.value = [];
};
</script>

<style scoped>
.new-task-container {
  padding: 20px;
  max-width: 900px;
  margin: 0 auto;
}

.card-header {
  font-size: 18px;
  font-weight: bold;
}

.task-form {
  margin-top: 20px;
}

.upload-area {
  width: 100%;
}

.custom-file-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  margin-top: 8px;
  background-color: #f5f7fa;
  border-radius: 4px;
  transition: all 0.3s;
}

.custom-file-item:hover {
  background-color: #e9e9eb;
}

.file-info {
  display: flex;
  align-items: center;
  overflow: hidden;
  flex: 1;
}

.file-icon {
  margin-right: 8px;
  color: #909399;
}

.file-name {
  color: #606266;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-right: 15px;
}

.file-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.file-size {
  color: #909399;
  font-size: 12px;
  margin-right: 12px;
}

.remove-btn {
  padding: 4px;
}

.form-actions {
  margin-top: 30px;
  display: flex;
  gap: 15px;
}
</style>
