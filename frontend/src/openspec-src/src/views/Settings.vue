<template>
  <div class="settings-page">
    <!-- 主体容器：左侧菜单 + 右侧内容 -->
    <div class="settings-container">
      <el-tabs v-model="currentMenu" class="settings-tabs">
        <el-tab-pane name="templates">
          <template #label>
            <span class="custom-tabs-label">
              <el-icon><Document /></el-icon>
              <span>文档模版</span>
            </span>
          </template>
          <div class="template-section">
          <div class="section-header">
            <h2>个人模板管理</h2>
            <p class="section-desc">管理您的文档模板和CAD模板</p>
          </div>

          <!-- 文档模板 -->
          <div class="template-group">
            <div class="group-header">
              <h3>文档模板</h3>
              <div class="header-buttons">
                <!-- 批量操作按钮 -->
                <el-button
                  v-if="selectedTemplates.length > 0"
                  size="small"
                  @click="batchDownloadTemplates"
                >
                  <el-icon><Download /></el-icon>
                  下载 ({{ selectedTemplates.length }})
                </el-button>
                <el-button
                  v-if="selectedTemplates.length > 0"
                  size="small"
                  type="danger"
                  @click="batchDeleteTemplates"
                >
                  <el-icon><Delete /></el-icon>
                  删除 ({{ selectedTemplates.length }})
                </el-button>
                <el-button type="default" size="small" @click="downloadDocumentExample">
                  <el-icon><Download /></el-icon>
                  示例模版
                </el-button>
                <el-button type="primary" size="small" @click="showUploadDialog('document')">
                  <el-icon><Upload /></el-icon>
                  上传模板
                </el-button>
              </div>
            </div>
            <div class="template-table">
              <el-table
                :data="documentTemplates"
                stripe
                @selection-change="handleSelectionChange"
              >
                <el-table-column type="selection" width="55" />
                <el-table-column prop="name" label="模板名称" min-width="200">
                  <template #default="{ row }">
                    <span
                      class="template-name-link"
                      @click="viewTemplateDetail(row.id)"
                      :class="{ 'can-view': row.status === 'completed' || row.status === 'success' }"
                    >
                      {{ row.name }}
                    </span>
                  </template>
                </el-table-column>
                <el-table-column prop="description" label="描述" min-width="200" />
                <el-table-column label="标签" min-width="150">
                  <template #default="{ row }">
                    <el-tag
                      v-for="tag in row.tags"
                      :key="tag.id"
                      size="small"
                      class="tag-item"
                    >
                      {{ tag.name }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="状态" width="120">
                  <template #default="{ row }">
                    <el-tag :type="getStatusType(row.status)">
                      {{ getStatusText(row.status) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="260" fixed="right">
                  <template #default="{ row }">
                    <div class="action-buttons">
                      <el-button
                        v-if="row.status === 'uploaded'"
                        type="primary"
                        size="small"
                        circle
                        @click="startParsing(row.id)"
                        title="开始解析"
                      >
                        <el-icon><VideoPlay /></el-icon>
                      </el-button>
                      <el-button
                        v-if="row.status === 'completed' || row.status === 'success'"
                        type="success"
                        size="small"
                        circle
                        @click="viewTemplateDetail(row.id)"
                        title="查看详情"
                      >
                        <el-icon><View /></el-icon>
                      </el-button>
                      <el-button
                        v-if="row.status === 'failed'"
                        type="primary"
                        size="small"
                        circle
                        @click="startParsing(row.id)"
                        title="重新解析"
                      >
                        <el-icon><Refresh /></el-icon>
                      </el-button>
                      <!-- <el-button
                        size="small"
                        circle
                        @click="testExtracting(row.id)"
                        title="test"
                      >
                        <el-icon><Download /></el-icon>
                      </el-button> -->
                      <el-button
                        size="small"
                        circle
                        @click="downloadTemplate(row)"
                        title="下载"
                      >
                        <el-icon><Download /></el-icon>
                      </el-button>
                      <el-button
                        size="small"
                        circle
                        @click="setTemplateTags(row)"
                        title="设置标签"
                      >
                        <el-icon><Edit /></el-icon>
                      </el-button>
                      <el-button
                        size="small"
                        type="danger"
                        circle
                        @click="deleteTemplate(row.id)"
                        title="删除"
                      >
                        <el-icon><Delete /></el-icon>
                      </el-button>
                    </div>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>

          <!-- CAD模板 -->
          <div class="template-group">
            <div class="group-header">
              <h3>CAD模板</h3>
              <div class="header-buttons">
                <el-button type="default" size="small" @click="downloadCadExample">
                  <el-icon><Download /></el-icon>
                  示例模版
                </el-button>
                <el-button 
                  type="primary" 
                  size="small" 
                  @click="showUploadDialog('cad')"
                >
                  <el-icon><Upload /></el-icon>
                  {{ cadTemplate ? '重新上传' : '上传模板' }}
                </el-button>
              </div>
            </div>
            <div v-if="cadTemplate" class="cad-template-card">
              <div class="cad-info">
                <el-icon class="cad-icon"><FolderOpened /></el-icon>
                <div class="cad-details">
                  <div class="cad-name">{{ cadTemplate.name }}</div>
                  <div class="cad-meta">
                    <span>{{ cadTemplate.fileName }}</span>
                    <span>{{ formatFileSize(cadTemplate.fileSize) }}</span>
                    <span>上传时间: {{ formatDate(cadTemplate.createdAt) }}</span>
                  </div>
                </div>
              </div>
              <div class="cad-actions">
                <el-button size="small" @click="downloadCadTemplate">
                  <el-icon><Download /></el-icon>
                  下载
                </el-button>
                <el-button size="small" type="danger" @click="deleteCadTemplate">
                  <el-icon><Delete /></el-icon>
                  删除
                </el-button>
              </div>
            </div>
            <el-empty v-else description="暂无CAD模板，请上传" />
          </div>
        </div>
        </el-tab-pane>

        <el-tab-pane name="tags">
          <template #label>
            <span class="custom-tabs-label">
              <el-icon><Collection /></el-icon>
              <span>模板标签</span>
            </span>
          </template>
          <div class="tags-section">
          <div class="section-header">
            <h2>模板标签管理</h2>
            <p class="section-desc">管理模板分类标签，支持按专业和业态分类</p>
          </div>

          <div class="tags-content">
            <!-- 专业标签 -->
            <div class="tag-group">
              <div class="tag-group-header">
                <h3>专业分类</h3>
                <el-button size="small" @click="showAddTagDialog('profession')">
                  <el-icon><Plus /></el-icon>
                  添加专业
                </el-button>
              </div>
              <div class="tag-list">
                <el-tag
                  v-for="tag in professionTags"
                  :key="tag.id"
                  :closable="!tag.isSystem"
                  @close="deleteTag(tag.id)"
                  size="large"
                  class="tag-item-large"
                >
                  {{ tag.name }}
                </el-tag>
              </div>
            </div>

            <!-- 业态标签 -->
            <div class="tag-group">
              <div class="tag-group-header">
                <h3>业态分类</h3>
                <el-button size="small" @click="showAddTagDialog('business_type')">
                  <el-icon><Plus /></el-icon>
                  添加业态
                </el-button>
              </div>
              <div class="tag-list">
                <el-tag
                  v-for="tag in businessTypeTags"
                  :key="tag.id"
                  :closable="!tag.isSystem"
                  @close="deleteTag(tag.id)"
                  size="large"
                  class="tag-item-large"
                >
                  {{ tag.name }}
                </el-tag>
              </div>
            </div>
          </div>
        </div>
        </el-tab-pane>
      </el-tabs>
    </div>

    <!-- 上传模板对话框 -->
    <el-dialog
      v-model="uploadDialogVisible"
      :title="uploadType === 'document' ? '上传文档模板' : '上传CAD模板'"
      width="500px"
    >
      <el-form :model="uploadForm" label-width="80px">
        <el-form-item label="模板名称">
          <el-input v-model="uploadForm.name" placeholder="请输入模板名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input 
            v-model="uploadForm.description" 
            type="textarea" 
            :rows="3"
            placeholder="请输入模板描述"
          />
        </el-form-item>
        <el-form-item label="选择文件">
          <el-upload
            ref="uploadRef"
            :auto-upload="false"
            :limit="1"
            :on-change="handleFileChange"
            :accept="uploadType === 'document' ? '.docx,.doc,.pdf' : '.dwg,.dxf'"
          >
            <el-button size="small">选择文件</el-button>
            <template #tip>
              <div class="upload-tip">
                {{ uploadType === 'document' ? '支持 .docx, .doc, .pdf 格式' : '支持 .dwg, .dxf 格式' }}
              </div>
            </template>
          </el-upload>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="uploadDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmUpload" :loading="uploading">上传</el-button>
      </template>
    </el-dialog>

    <!-- 设置标签对话框 -->
    <el-dialog v-model="tagDialogVisible" title="设置模板标签" width="600px">
      <div class="tag-selection-container">
        <!-- 专业分类 -->
        <div class="tag-category">
          <h4 class="category-title">专业分类（单选）</h4>
          <div class="tag-grid">
            <el-tag
              v-for="tag in professionTags"
              :key="tag.id"
              :type="selectedProfessionTagId === tag.id ? 'primary' : 'info'"
              :effect="selectedProfessionTagId === tag.id ? 'dark' : 'plain'"
              class="tag-selectable"
              @click="toggleTag(tag.id, 'profession')"
            >
              {{ tag.name }}
            </el-tag>
          </div>
        </div>

        <!-- 业态分类 -->
        <div class="tag-category">
          <h4 class="category-title">业态分类（单选）</h4>
          <div class="tag-grid">
            <el-tag
              v-for="tag in businessTypeTags"
              :key="tag.id"
              :type="selectedBusinessTypeTagId === tag.id ? 'primary' : 'info'"
              :effect="selectedBusinessTypeTagId === tag.id ? 'dark' : 'plain'"
              class="tag-selectable"
              @click="toggleTag(tag.id, 'business_type')"
            >
              {{ tag.name }}
            </el-tag>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="tagDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmSetTags">保存</el-button>
      </template>
    </el-dialog>

    <!-- 添加标签对话框 -->
    <el-dialog v-model="addTagDialogVisible" title="添加标签" width="400px">
      <el-form :model="newTagForm" label-width="80px">
        <el-form-item label="标签名称">
          <el-input v-model="newTagForm.name" placeholder="请输入标签名称" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="addTagDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmAddTag">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Document,
  Collection,
  Upload,
  Download,
  Delete,
  Plus,
  FolderOpened,
  VideoPlay,
  Refresh,
  View,
  Edit
} from '@element-plus/icons-vue'
import { authStorage, authFetch } from '../utils/auth'
import HeaderLogo from '../components/HeaderLogo.vue'
import { useLogout } from '../composables/useLogout'
import {
  getAllTags,
  getTagsByCategory,
  createTag as createTagApi,
  deleteTag as deleteTagApi,
  getDocumentTemplates,
  createDocumentTemplate,
  setDocumentTemplateTags,
  getCadTemplate,
  downloadDocumentTemplate as downloadDocumentTemplateApi,
  deleteDocumentTemplate as deleteDocumentTemplateApi,
  updateDocumentTemplateStatus,
  updateDocumentTemplateContent,
  type TemplateTag,
  type DocumentTemplate as DocumentTemplateType,
  type CadTemplate as CadTemplateType
} from '../service/template'

const emit = defineEmits<{
  navigate: [path: string]
}>()

const router = useRouter()
const { logout } = useLogout()
const userInfo = computed(() => authStorage.getUserInfo())

// 处理用户下拉菜单命令
const handleUserCommand = async (command: string) => {
  if (command === 'editor') {
    router.push('/')
  } else if (command === 'logout') {
    await logout()
  }
}

// 当前菜单
const currentMenu = ref<'templates' | 'tags'>('templates')

// 文档模板数据
interface DocumentTemplate {
  id: number
  name: string
  description: string
  status: 'uploaded' | 'parsing' | 'extracting' | 'saving' | 'completed' | 'success' | 'failed'
  tags: Tag[]
  fileSize: number
  createdAt: string
}

const documentTemplates = ref<DocumentTemplateType[]>([])

// 批量选择状态
const selectedTemplates = ref<DocumentTemplateType[]>([])

// 处理表格选择变化
const handleSelectionChange = (selection: DocumentTemplateType[]) => {
  selectedTemplates.value = selection
}

// CAD模板数据
interface CadTemplate {
  id: number
  name: string
  fileName: string
  fileSize: number
  createdAt: string
}

const cadTemplate = ref<CadTemplateType | null>(null)

// 个人模版知识库名称（从.env配置中读取，如果没配置则使用默认值）
const PERSONAL_TEMPLATE_KB_NAME = import.meta.env.PERSONAL_TEMPLATE_KB_NAME || 'personal-template'

// 标签数据
interface Tag {
  id: number
  name: string
  category: 'profession' | 'business_type' | 'custom'
  isSystem: boolean
}

const allTags = ref<TemplateTag[]>([])

const professionTags = computed(() => 
  allTags.value.filter(tag => tag.category === 'profession')
)

const businessTypeTags = computed(() => 
  allTags.value.filter(tag => tag.category === 'business_type')
)

// 上传对话框
const uploadDialogVisible = ref(false)
const uploadType = ref<'document' | 'cad'>('document')
const uploading = ref(false)
const uploadRef = ref()
const uploadForm = ref({
  name: '',
  description: '',
  file: null as File | null
})

const showUploadDialog = (type: 'document' | 'cad') => {
  uploadType.value = type
  uploadForm.value = { name: '', description: '', file: null }
  uploadDialogVisible.value = true
  // 清空上传组件的文件列表
  setTimeout(() => {
    uploadRef.value?.clearFiles()
  }, 0)
}

const handleFileChange = (file: any) => {
  uploadForm.value.file = file.raw
  if (!uploadForm.value.name) {
    uploadForm.value.name = file.name
  }
}

const confirmUpload = async () => {
  if (!uploadForm.value.name || !uploadForm.value.file) {
    ElMessage.warning('请填写完整信息')
    return
  }

  const userInfo = authStorage.getUserInfo()
  if (!userInfo || !userInfo.id) {
    ElMessage.error('用户未登录')
    return
  }

  uploading.value = true
  try {
    // 判断是文档模板还是CAD模板
    if (uploadType.value === 'document') {
      await uploadDocumentTemplate(userInfo)
    } else {
      await uploadCadTemplate(userInfo)
    }
  } catch (error) {
    console.error('上传失败:', error)
    ElMessage.error(error instanceof Error ? error.message : '上传失败')
  } finally {
    uploading.value = false
  }
}

// 上传文档模板
const uploadDocumentTemplate = async (userInfo: any) => {
  // Step 1: 上传文件到 agent 服务
  const formData = new FormData()
  formData.append('file', uploadForm.value.file!)
  formData.append('datasetName', PERSONAL_TEMPLATE_KB_NAME)

  console.log(`开始上传文档模板到 agent 服务 (知识库: ${PERSONAL_TEMPLATE_KB_NAME})...`)
  const uploadResponse = await authFetch('/agent/file/upload', {
    method: 'POST',
    body: formData
  })

  if (!uploadResponse.ok) {
    throw new Error(`文件上传失败: ${uploadResponse.status}`)
  }

  const uploadResult = await uploadResponse.json()
  console.log('agent 上传结果:', uploadResult)

  if (uploadResult.code !== 200 || !uploadResult.data?.id) {
    throw new Error(uploadResult.message || '文件上传失败')
  }

  // Step 2: 调用后端接口保存模板记录
  console.log('文件上传成功，开始保存模板记录...')
  const agentFileData = uploadResult.data

  const userIdLong = userInfo.id.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0)
  const fileName = agentFileData.name || uploadForm.value.file!.name
  const fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase()

  const createResponse = await createDocumentTemplate({
    name: uploadForm.value.name,
    description: uploadForm.value.description || '',
    fileName: fileName,
    fileSize: agentFileData.size || uploadForm.value.file!.size,
    fileType: fileExtension,
    filePath: agentFileData.id,
    userId: userIdLong,
    isStandard: false
  })

  if (createResponse.code !== 200) {
    throw new Error(createResponse.message || '保存模板记录失败')
  }

  console.log('模板记录保存成功:', createResponse.data)

  // Step 3: 设置文档的元数据（meta_fields）
  console.log('开始设置文档元数据...')
  const templateId = createResponse.data?.id

  try {
    const metaFieldsResponse = await authFetch('/agent/file/set_meta_fields', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileId: agentFileData.id,
        datasetName: PERSONAL_TEMPLATE_KB_NAME,
        userId: userInfo.id,
        isStandard: 'false',
        templateId: templateId ? String(templateId) : undefined,
        templateName: uploadForm.value.name,
        fileType: fileExtension
      })
    })

    if (metaFieldsResponse.ok) {
      const metaResult = await metaFieldsResponse.json()
      if (metaResult.code === 200) {
        console.log('文档元数据设置成功:', metaResult.data)
      } else {
        console.warn('文档元数据设置失败:', metaResult.message)
      }
    } else {
      console.warn('文档元数据设置请求失败:', metaFieldsResponse.status)
    }
  } catch (error) {
    // 元数据设置失败不影响整体流程，只记录警告
    console.warn('设置文档元数据时发生错误:', error)
  }

  ElMessage.success('上传成功')
  uploadDialogVisible.value = false
  await loadTemplates()
}

// 上传CAD模板
const uploadCadTemplate = async (userInfo: any) => {
  // Step 1: 上传文件到 agent 服务
  const formData = new FormData()
  formData.append('file', uploadForm.value.file!)
  formData.append('datasetName', PERSONAL_TEMPLATE_KB_NAME)
  
  console.log(`开始上传CAD模板到 agent 服务 (知识库: ${PERSONAL_TEMPLATE_KB_NAME})...`)
  const uploadResponse = await authFetch('/agent/file/upload', {
    method: 'POST',
    body: formData
  })
  
  if (!uploadResponse.ok) {
    throw new Error(`文件上传失败: ${uploadResponse.status}`)
  }
  
  const uploadResult = await uploadResponse.json()
  console.log('agent 上传结果:', uploadResult)
  
  if (uploadResult.code !== 200 || !uploadResult.data?.id) {
    throw new Error(uploadResult.message || '文件上传失败')
  }
  
  // Step 2: 调用后端接口保存CAD模板记录
  console.log('文件上传成功，开始保存CAD模板记录...')
  const agentFileData = uploadResult.data
  
  const userIdLong = userInfo.id.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0)
  const fileName = agentFileData.name || uploadForm.value.file!.name
  const fileExtension = fileName.substring(fileName.lastIndexOf('.') + 1).toLowerCase()
  
  // 注意：CAD模板每个用户只保留一份，新上传会覆盖旧的
  const createResponse = await authFetch('/api/v1/cad-templates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: uploadForm.value.name,
      description: uploadForm.value.description || '',
      fileName: fileName,
      fileSize: agentFileData.size || uploadForm.value.file!.size,
      fileType: fileExtension,
      filePath: agentFileData.id, // 将agent返回的文件ID作为文件路径
      userId: userIdLong
    })
  })
  
  if (!createResponse.ok) {
    throw new Error(`CAD模板保存失败: ${createResponse.status}`)
  }
  
  const result = await createResponse.json()
  if (result.code !== 200) {
    throw new Error(result.message || 'CAD模板保存失败')
  }
  
  console.log('CAD模板保存成功:', result.data)
  ElMessage.success('上传成功')
  uploadDialogVisible.value = false
  await loadCadTemplate()
}

// 标签对话框
const tagDialogVisible = ref(false)
const selectedProfessionTagId = ref<number | null>(null)
const selectedBusinessTypeTagId = ref<number | null>(null)
const currentTemplateId = ref<number | null>(null)

const setTemplateTags = (template: DocumentTemplate) => {
  currentTemplateId.value = template.id
  // 从已有标签中找出专业和业态各一个
  selectedProfessionTagId.value = null
  selectedBusinessTypeTagId.value = null
  if (template.tags) {
    for (const tag of template.tags) {
      if (tag.category === 'profession' && selectedProfessionTagId.value === null) {
        selectedProfessionTagId.value = tag.id
      } else if (tag.category === 'business_type' && selectedBusinessTypeTagId.value === null) {
        selectedBusinessTypeTagId.value = tag.id
      }
    }
  }
  tagDialogVisible.value = true
}

// 切换标签选中状态（单选：同类只允许一个）
const toggleTag = (tagId: number, category: 'profession' | 'business_type') => {
  if (category === 'profession') {
    selectedProfessionTagId.value = selectedProfessionTagId.value === tagId ? null : tagId
  } else {
    selectedBusinessTypeTagId.value = selectedBusinessTypeTagId.value === tagId ? null : tagId
  }
}

const confirmSetTags = async () => {
  if (!currentTemplateId.value) {
    ElMessage.error('模板ID不存在')
    return
  }

  try {
    // 构建选中的标签 ID 列表（兼容后端 junction table 接口）
    const tagIds: number[] = []
    if (selectedProfessionTagId.value) tagIds.push(selectedProfessionTagId.value)
    if (selectedBusinessTypeTagId.value) tagIds.push(selectedBusinessTypeTagId.value)

    const response = await setDocumentTemplateTags(currentTemplateId.value, tagIds)
    if (response.code === 200) {
      ElMessage.success('标签设置成功')

      // 同步更新 RAGFlow 文档的 meta_fields（分字段存储）
      const template = documentTemplates.value.find(t => t.id === currentTemplateId.value)
      if (template?.filePath) {
        const userInfo = authStorage.getUserInfo()
        try {
          const metaFieldsResponse = await authFetch('/agent/file/set_meta_fields', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              fileId: template.filePath,
              datasetName: PERSONAL_TEMPLATE_KB_NAME,
              userId: userInfo?.id || '',
              isStandard: template.isStandard ? 'true' : 'false',
              templateId: String(template.id),
              templateName: template.name,
              profession: selectedProfessionTagId.value ? String(selectedProfessionTagId.value) : '',
              business_type: selectedBusinessTypeTagId.value ? String(selectedBusinessTypeTagId.value) : '',
              fileType: template.fileType
            })
          })

          if (metaFieldsResponse.ok) {
            const metaResult = await metaFieldsResponse.json()
            if (metaResult.code === 200) {
              console.log('RAGFlow 元数据标签同步成功')
            } else {
              console.warn('RAGFlow 元数据标签同步失败:', metaResult.message)
            }
          }
        } catch (error) {
          console.warn('同步 RAGFlow 元数据标签时发生错误:', error)
        }
      }

      tagDialogVisible.value = false
      await loadTemplates()
    } else {
      ElMessage.error(response.message || '设置标签失败')
    }
  } catch (error) {
    console.error('设置标签失败:', error)
    ElMessage.error('设置标签失败')
  }
}

// 添加标签对话框
const addTagDialogVisible = ref(false)
const newTagForm = ref({
  name: '',
  category: 'profession' as 'profession' | 'business_type'
})

const showAddTagDialog = (category: 'profession' | 'business_type') => {
  newTagForm.value = { name: '', category }
  addTagDialogVisible.value = true
}

const confirmAddTag = async () => {
  if (!newTagForm.value.name) {
    ElMessage.warning('请输入标签名称')
    return
  }

  try {
    // 计算排序顺序（放在最后）
    const tagsInCategory = allTags.value.filter(tag => tag.category === newTagForm.value.category)
    const maxSortOrder = tagsInCategory.length > 0 
      ? Math.max(...tagsInCategory.map(t => t.sortOrder || 0))
      : 0
    
    const response = await createTagApi({
      name: newTagForm.value.name,
      category: newTagForm.value.category,
      sortOrder: maxSortOrder + 1
    })
    
    if (response.code === 200) {
      ElMessage.success('添加成功')
      addTagDialogVisible.value = false
      newTagForm.value = { name: '', category: 'profession' }
      await loadTags()
    } else {
      ElMessage.error(response.message || '添加失败')
    }
  } catch (error) {
    console.error('添加标签失败:', error)
    ElMessage.error('添加失败')
  }
}

// 工具函数
const getStatusType = (status: string) => {
  const map: Record<string, any> = {
    uploaded: 'info',
    parsing: 'warning',
    extracting: 'warning',
    saving: 'warning',
    completed: 'success',
    success: 'success',  // 兼容旧状态
    failed: 'danger'
  }
  return map[status] || 'info'
}

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    uploaded: '已上传',
    parsing: '文档解析中',
    extracting: '章节提取中',
    saving: '数据保存中',
    completed: '处理完成',
    success: '处理完成',  // 兼容旧状态
    failed: '处理失败'
  }
  return map[status] || status
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB'
}

const formatDate = (dateString: string) => {
  return new Date(dateString).toLocaleDateString('zh-CN')
}

// 数据加载
const loadTemplates = async () => {
  const userInfo = authStorage.getUserInfo()
  if (!userInfo || !userInfo.id) {
    console.warn('用户未登录，无法加载模板')
    return
  }
  
  try {
    console.log('开始加载模板列表，userId:', userInfo.id)
    const response = await getDocumentTemplates(userInfo.id)
    console.log('模板列表响应:', response)
    if (response.code === 200 && response.data) {
      documentTemplates.value = response.data
      console.log('加载到', response.data.length, '个模板')
    } else {
      console.error('加载模板失败:', response.message)
    }
  } catch (error) {
    console.error('加载模板失败:', error)
  }
}

const loadTags = async () => {
  try {
    console.log('开始加载标签...')
    const response = await getAllTags()
    console.log('标签响应:', response)
    if (response.code === 200 && response.data) {
      allTags.value = response.data
      console.log('标签数据:', allTags.value)
    } else {
      console.error('加载标签失败:', response.message)
    }
  } catch (error) {
    console.error('加载标签失败:', error)
  }
}

const loadCadTemplate = async () => {
  const userInfo = authStorage.getUserInfo()
  if (!userInfo || !userInfo.id) {
    return
  }
  
  try {
    const response = await getCadTemplate(userInfo.id)
    if (response.code === 200 && response.data) {
      cadTemplate.value = response.data
    }
  } catch (error) {
    // 404 是正常的，表示没有CAD模板
    console.log('未找到CAD模板')
  }
}

// 操作函数
const viewTemplateDetail = (id: number) => {
  // 查找模板，只有解析成功的模板才能查看详情
  const template = documentTemplates.value.find(t => t.id === id)
  if (template && (template.status === 'completed' || template.status === 'success')) {
    window.open(`/template/${id}`, '_blank')
  } else if (template && template.status !== 'completed' && template.status !== 'success') {
    ElMessage.warning('请先完成模板解析')
  }
}

const testExtracting = async (id: number) => {
  try {
    console.log('========== 开始测试章节提取 ==========')
    console.log('模板ID:', id)

    // 1. 找到对应的模板
    const template = documentTemplates.value.find(t => t.id === id)
    if (!template) {
      console.error('❌ 模板不存在')
      ElMessage.error('模板不存在')
      return
    }

    console.log('✓ 找到模板，模板信息:', {
      id: template.id,
      name: template.name,
      filePath: template.filePath,
      status: template.status
    })

    ElMessage.info('开始测试章节提取...')

    // 2. 调用 extract_chapters 接口
    console.log('📤 调用 /agent/file/extract_chapters 接口')
    console.log('请求参数:', {
      fileId: template.filePath,
      datasetName: PERSONAL_TEMPLATE_KB_NAME
    })

    const chaptersResponse = await authFetch('/agent/file/extract_chapters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileId: template.filePath,
        datasetName: PERSONAL_TEMPLATE_KB_NAME
      })
    })

    if (!chaptersResponse.ok) {
      console.error('❌ 提取章节目录失败，HTTP状态:', chaptersResponse.status)
      ElMessage.error(`提取失败: HTTP ${chaptersResponse.status}`)
      return
    }

    const chaptersResult = await chaptersResponse.json()
    console.log('📥 获得响应结果:', chaptersResult)

    if (chaptersResult.code !== 200) {
      console.error('❌ 接口返回错误:', chaptersResult.message)
      ElMessage.error(`接口错误: ${chaptersResult.message}`)
      return
    }

    if (!chaptersResult.data) {
      console.warn('⚠️ 返回数据为空')
      ElMessage.warning('返回数据为空')
      return
    }

    const { chunks, chapters: extractedChapters } = chaptersResult.data

    // 3. 详细输出 chunks 信息
    console.log('\n========== CHUNKS 信息 ==========')
    console.log(`✓ Chunks 数量: ${chunks?.length || 0}`)

    if (chunks && Array.isArray(chunks)) {
      chunks.forEach((chunk: any, index: number) => {
        console.log(`\n📄 Chunk ${index + 1}:`)
        console.log('  ID:', chunk.id)
        console.log('  Content长度:', chunk.content?.length || 0)
        console.log('  Content预览:', chunk.content?.substring(0, 100) + '...')
        console.log('  Important Keywords:', chunk.important_keywords || [])
        console.log('  其他字段:', Object.keys(chunk).filter(k => !['id', 'content', 'important_keywords'].includes(k)))
      })
    }

    // 4. 详细输出 chapters 信息
    console.log('\n========== CHAPTERS 信息 ==========')
    console.log(`✓ Chapters 数量: ${extractedChapters?.length || 0}`)

    if (extractedChapters && Array.isArray(extractedChapters)) {
      extractedChapters.forEach((chapter: any, index: number) => {
        console.log(`\n📑 Chapter ${index + 1}:`)
        console.log('  ID:', chapter.id)
        console.log('  Title:', chapter.title)
        console.log('  Level:', chapter.level)
        console.log('  全部信息:', chapter)
      })
    } else {
      console.warn('⚠️ 未提取到章节目录，将使用降级方案')
    }

    // 5. 构建章节列表
    console.log('\n========== 构建章节列表 ==========')
    let chapterList: any[] = []

    if (extractedChapters && Array.isArray(extractedChapters) && extractedChapters.length > 0) {
      console.log('✓ 使用大模型提取的章节目录')
      chapterList = extractedChapters.map((chapter: any, index: number) => ({
        id: chapter.id || `chapter-${index}`,
        title: chapter.title,
        level: chapter.level || 1
      }))
    } else {
      console.log('⚠️ 使用降级方案：chunk的important_keywords')
      if (chunks && Array.isArray(chunks)) {
        chunks.forEach((chunk: any, index: number) => {
          if (chunk.important_keywords && chunk.important_keywords.length > 0) {
            chapterList.push({
              id: `chunk-${index}`,
              title: chunk.important_keywords[0] || `Chunk ${index + 1}`,
              level: 1,
              chunkId: chunk.id
            })
          } else {
            chapterList.push({
              id: `chunk-${index}`,
              title: `章节 ${index + 1}`,
              level: 1,
              chunkId: chunk.id
            })
          }
        })
      }
    }

    console.log(`✓ 最终章节列表数量: ${chapterList.length}`)
    console.log('最终章节列表:', chapterList)

    // 6. 输出统计信息
    console.log('\n========== 统计信息 ==========')
    console.log('总Chunks数:', chunks?.length || 0)
    console.log('总Chapters数:', chapterList.length)
    console.log('Content总长度:', chunks?.reduce((sum: number, c: any) => sum + (c.content?.length || 0), 0) || 0)

    ElMessage.success(`测试完成！提取了 ${chapterList.length} 个章节，${chunks?.length || 0} 个chunks`)
    console.log('✓ 章节提取测试完成！')
    console.log('========== 结束 ==========\n')

  } catch (error) {
    console.error('❌ 测试过程中出错:', error)
    ElMessage.error(error instanceof Error ? error.message : '测试失败')
  }
}

const startParsing = async (id: number) => {
  try {
    // 找到对应的模板
    const template = documentTemplates.value.find(t => t.id === id)
    if (!template) {
      ElMessage.error('模板不存在')
      return
    }

    // 1. 更新状态为文档解析中
    template.status = 'parsing'
    await updateTemplateStatus(id, 'parsing')
    ElMessage.info('开始解析文档...')

    // 调用agent服务的parse接口
    const response = await authFetch('/agent/file/parse', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileId: template.filePath,
        datasetName: PERSONAL_TEMPLATE_KB_NAME
      })
    })

    if (!response.ok) {
      throw new Error(`解析失败: ${response.status}`)
    }

    const result = await response.json()
    console.log('解析结果:', result)

    // 检查解析是否成功：需要同时检查返回码和解析状态
    if (result.code !== 200 || result.data?.status === 'FAIL') {
      // 解析失败，更新后端状态
      await updateTemplateStatus(id, 'failed')
      template.status = 'failed'
      const errorMsg = result.data?.status === 'FAIL'
        ? `文档解析失败，chunk_count: ${result.data?.chunk_count || 0}`
        : result.message || '文档解析失败'
      throw new Error(errorMsg)
    }

    // 2. 文档解析成功，更新状态为章节提取中
    template.status = 'extracting'
    await updateTemplateStatus(id, 'extracting')
    ElMessage.info('文档解析完成，开始提取章节目录...')

    const chaptersResponse = await authFetch('/agent/file/extract_chapters', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileId: template.filePath,
        datasetName: PERSONAL_TEMPLATE_KB_NAME
      })
    })

    if (!chaptersResponse.ok) {
      console.warn('提取章节目录失败，但文档已解析成功')
    } else {
      const chaptersResult = await chaptersResponse.json()
      console.log('提取到的章节数据:', chaptersResult)

      if (chaptersResult.code === 200 && chaptersResult.data) {
        const { chunks, chapters: extractedChapters } = chaptersResult.data

        if (chunks && Array.isArray(chunks)) {
          // 3. 章节提取成功，更新状态为数据保存中
          template.status = 'saving'
          await updateTemplateStatus(id, 'saving')
          ElMessage.info('章节提取完成，正在保存数据...')

          // 构建content：将所有chunk的内容合并
          const contentParts: string[] = []

          chunks.forEach((chunk: any, index: number) => {
            // 保存完整的chunk内容
            contentParts.push(`## Chunk ${index + 1}\n${chunk.content}\n`)
          })

          const content = contentParts.join('\n---\n\n')

          // 使用大模型提取的章节目录，如果提取失败则降级使用chunk索引
          let chapterList: any[] = []

          if (extractedChapters && Array.isArray(extractedChapters) && extractedChapters.length > 0) {
            // 使用大模型提取的章节目录
            console.log('使用大模型提取的章节目录:', extractedChapters)
            chapterList = extractedChapters.map((chapter: any, index: number) => ({
              id: chapter.id || `chapter-${index}`,
              title: chapter.title,
              level: chapter.level || 1
            }))
          } else {
            // 降级：使用chunk的important_keywords
            console.log('未提取到章节目录，使用默认方式')
            chunks.forEach((chunk: any, index: number) => {
              if (chunk.important_keywords && chunk.important_keywords.length > 0) {
                chapterList.push({
                  id: `chunk-${index}`,
                  title: chunk.important_keywords[0] || `Chunk ${index + 1}`,
                  level: 1,
                  chunkId: chunk.id
                })
              } else {
                chapterList.push({
                  id: `chunk-${index}`,
                  title: `章节 ${index + 1}`,
                  level: 1,
                  chunkId: chunk.id
                })
              }
            })
          }

          const chapters = JSON.stringify(chapterList)

          console.log('开始保存文档内容到数据库...')
          console.log('chunks数量:', chunks.length)
          console.log('章节数量:', chapterList.length)
          console.log('content长度:', content.length)
          await updateDocumentTemplateContent(id, content, chapters)
          console.log('文档内容已保存')
        }
      }
    }

    // 4. 更新状态为处理完成
    await updateTemplateStatus(id, 'completed')
    template.status = 'completed'

    ElMessage.success('文档处理完成！')
  } catch (error) {
    console.error('处理失败:', error)
    ElMessage.error(error instanceof Error ? error.message : '处理失败')
    // 发生错误时重新加载以确保状态同步
    await loadTemplates()
  }
}

// 从提取的内容中生成章节结构
const extractChapters = (extracted: any) => {
  if (!extracted || typeof extracted !== 'object') {
    return []
  }
  
  return Object.keys(extracted).map((key, index) => {
    let level = 1
    if (key.includes('.')) {
      level = key.split('.').length
    }
    
    return {
      id: `section-${index}`,
      title: key,
      level: Math.min(level, 3)
    }
  })
}

// 更新模板状态
const updateTemplateStatus = async (templateId: number, status: string) => {
  try {
    console.log(`开始更新模板状态: templateId=${templateId}, status=${status}`)
    const response = await updateDocumentTemplateStatus(templateId, status)
    
    console.log('状态更新结果:', response)
    
    if (response.code !== 200) {
      throw new Error(response.message || '更新状态失败')
    }
    
    console.log('状态更新成功')
  } catch (error) {
    console.error('更新状态异常:', error)
    throw error
  }
}

const deleteTemplate = async (id: number) => {
  try {
    await ElMessageBox.confirm('确定要删除此模板吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })

    // 1. 找到模板，获取 filePath（RAGFlow 文档 ID）
    const template = documentTemplates.value.find(t => t.id === id)
    if (template?.filePath) {
      // 2. 先删除 RAGFlow 知识库中的文档
      try {
        const ragflowResponse = await authFetch('/agent/file/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileId: template.filePath,
            datasetName: PERSONAL_TEMPLATE_KB_NAME
          })
        })
        const ragflowResult = await ragflowResponse.json()
        if (ragflowResult.code !== 200) {
          console.warn('RAGFlow 文档删除失败:', ragflowResult.message)
          // RAGFlow 删除失败不阻塞，继续删除数据库记录
        }
      } catch (error) {
        console.warn('RAGFlow 文档删除异常:', error)
        // RAGFlow 删除失败不阻塞，继续删除数据库记录
      }
    }

    // 3. 删除数据库记录
    const response = await deleteDocumentTemplateApi(id)
    if (response.code === 200) {
      ElMessage.success('删除成功')
      await loadTemplates()
    } else {
      ElMessage.error(response.message || '删除失败')
    }
  } catch (error) {
    // 用户取消确认框时不显示错误
    if (error !== 'cancel') {
      console.error('删除模板失败:', error)
      ElMessage.error(error instanceof Error ? error.message : '删除失败')
    }
  }
}

// 批量下载模板
const batchDownloadTemplates = async () => {
  if (selectedTemplates.value.length === 0) {
    ElMessage.warning('请先选择要下载的模板')
    return
  }

  try {
    ElMessage.info(`开始批量下载 ${selectedTemplates.value.length} 个模板...`)

    let successCount = 0
    let failCount = 0

    for (const template of selectedTemplates.value) {
      try {
        await downloadTemplate(template)
        successCount++
        // 添加延迟避免浏览器阻止多次下载
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (error) {
        console.error(`下载模板 ${template.name} 失败:`, error)
        failCount++
      }
    }

    if (failCount === 0) {
      ElMessage.success(`批量下载完成，成功 ${successCount} 个`)
    } else {
      ElMessage.warning(`批量下载完成，成功 ${successCount} 个，失败 ${failCount} 个`)
    }

    // 清空选择
    selectedTemplates.value = []
  } catch (error) {
    console.error('批量下载失败:', error)
    ElMessage.error('批量下载失败')
  }
}

// 批量删除模板
const batchDeleteTemplates = async () => {
  if (selectedTemplates.value.length === 0) {
    ElMessage.warning('请先选择要删除的模板')
    return
  }

  try {
    await ElMessageBox.confirm(
      `确定要删除选中的 ${selectedTemplates.value.length} 个模板吗？此操作不可恢复！`,
      '批量删除确认',
      {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )

    ElMessage.info(`开始批量删除 ${selectedTemplates.value.length} 个模板...`)

    // 1. 批量删除 RAGFlow 文档
    const fileIds = selectedTemplates.value
      .filter(t => t.filePath)
      .map(t => t.filePath)

    if (fileIds.length > 0) {
      try {
        const ragflowResponse = await authFetch('/agent/file/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileIds: fileIds,
            datasetName: PERSONAL_TEMPLATE_KB_NAME
          })
        })
        const ragflowResult = await ragflowResponse.json()
        if (ragflowResult.code !== 200) {
          console.warn('RAGFlow 批量文档删除失败:', ragflowResult.message)
        } else {
          console.log(`RAGFlow 成功删除 ${fileIds.length} 个文档`)
        }
      } catch (error) {
        console.warn('RAGFlow 批量文档删除异常:', error)
      }
    }

    // 2. 批量删除数据库记录
    let successCount = 0
    let failCount = 0

    for (const template of selectedTemplates.value) {
      try {
        const response = await deleteDocumentTemplateApi(template.id)
        if (response.code === 200) {
          successCount++
        } else {
          console.error(`删除模板 ${template.name} 失败:`, response.message)
          failCount++
        }
      } catch (error) {
        console.error(`删除模板 ${template.name} 失败:`, error)
        failCount++
      }
    }

    // 刷新列表
    await loadTemplates()

    // 清空选择
    selectedTemplates.value = []

    if (failCount === 0) {
      ElMessage.success(`批量删除完成，成功删除 ${successCount} 个模板`)
    } else {
      ElMessage.warning(`批量删除完成，成功 ${successCount} 个，失败 ${failCount} 个`)
    }
  } catch (error) {
    // 用户取消确认框时不显示错误
    if (error !== 'cancel') {
      console.error('批量删除失败:', error)
      ElMessage.error('批量删除失败')
    }
  }
}

const deleteTag = async (id: number) => {
  try {
    const response = await deleteTagApi(id)
    if (response.code === 200) {
      ElMessage.success('删除成功')
      await loadTags()
    } else {
      ElMessage.error(response.message || '删除失败')
    }
  } catch (error) {
    ElMessage.error('删除失败')
  }
}

const downloadCadTemplate = async () => {
  if (!cadTemplate.value) {
    ElMessage.error('没有可下载的CAD模板')
    return
  }
  
  try {
    const userInfo = authStorage.getUserInfo()
    if (!userInfo || !userInfo.id) {
      ElMessage.error('用户未登录')
      return
    }
    
    // 获取文件ID（filePath存储的是agent的文件ID）
    const fileId = cadTemplate.value.filePath
    console.log('开始下载CAD模板, fileId:', fileId)
    
    // 从agent服务下载文件
    const response = await authFetch(`/agent/file/download/${fileId}`, {
      method: 'GET'
    })
    
    if (!response.ok) {
      throw new Error('下载失败')
    }
    
    // 获取文件数据
    const blob = await response.blob()
    
    // 创建下载链接
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = cadTemplate.value.fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    
    ElMessage.success('下载成功')
  } catch (error) {
    console.error('下载失败:', error)
    ElMessage.error(error instanceof Error ? error.message : '下载失败')
  }
}

// 下载文档模板
const downloadTemplate = async (template: DocumentTemplateType) => {
  try {
    console.log('开始下载文档模板, templateId:', template.id)
    
    // 调用API获取文件ID
    const response = await downloadDocumentTemplateApi(template.id)
    if (response.code !== 200 || !response.data) {
      throw new Error(response.message || '获取下载链接失败')
    }
    
    const fileId = response.data
    console.log('agent fileId:', fileId)
    
    // 从agent服务下载文件
    const downloadResponse = await authFetch(`/agent/file/download/${fileId}`, {
      method: 'GET'
    })
    
    if (!downloadResponse.ok) {
      throw new Error('下载失败')
    }
    
    // 获取文件数据
    const blob = await downloadResponse.blob()
    
    // 创建下载链接
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = template.fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
    
    ElMessage.success('下载成功')
  } catch (error) {
    console.error('下载文档模板失败:', error)
    ElMessage.error(error instanceof Error ? error.message : '下载失败')
  }
}

const deleteCadTemplate = async () => {
  if (!cadTemplate.value) {
    return
  }
  
  try {
    await ElMessageBox.confirm('确定要删除CAD模板吗？', '提示', {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning'
    })
    
    const userInfo = authStorage.getUserInfo()
    if (!userInfo || !userInfo.id) {
      ElMessage.error('用户未登录')
      return
    }

    // 1. 先删除 RAGFlow 知识库中的文档
    const fileId = cadTemplate.value.filePath
    if (fileId) {
      try {
        const ragflowResponse = await authFetch('/agent/file/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileId: fileId,
            datasetName: 'personal-template'
          })
        })
        const ragflowResult = await ragflowResponse.json()
        if (ragflowResult.code !== 200) {
          console.warn('RAGFlow文档删除失败:', ragflowResult.message)
        }
      } catch (ragflowError) {
        console.warn('RAGFlow文档删除出错:', ragflowError)
      }
    }

    // 2. 删除数据库记录
    const response = await authFetch(`/api/v1/cad-templates/${userInfo.id}`, {
      method: 'DELETE'
    })

    if (!response.ok) {
      throw new Error('删除失败')
    }

    const result = await response.json()
    if (result.code === 200) {
      ElMessage.success('删除成功')
      cadTemplate.value = null
    } else {
      ElMessage.error(result.message || '删除失败')
    }
  } catch (error) {
    if (error !== 'cancel') {
      console.error('删除CAD模板失败:', error)
      ElMessage.error(error instanceof Error ? error.message : '删除失败')
    }
  }
}

// 下载文档示例模版
const downloadDocumentExample = () => {
  try {
    const link = document.createElement('a')
    link.href = '/api/v1/templates/example/document'
    link.download = '文档示例模版.docx'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    ElMessage.success('开始下载文档示例模版')
  } catch (error) {
    console.error('下载失败:', error)
    ElMessage.error('下载失败')
  }
}

// 下载CAD示例模版
const downloadCadExample = () => {
  try {
    const link = document.createElement('a')
    link.href = '/api/v1/templates/example/cad'
    link.download = 'CAD示例模版.dxf'
    link.style.display = 'none'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    ElMessage.success('开始下载CAD示例模版')
  } catch (error) {
    console.error('下载失败:', error)
    ElMessage.error('下载失败')
  }
}

onMounted(() => {
  loadTemplates()
  loadTags()
  loadCadTemplate()
})
</script>

<style scoped>
/* 组件容器 */
.settings-page {
  height: 100%;
  overflow-y: auto;
}

.settings-container {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.settings-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.custom-tabs-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 15px;
}

.settings-tabs :deep(.el-tabs__header) {
  margin: 0 0 16px;
  padding: 8px 24px 0;
  background-color: #fff;
  border-bottom: 1px solid var(--gray-200);
}

.settings-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none; /* Hide default bottom line since we added border to header */
}

.settings-tabs :deep(.el-tabs__item) {
  font-size: 15px;
  color: var(--gray-600);
  padding: 0 20px !important;
  height: 48px;
  line-height: 48px;
  transition: all 0.3s;
}

.settings-tabs :deep(.el-tabs__item:hover) {
  color: var(--primary-color);
}

.settings-tabs :deep(.el-tabs__item.is-active) {
  color: var(--primary-color);
  font-weight: 600;
}

.settings-tabs :deep(.el-tabs__active-bar) {
  height: 3px;
  border-radius: 3px 3px 0 0;
  background-color: var(--primary-color);
}

.settings-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow-y: auto;
  padding: 0 24px 24px;
}

.section-header {
  margin-bottom: 24px;
}

.section-header h2 {
  font-size: 24px;
  font-weight: 600;
  color: var(--gray-900);
  margin: 0 0 8px 0;
}

.section-desc {
  font-size: 14px;
  color: var(--gray-600);
  margin: 0;
}

/* 模板分组 */
.template-group {
  background: white;
  border-radius: var(--radius-lg);
  padding: 20px;
  margin-bottom: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.group-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--gray-900);
  margin: 0;
}

.header-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
}

/* CAD模板卡片 */
.cad-template-card {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: var(--gray-50);
  border-radius: var(--radius-md);
  border: 1px solid var(--gray-200);
}

.cad-info {
  display: flex;
  gap: 16px;
  align-items: center;
}

.cad-icon {
  font-size: 48px;
  color: var(--primary-color);
}

.cad-details {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cad-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--gray-900);
}

.cad-meta {
  display: flex;
  gap: 16px;
  font-size: 13px;
  color: var(--gray-600);
}

.cad-actions {
  display: flex;
  gap: 8px;
}

/* 标签管理 */
.tags-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.tag-group {
  background: white;
  border-radius: var(--radius-lg);
  padding: 20px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.tag-group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.tag-group-header h3 {
  font-size: 16px;
  font-weight: 600;
  color: var(--gray-900);
  margin: 0;
}

.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.tag-item {
  margin-right: 8px;
}

.tag-item-large {
  padding: 8px 16px;
  font-size: 14px;
}

.upload-tip {
  font-size: 12px;
  color: var(--gray-500);
  margin-top: 8px;
}

/* 模板名称链接样式 */
.template-name-link {
  cursor: default;
  color: var(--gray-700);
  transition: all 0.2s ease;
}

.template-name-link.can-view {
  cursor: pointer;
  color: var(--primary-color);
  font-weight: 500;
}

.template-name-link.can-view:hover {
  color: var(--primary-dark);
  text-decoration: underline;
}

/* 标签选择对话框样式 */
.tag-selection-container {
  padding: 0;
}

.tag-category {
  margin-bottom: 24px;
}

.tag-category:last-child {
  margin-bottom: 0;
}

.category-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--gray-800);
  margin: 0 0 12px 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--gray-200);
}

.tag-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag-selectable {
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
  font-size: 13px;
  padding: 6px 14px;
}

.tag-selectable:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.tag-selectable:active {
  transform: translateY(0);
}

/* 操作按钮样式 */
.action-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
  opacity: 0;
  transition: opacity 0.2s ease;
}

/* 表格行悬浮时显示操作按钮 */
.el-table__row:hover .action-buttons {
  opacity: 1;
}

/* 圆形图标按钮样式调整 */
.action-buttons .el-button.is-circle {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--gray-300);
}

.action-buttons .el-button.is-circle:hover {
  transform: scale(1.1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.action-buttons .el-button.is-circle .el-icon {
  font-size: 14px;
}
</style>
