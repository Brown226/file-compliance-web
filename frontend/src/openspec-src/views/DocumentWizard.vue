<script setup lang="ts">
import { ref, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElNotification, ElMessageBox } from 'element-plus'
import { 
    Close,
    ArrowLeft, 
    ArrowRight, 
    Document, 
    Edit, 
    List, 
    Star,
    Plus,
    Check,
    Sort,
    Delete
} from '@element-plus/icons-vue'
import HeaderLogo from '../components/HeaderLogo.vue'

const router = useRouter()

// 当前步骤
const currentStep = ref(1)
const totalSteps = 4

// 步骤数据
const wizardData = ref({
  title: '',
  summary: '',
  outline: [
    { id: '1', title: '工程概况', selected: true, showActions: false },
    { id: '2', title: '设计依据', selected: true, showActions: false },
    { id: '3', title: '设计原则', selected: true, showActions: false },
    { id: '4', title: '施工工艺', selected: true, showActions: false },
    { id: '5', title: '主要材料及设备的规格、型号及性能指标', selected: true, showActions: false }
  ],
  isGenerating: false
})

// 大纲模式
const outlineMode = ref('outline')

const selectedLength = ref('medium')


// 自动配置
const autoConfig = ref(true)

// 计算属性
const canPrevious = computed(() => currentStep.value > 1)
const canNext = computed(() => {
  switch (currentStep.value) {
    case 1:
      return wizardData.value.title.trim().length > 0
    case 2:
      return wizardData.value.summary.trim().length > 0
    case 3:
      return outlineMode.value === 'no-outline' || wizardData.value.outline.some(item => item.selected)
    case 4:
      return true
    default:
      return false
  }
})

const stepTitle = computed(() => {
  const titles = ['标题', '项目概要', '大纲', '内容']
  return titles[currentStep.value - 1]
})

// 方法
const goBack = () => {
  ElMessageBox.confirm(
    '退出后，当前文档的编写进度将终止',
    '退出文档生成',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
      center: true
    }
  ).then(() => {
    router.push('/')
  }).catch(() => {
    // 用户取消，不做任何操作
  })
}

const previousStep = () => {
  if (canPrevious.value) {
    currentStep.value--
  }
}

const nextStep = () => {
  if (canNext.value) {
    if (currentStep.value < totalSteps) {
      currentStep.value++
    } else {
      generateDocument()
    }
  }
}

const skipStep = () => {
  if (currentStep.value === 2) {
    // 跳过概要步骤
    wizardData.value.summary = ''
    currentStep.value++
  }
}

const regenerateStep = () => {
  switch (currentStep.value) {
    case 2:
      generateSummary()
      break
    case 3:
      // 重新生成大纲逻辑
      ElMessage.info('正在重新生成大纲...')
      break
  }
}

const addOutlineItem = () => {
  const newId = (wizardData.value.outline.length + 1).toString()
  wizardData.value.outline.push({
    id: newId,
    title: '',
    selected: true,
    showActions: false
  })
}

const addOutlineItemAfter = (index: number) => {
  const newId = (wizardData.value.outline.length + 1).toString()
  wizardData.value.outline.splice(index + 1, 0, {
    id: newId,
    title: '',
    selected: true,
    showActions: false
  })
  // 重新编号
  wizardData.value.outline.forEach((item, idx) => {
    item.id = (idx + 1).toString()
  })
}

const removeOutlineItem = (index: number) => {
  if (wizardData.value.outline.length > 1) {
    wizardData.value.outline.splice(index, 1)
    // 重新编号
    wizardData.value.outline.forEach((item, idx) => {
      item.id = (idx + 1).toString()
    })
  }
}

// 拖拽排序相关
const draggedIndex = ref(-1)
const dragOverIndex = ref(-1)

const handleDragStart = (event: DragEvent, index: number) => {
  draggedIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
  }
}

const handleDragOver = (event: DragEvent, index: number) => {
  event.preventDefault()
  dragOverIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

const handleDragLeave = () => {
  dragOverIndex.value = -1
}

const handleDrop = (event: DragEvent, index: number) => {
  event.preventDefault()
  if (draggedIndex.value !== -1 && draggedIndex.value !== index) {
    moveOutlineItem(draggedIndex.value, index)
  }
  draggedIndex.value = -1
  dragOverIndex.value = -1
}

const handleDragEnd = () => {
  draggedIndex.value = -1
  dragOverIndex.value = -1
}

const moveOutlineItem = (fromIndex: number, toIndex: number) => {
  const item = wizardData.value.outline.splice(fromIndex, 1)[0]
  wizardData.value.outline.splice(toIndex, 0, item!)
  // 重新编号
  wizardData.value.outline.forEach((item, idx) => {
    item.id = (idx + 1).toString()
  })
}


const generateSummary = () => {
  if (!wizardData.value.title.trim()) {
    ElMessage.warning('请先输入文档标题')
    return
  }
  
  // 模拟AI生成项目概要
  const summaries = [
    `本工程由我单位组织施工，我单位对工程质量全面负责。本工程为新建工程，施工图纸未定，图纸会审后可能照设计文件调整。本工程所有施工均应严格按照国家及地方有关法律、法规和技术规范的规定。本工程应遵循"质量第一、安全第一、文明施工、科技先进"的方针，严格执行国家建筑设计施工图集《危险建筑工程施工质量验收统一标准》和《建筑工程施工质量收统一标准》的有关规定。`,
    `${wizardData.value.title}项目严格按照国家相关规范和标准进行设计和施工，确保工程质量和安全。`,
    `本项目采用先进的施工工艺和技术，注重环保和节能，力求打造高品质工程。`
  ]
  
  wizardData.value.summary = summaries[0] || ''
  ElMessage.success('项目概要生成成功')
}

// 数字转中文大写
const numberToChinese = (num: number) => {
  const chineseNumbers = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  if (num <= 10) {
    return chineseNumbers[num]
  }
  // 处理11-99的情况
  if (num < 20) {
    return '十' + chineseNumbers[num - 10]
  }
  const tens = Math.floor(num / 10)
  const ones = num % 10
  return chineseNumbers[tens] + '十' + (ones > 0 ? chineseNumbers[ones] : '')
}

const generateDocument = async () => {
  wizardData.value.isGenerating = true
  
  try {
    // 模拟文档生成过程
    await new Promise(resolve => setTimeout(resolve, 3000))
    
    // 保存文档数据到localStorage或发送到后端
    const documentData = {
      id: Date.now().toString(),
      title: wizardData.value.title,
      summary: wizardData.value.summary,
      outline: wizardData.value.outline.filter(item => item.selected),
      length: selectedLength.value,
      createdAt: new Date().toISOString()
    }
    
    // 使用 sessionStorage 实现标签页隔离，支持多文档同时创建
    sessionStorage.setItem('currentProject', JSON.stringify(documentData))
    
    ElNotification({
      title: '成功',
      message: '文档生成完成！',
      type: 'success'
    })
    
    // 跳转到编辑器
    router.push(`/editor/${documentData.id}`)
    
  } catch (error) {
    ElMessage.error('文档生成失败，请重试')
  } finally {
    wizardData.value.isGenerating = false
  }
}
</script>

<template>
  <div class="wizard-page">
    <!-- 顶部导航 -->
    <header class="wizard-header">
      <div class="header-content">
        <HeaderLogo />
        <div class="wizard-progress">
          <div class="progress-steps">
            <div 
              v-for="step in totalSteps" 
              :key="step"
              class="progress-step"
              :class="{ 
                active: step === currentStep, 
                completed: step < currentStep 
              }"
            >
              <div class="step-number">
                <el-icon v-if="step < currentStep"><Check /></el-icon>
                <span v-else>{{ step }}</span>
              </div>
              <div class="step-label">
                {{ ['标题', '项目概要', '大纲', '内容'][step - 1] }}
              </div>
            </div>
          </div>
        </div>
        <!-- <el-button @click="goBack" class="back-btn">
          <el-icon><Back /></el-icon>
        </el-button> -->
         <el-button @click="goBack" class="back-btn">
          <el-icon><Close /></el-icon>
          <!-- 返回首页 -->
        </el-button>
      </div>
    </header>

    <!-- 主要内容区 -->
    <main class="wizard-main">
      <div class="wizard-container">
        <!-- 步骤标题 -->
        <div class="step-header">
          <h1 class="step-title">
            <el-icon class="step-icon">
              <Document v-if="currentStep === 1" />
              <Edit v-else-if="currentStep === 2" />
              <List v-else-if="currentStep === 3" />
              <Star v-else />
            </el-icon>
            {{ stepTitle }}
          </h1>
          <p class="step-description">
            <template v-if="currentStep === 1">
              按步骤快速创建文档
            </template>
            <template v-else-if="currentStep === 2">
              您可以选择/编辑项目概要：
            </template>
            <template v-else-if="currentStep === 3">
              您可以选择编辑/增删/重组大纲：
            </template>
            <template v-else>
              即将生成文档-文档预览
            </template>
          </p>
        </div>

        <!-- 步骤内容 -->
        <div class="step-content">
          <!-- 步骤1：标题 -->
          <div v-if="currentStep === 1" class="step-panel">
            <div class="title-section">
              <label class="form-label">标题</label>
              <el-input
                v-model="wizardData.title"
                placeholder="请输入文档标题"
                size="large"
                class="title-input"
                maxlength="100"
                show-word-limit
              />
            </div>
            
            <!-- <div class="length-section">
              <label class="form-label">文章长度</label>
              <div class="length-options">
                <div 
                  v-for="option in lengthOptions"
                  :key="option.value"
                  class="length-option"
                  :class="{ active: selectedLength === option.value }"
                  @click="selectedLength = option.value"
                >
                  <div class="option-label">{{ option.label }}</div>
                  <div class="option-description">{{ option.description }}</div>
                </div>
              </div>
            </div> -->

            <div class="auto-config">
              <div class="config-item">
                <span class="config-label">自动生成项目概要</span>
                <!-- <el-icon class="config-info"><Document /></el-icon> -->
                <el-switch v-model="autoConfig" />
              </div>
              <!-- <div class="config-item">
                <span class="config-label">项目概要条数</span>
                <div class="counter">
                  <el-button 
                    size="small" 
                    :icon="Minus" 
                    @click="summaryCount = Math.max(1, summaryCount - 1)"
                  />
                  <span class="count">{{ summaryCount }}</span>
                  <el-button 
                    size="small" 
                    :icon="Plus" 
                    @click="summaryCount++"
                  />
                </div>
              </div> -->
            </div>
          </div>

          <!-- 步骤2：项目概要 -->
          <div v-else-if="currentStep === 2" class="step-panel">
            <div class="summary-content">
              <el-input
                v-model="wizardData.summary"
                type="textarea"
                :rows="8"
                placeholder="请输入或生成项目概要..."
                class="summary-textarea"
              />
            </div>
          </div>

          <!-- 步骤3：大纲 -->
          <div v-else-if="currentStep === 3" class="step-panel">
            <div class="outline-section">
              <!-- <div class="outline-tabs">
                <el-tabs v-model="outlineMode" class="outline-tabs-container">
                  <el-tab-pane label="设置大纲" name="outline" />
                  <el-tab-pane label="不要大纲" name="no-outline" />
                </el-tabs>
              </div> -->
              
              <div v-if="outlineMode === 'outline'" class="outline-content">

                <div class="outline-list-container">
                  <div class="outline-list">
                    <el-card 
                      v-for="(item, index) in wizardData.outline"
                      :key="item.id"
                      class="outline-card"
                      :class="{ selected: item.selected, 'drag-over': dragOverIndex === index }"
                      shadow="hover"
                      draggable="true"
                      @mouseenter="item.showActions = true"
                      @mouseleave="item.showActions = false"
                      @dragstart="handleDragStart($event, index)"
                      @dragover="handleDragOver($event, index)"
                      @dragleave="handleDragLeave"
                      @drop="handleDrop($event, index)"
                      @dragend="handleDragEnd"
                    >
                      <div class="outline-item-content">
                        <div class="outline-left">
                          <div class="outline-number">{{ numberToChinese(parseInt(item.id)) }}</div>
                          <el-input
                            v-model="item.title"
                            placeholder="请输入章节标题"
                            class="outline-title-input"
                            size="default"
                          />
                        </div>
                        
                        <div class="outline-actions" v-show="item.showActions">
                          <el-tooltip content="新增" placement="top">
                            <el-button 
                              size="small" 
                              type="primary" 
                              :icon="Plus"
                              circle
                              @click="addOutlineItemAfter(index)"
                            />
                          </el-tooltip>
                          
                          <el-tooltip content="拖动排序" placement="top">
                            <el-button 
                              size="small" 
                              type="info" 
                              :icon="Sort"
                              circle
                              class="drag-handle"
                              @mousedown.stop
                            />
                          </el-tooltip>
                          
                          <el-tooltip content="删除章节" placement="top">
                            <el-button 
                              v-if="wizardData.outline.length > 1"
                              size="small" 
                              type="danger" 
                              :icon="Delete"
                              circle
                              @click="removeOutlineItem(index)"
                            />
                          </el-tooltip>
                        </div>
                      </div>
                    </el-card>
                  </div>
                </div>

                <el-button 
                  type="primary" 
                  :icon="Plus" 
                  @click="addOutlineItem"
                  class="add-outline-btn"
                  size="large"
                >
                  添加章节
                </el-button>
              </div>
              
              <div v-else class="no-outline-content">
                <el-empty description="已选择不使用大纲模式" />
              </div>
            </div>
          </div>

          <!-- 步骤4：内容生成 -->
          <div v-else-if="currentStep === 4" class="step-panel">
            <div class="content-preview">
              <!-- <div class="preview-header">
                <h3>文档预览</h3>
              </div> -->
              
              <div class="preview-content">
                <div class="preview-title">
                  标题：{{ wizardData.title }}
                </div>
                
                <div v-if="wizardData.summary" class="preview-summary">
                  <strong>项目概要：</strong>
                  <p>{{ wizardData.summary }}</p>
                </div>

                <div class="preview-outline">
                  <strong>大纲：</strong>
                  <ul>
                    <li 
                      v-for="item in wizardData.outline.filter(i => i.selected)"
                      :key="item.id"
                    >
                      {{ item.id }}. {{ item.title }}
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部操作按钮 -->
        <div class="wizard-footer">
          <div class="footer-left">
            <el-button v-if="currentStep === 2" @click="skipStep" class="skip-btn">
              跳过
            </el-button>
          </div>
          
          <div class="footer-right">
            <el-button 
              v-if="canPrevious" 
              @click="previousStep"
              :icon="ArrowLeft"
            >
              上一步
            </el-button>
            
            <el-button 
              type="primary" 
              @click="nextStep"
              :disabled="!canNext"
              :loading="wizardData.isGenerating"
              :icon="currentStep === totalSteps ? Star : ArrowRight"
            >
              {{ currentStep === totalSteps ? '生成文档' : '下一步' }}
            </el-button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.wizard-page {
  min-height: 100vh;
  /* background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); */
}

.wizard-header {
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.1);
  padding: 0 2rem;
}

.header-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  max-width: 1200px;
  margin: 0 auto;
  height: 64px;
}

.wizard-progress {
  flex: 1;
  display: flex;
  justify-content: center;
  margin: 0 2rem;
}

.progress-steps {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.progress-step {
  display: flex;
  /* flex-direction: column; */
  align-items: center;
  gap: 0.5rem;
}

.step-number {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #e5e7eb;
  color: #6b7280;
  font-weight: 600;
  transition: all 0.3s ease;
}

.progress-step.active .step-number {
  background: #3b82f6;
  color: white;
}

.progress-step.completed .step-number {
  background: #10b981;
  color: white;
}

.step-label {
  font-size: 0.875rem;
  color: #6b7280;
  font-weight: 500;
}

.progress-step.active .step-label {
  color: #3b82f6;
}

.back-btn {
  border: none;
  background: transparent;
  color: #6b7280;
}

.back-btn:hover {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
}

.wizard-main {
  padding: 2rem;
  display: flex;
  justify-content: center;
}

.wizard-container {
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 800px;
  overflow: hidden;
}

.step-header {
  padding: 2rem 2rem 1rem;
  text-align: center;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
}

.step-title {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  font-size: 2rem;
  font-weight: 700;
  color: #1e293b;
  margin: 0 0 0.5rem;
}

.step-icon {
  font-size: 2rem;
  color: #3b82f6;
}

.step-description {
  color: #64748b;
  font-size: 1.125rem;
  margin: 0;
}

.step-content {
  padding: 2rem;
}

.step-panel {
  min-height: 400px;
}

/* 步骤1样式 */
.title-section {
  margin-bottom: 2rem;
}

.form-label {
  display: block;
  font-weight: 600;
  color: #374151;
  margin-bottom: 0.75rem;
  font-size: 1.125rem;
}

.title-input {
  font-size: 1.25rem;
}

.length-section {
  margin-bottom: 2rem;
}

.length-options {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1rem;
  margin-top: 1rem;
}

.length-option {
  padding: 1.5rem;
  border: 2px solid #e5e7eb;
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
  text-align: center;
}

.length-option:hover {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.05);
}

.length-option.active {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
}

.option-label {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 0.5rem;
}

.option-description {
  color: #64748b;
  font-size: 0.875rem;
}

.auto-config {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  background: #f8fafc;
  border-radius: 12px;
}

.config-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
}

.config-label {
  font-weight: 500;
  color: #374151;
}

.config-info {
  color: #6b7280;
  cursor: help;
}

.counter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.count {
  min-width: 2rem;
  text-align: center;
  font-weight: 600;
}

/* 步骤2样式 */
.summary-content {
  height: 100%;
}

.summary-textarea {
  font-size: 1rem;
  line-height: 1.6;
}

/* 步骤3样式 */
.outline-tabs-container {
  margin-bottom: 1.5rem;
}

.outline-tabs-container :deep(.el-tabs__header) {
  margin-bottom: 0;
}

.outline-description {
  margin-bottom: 1.5rem;
  color: #64748b;
  font-size: 14px;
}

.outline-content {
  min-height: 300px;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.outline-list-container {
  flex: 1;
  overflow-y: auto;
  max-height: 400px;
  margin-bottom: 1.5rem;
  padding-right: 8px;
}

.outline-list-container::-webkit-scrollbar {
  width: 6px;
}

.outline-list-container::-webkit-scrollbar-track {
  background: #f1f1f1;
  border-radius: 3px;
}

.outline-list-container::-webkit-scrollbar-thumb {
  background: #c1c1c1;
  border-radius: 3px;
}

.outline-list-container::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8;
}

.outline-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 4px;
}

.outline-card {
  transition: all 0.3s ease;
  cursor: pointer;
}

.outline-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
}

.outline-card.selected {
  border-color: #409eff;
}

.outline-card.drag-over {
  border-color: #67c23a;
  background-color: #f0f9ff;
  transform: translateY(-2px);
}

.outline-card[draggable="true"] {
  cursor: move;
}

.outline-item-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0;
}

.outline-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}

.outline-checkbox {
  flex-shrink: 0;
}

.outline-number {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #f0f2f5;
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 500;
  font-size: 12px;
  flex-shrink: 0;
  border: 1px solid #d9d9d9;
}

.outline-title-input {
  flex: 1;
}

.outline-actions {
  display: flex;
  gap: 8px;
  opacity: 0;
  transform: translateX(10px);
  transition: all 0.3s ease;
}

.outline-card:hover .outline-actions {
  opacity: 1;
  transform: translateX(0);
}

.drag-handle {
  cursor: move;
}

.add-outline-btn {
  width: 100%;
  height: 48px;
  border-style: dashed;
  background: transparent;
  border-color: #d9d9d9;
  color: #666;
  flex-shrink: 0;
}

.add-outline-btn:hover {
  border-color: #409eff;
  color: #409eff;
}

.no-outline-content {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 300px;
}

/* 步骤4样式 */
.content-preview {
  background: #f8fafc;
  border-radius: 12px;
  padding: 1.5rem;
}

.preview-header h3 {
  margin: 0 0 1.5rem;
  color: #1e293b;
}

.preview-content > div {
  margin-bottom: 1.5rem;
}

.preview-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #1e293b;
}

.preview-summary p {
  margin: 0.5rem 0 0;
  line-height: 1.6;
  color: #4b5563;
}

.preview-outline ul {
  margin: 0.5rem 0 0;
  padding-left: 1.5rem;
}

.preview-outline li {
  margin-bottom: 0.5rem;
  color: #4b5563;
}

.preview-length {
  color: #4b5563;
}

/* 底部操作区 */
.wizard-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem 2rem;
  background: #f8fafc;
  border-top: 1px solid #e5e7eb;
}

.footer-left,
.footer-right {
  display: flex;
  gap: 1rem;
}

.skip-btn,
.regenerate-btn {
  border: none;
  background: transparent;
  color: #6b7280;
}

.skip-btn:hover,
.regenerate-btn:hover {
  color: #3b82f6;
  background: rgba(59, 130, 246, 0.1);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .wizard-main {
    padding: 1rem;
  }
  
  .header-content {
    padding: 0 1rem;
  }
  
  .wizard-progress {
    display: none;
  }
  
  .length-options {
    grid-template-columns: 1fr;
  }
  
  .step-content {
    padding: 1.5rem;
  }
  
  .wizard-footer {
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }
  
  .footer-left,
  .footer-right {
    justify-content: center;
  }
}
</style>