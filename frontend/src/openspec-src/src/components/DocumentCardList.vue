<script setup lang="ts">
import { ref } from 'vue'
import { Document, MoreFilled } from '@element-plus/icons-vue'
import type { DocumentItem, ProjectInfo } from '../data/mockData'

export interface DocTag {
  name: string
  type: string
}

interface Props {
  documents: DocumentItem[]
  viewMode?: 'grid' | 'list'
  /** 网格视图卡片最小宽度 */
  gridMinWidth?: string
  /** 是否显示标签列（列表视图） */
  showTags?: boolean
  /** 是否显示卡片底部操作按钮（网格视图） */
  showFooterActions?: boolean
  /** 标签获取函数 */
  getDocTags?: (doc: DocumentItem) => DocTag[]
}

const props = withDefaults(defineProps<Props>(), {
  viewMode: 'grid',
  gridMinWidth: '240px',
  showTags: false,
  showFooterActions: false,
  getDocTags: () => () => [],
})

const emit = defineEmits<{
  open: [docId: string]
  action: [command: string, docId: string]
}>()

// 文档概况对话框
const overviewDialogVisible = ref(false)
const currentProjectInfo = ref<ProjectInfo | null>(null)
const currentDocName = ref('')

const handleAction = (command: string, docId: string) => {
  if (command === 'view_overview') {
    const doc = props.documents.find(d => d.id === docId)
    if (doc) {
      currentDocName.value = doc.name
      currentProjectInfo.value = doc.projectInfo || null
      overviewDialogVisible.value = true
    }
  } else {
    emit('action', command, docId)
  }
}

// 格式化显示值
const formatValue = (value: any) => {
  if (value === undefined || value === null || value === '') {
    return null
  }
  return value
}
</script>

<template>
  <!-- 网格视图 -->
  <div v-if="viewMode === 'grid'" class="doc-card-grid" :style="{ '--grid-min-width': gridMinWidth }">
    <div
      v-for="doc in documents"
      :key="doc.id"
      class="doc-card"
    >
      <div class="doc-card-main" @click="$emit('open', doc.id)">
        <div class="doc-card-header">
          <div class="doc-icon">
            <el-icon :size="20"><Document /></el-icon>
          </div>
          <el-dropdown
            trigger="click"
            @command="(cmd: string) => handleAction(cmd, doc.id)"
          >
            <el-button :icon="MoreFilled" size="small" link class="doc-action-btn" @click.stop />
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="view_overview">文档概况</el-dropdown-item>
                <el-dropdown-item command="export_cad">同步到 AutoCAD</el-dropdown-item>
                <el-dropdown-item command="export_md">导出 Markdown</el-dropdown-item>
                <el-dropdown-item command="rename">重命名</el-dropdown-item>
                <el-dropdown-item command="delete" class="danger-item">删除</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
        <div class="doc-card-name">{{ doc.name }}</div>
        <div class="doc-card-time">{{ doc.lastModified }}</div>
      </div>
    </div>
  </div>

  <!-- 列表视图 -->
  <div v-else class="doc-table">
    <div class="doc-table-header" :class="{ 'has-tags': showTags }">
      <div class="table-col col-name">文件名</div>
      <div class="table-col col-updated">更新时间</div>
      <div v-if="showTags" class="table-col col-tags">标签类型</div>
      <div class="table-col col-actions"></div>
    </div>
    <div
      v-for="doc in documents"
      :key="doc.id"
      class="doc-table-row"
      :class="{ 'has-tags': showTags }"
      @click="$emit('open', doc.id)"
    >
      <div class="table-col col-name">
        <div class="doc-name-cell">
          <div class="doc-icon">
            <el-icon :size="18"><Document /></el-icon>
          </div>
          <span class="doc-name-text">{{ doc.name }}</span>
        </div>
      </div>
      <div class="table-col col-updated">{{ doc.lastModified }}</div>
      <div v-if="showTags" class="table-col col-tags">
        <div v-if="getDocTags(doc).length > 0" class="doc-tag-list">
          <el-tag
            v-for="tag in getDocTags(doc)"
            :key="tag.name"
            size="small"
            :type="(tag.type as any)"
            class="doc-tag"
          >
            {{ tag.name }}
          </el-tag>
        </div>
        <span v-else class="doc-tag-empty">—</span>
      </div>
      <div class="table-col col-actions" @click.stop>
        <el-dropdown
          trigger="click"
          @command="(cmd: string) => handleAction(cmd, doc.id)"
        >
          <el-button :icon="MoreFilled" size="small" link class="doc-action-btn" />
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="view_overview">文档概况</el-dropdown-item>
              <el-dropdown-item command="export_cad">同步到 AutoCAD</el-dropdown-item>
              <el-dropdown-item command="export_md">导出 Markdown</el-dropdown-item>
              <el-dropdown-item command="rename">重命名</el-dropdown-item>
              <el-dropdown-item command="delete" class="danger-item">删除</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>
  </div>

  <!-- 文档概况对话框 -->
  <el-dialog
    v-model="overviewDialogVisible"
    :title="`文档概况 - ${currentDocName}`"
    width="60%"
    top="5vh"
    :close-on-click-modal="false"
    class="overview-dialog"
  >
    <div v-if="currentProjectInfo" class="project-overview">
      <!-- 基本信息 -->
      <div class="overview-section">
        <h3 class="section-title">基本信息</h3>
        <div class="info-grid">
          <div v-if="formatValue(currentProjectInfo.projectName)" class="info-item">
            <span class="info-label">项目名称</span>
            <span class="info-value">{{ currentProjectInfo.projectName }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.buildingName)" class="info-item">
            <span class="info-label">建筑名称</span>
            <span class="info-value">{{ currentProjectInfo.buildingName }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.projectAddress)" class="info-item full-width">
            <span class="info-label">项目地址</span>
            <span class="info-value">{{ currentProjectInfo.projectAddress }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.constructionUnit)" class="info-item full-width">
            <span class="info-label">建设单位</span>
            <span class="info-value">{{ currentProjectInfo.constructionUnit }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.designUnit)" class="info-item full-width">
            <span class="info-label">设计单位</span>
            <span class="info-value">{{ currentProjectInfo.designUnit }}</span>
          </div>
        </div>
      </div>

      <!-- 建筑参数 -->
      <div class="overview-section">
        <h3 class="section-title">建筑参数</h3>
        <div class="info-grid">
          <div v-if="formatValue(currentProjectInfo.buildingType)" class="info-item">
            <span class="info-label">建筑类型</span>
            <span class="info-value">{{ currentProjectInfo.buildingType }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.buildingFunction)" class="info-item">
            <span class="info-label">使用功能</span>
            <span class="info-value">{{ currentProjectInfo.buildingFunction }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.buildingArea)" class="info-item">
            <span class="info-label">建筑面积</span>
            <span class="info-value">{{ currentProjectInfo.buildingArea }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.plotRatioArea)" class="info-item">
            <span class="info-label">计容面积</span>
            <span class="info-value">{{ currentProjectInfo.plotRatioArea }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.buildingHeight)" class="info-item">
            <span class="info-label">建筑高度</span>
            <span class="info-value">{{ currentProjectInfo.buildingHeight }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.floors)" class="info-item">
            <span class="info-label">地上层数</span>
            <span class="info-value">{{ currentProjectInfo.floors }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.undergroundFloors)" class="info-item">
            <span class="info-label">地下层数</span>
            <span class="info-value">{{ currentProjectInfo.undergroundFloors }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.indoorOutdoorHeight)" class="info-item">
            <span class="info-label">室内外高差</span>
            <span class="info-value">{{ currentProjectInfo.indoorOutdoorHeight }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.absoluteElevation)" class="info-item">
            <span class="info-label">绝对标高</span>
            <span class="info-value">{{ currentProjectInfo.absoluteElevation }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.landUseType)" class="info-item">
            <span class="info-label">土地使用性质</span>
            <span class="info-value">{{ currentProjectInfo.landUseType }}</span>
          </div>
        </div>
      </div>

      <!-- 技术参数 -->
      <div class="overview-section">
        <h3 class="section-title">技术参数</h3>
        <div class="info-grid">
          <div v-if="formatValue(currentProjectInfo.structureType)" class="info-item">
            <span class="info-label">结构类型</span>
            <span class="info-value">{{ currentProjectInfo.structureType }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.structureDesignLife)" class="info-item">
            <span class="info-label">结构设计使用年限</span>
            <span class="info-value">{{ currentProjectInfo.structureDesignLife }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.seismicIntensity)" class="info-item">
            <span class="info-label">抗震设防烈度</span>
            <span class="info-value">{{ currentProjectInfo.seismicIntensity }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.climateZone)" class="info-item">
            <span class="info-label">建筑气候分区</span>
            <span class="info-value">{{ currentProjectInfo.climateZone }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.fireResistanceGrade)" class="info-item">
            <span class="info-label">耐火等级</span>
            <span class="info-value">{{ currentProjectInfo.fireResistanceGrade }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.fireCategory)" class="info-item">
            <span class="info-label">防火类别</span>
            <span class="info-value">{{ currentProjectInfo.fireCategory }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.waterproofCategory)" class="info-item">
            <span class="info-label">防水类别</span>
            <span class="info-value">{{ currentProjectInfo.waterproofCategory }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.waterproofGrade)" class="info-item">
            <span class="info-label">防水等级</span>
            <span class="info-value">{{ currentProjectInfo.waterproofGrade }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.roofWaterproofLife)" class="info-item full-width">
            <span class="info-label">屋面防水合理使用年限</span>
            <span class="info-value">{{ currentProjectInfo.roofWaterproofLife }}</span>
          </div>
        </div>
      </div>

      <!-- 其他信息 -->
      <div class="overview-section">
        <h3 class="section-title">其他信息</h3>
        <div class="info-grid">
          <div v-if="formatValue(currentProjectInfo.energyEfficiencyRequirement)" class="info-item full-width">
            <span class="info-label">节能要求</span>
            <span class="info-value">{{ currentProjectInfo.energyEfficiencyRequirement }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.barrierFreeRequirement)" class="info-item full-width">
            <span class="info-label">无障碍要求</span>
            <span class="info-value">{{ currentProjectInfo.barrierFreeRequirement }}</span>
          </div>
          <div v-if="formatValue(currentProjectInfo.projectDescription)" class="info-item full-width">
            <span class="info-label">项目概况描述</span>
            <span class="info-value">{{ currentProjectInfo.projectDescription }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="no-project-info">
      <el-empty description="该文档暂无项目信息" />
    </div>

    <template #footer>
      <el-button type="primary" @click="overviewDialogVisible = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* ===== 网格视图 ===== */
.doc-card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--grid-min-width, 240px), 1fr));
  gap: 16px;
}

.doc-card {
  background: white;
  border-radius: 12px;
  padding: 20px;
  border: 1px solid var(--gray-200);
  transition: all 0.2s ease;
}

.doc-card-main {
  min-width: 0;
  cursor: pointer;
}

.doc-card:hover {
  border-color: var(--primary-color);
  box-shadow: 0 4px 12px rgba(0, 120, 212, 0.1);
}

.doc-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.doc-icon {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--primary-light, #E6F2FF);
  color: var(--primary-color);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.doc-action-btn {
  color: var(--gray-400);
  opacity: 0;
  transition: opacity 0.15s ease;
}

.doc-card:hover .doc-action-btn,
.doc-table-row:hover .doc-action-btn {
  opacity: 1;
}

.doc-action-btn:hover {
  color: var(--primary-color);
}

.doc-card-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--gray-900);
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-card-time {
  font-size: 12px;
  color: var(--gray-400);
  margin-bottom: 14px;
}

.doc-card-footer {
  display: flex;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--gray-100);
}

/* ===== 列表视图 ===== */
.doc-table {
  background: white;
  border: 1px solid var(--gray-200);
  border-radius: 12px;
  overflow: hidden;
}

.doc-table-header,
.doc-table-row {
  display: grid;
  grid-template-columns: 3fr 1.5fr 0.6fr;
  align-items: center;
  column-gap: 16px;
  padding: 12px 16px;
}

.doc-table-header.has-tags,
.doc-table-row.has-tags {
  grid-template-columns: 2.2fr 1.2fr 1.6fr 0.6fr;
}

.doc-table-header {
  background: var(--gray-50);
  font-size: 12px;
  font-weight: 600;
  color: var(--gray-500);
}

.doc-table-row {
  cursor: pointer;
  transition: background 0.15s ease;
  border-top: 1px solid var(--gray-100);
}

.doc-table-row:hover {
  background: rgba(0, 120, 212, 0.04);
}

.table-col {
  min-width: 0;
}

.col-actions {
  display: flex;
  justify-content: flex-end;
}

.doc-name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.doc-name-text {
  font-size: 14px;
  font-weight: 600;
  color: var(--gray-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.doc-tag-empty {
  font-size: 12px;
  color: var(--gray-400);
}

.danger-item {
  color: var(--error-color, #EF4444);
}

/* ===== 响应式 ===== */
@media (max-width: 768px) {
  .doc-card-grid {
    grid-template-columns: 1fr;
  }

  .doc-table {
    overflow-x: auto;
  }

  .doc-table-header,
  .doc-table-row {
    min-width: 480px;
  }

  .doc-table-header.has-tags,
  .doc-table-row.has-tags {
    min-width: 640px;
  }
}

/* ===== 文档概况对话框 ===== */
.overview-dialog {
  max-width: 1200px;
}

.project-overview {
  max-height: 70vh;
  overflow-y: auto;
  padding: 4px 8px;
}

.overview-section {
  margin-bottom: 24px;
}

.overview-section:last-child {
  margin-bottom: 0;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--gray-800);
  margin: 0 0 14px 0;
  padding-left: 12px;
  border-left: 3px solid var(--primary-color);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 10px 14px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 10px 14px;
  background: var(--gray-50);
  border-radius: 6px;
  transition: background 0.2s ease;
  min-height: 60px;
}

.info-item:hover {
  background: #f0f5ff;
}

.info-item.full-width {
  grid-column: 1 / -1;
}

.info-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--gray-500);
  line-height: 1.3;
}

.info-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--gray-900);
  line-height: 1.4;
  word-break: break-word;
}

.no-project-info {
  padding: 40px 0;
  text-align: center;
}

/* 响应式布局 */
@media (min-width: 1400px) {
  .info-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (min-width: 1000px) and (max-width: 1399px) {
  .info-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (min-width: 768px) and (max-width: 999px) {
  .info-grid {
    grid-template-columns: repeat(2, 1fr);
  }

  .overview-dialog {
    width: 90% !important;
  }
}

@media (max-width: 767px) {
  .info-grid {
    grid-template-columns: 1fr;
  }

  .info-item.full-width {
    grid-column: 1;
  }

  .overview-dialog {
    width: 95% !important;
  }

  .project-overview {
    max-height: 65vh;
  }
}
</style>
