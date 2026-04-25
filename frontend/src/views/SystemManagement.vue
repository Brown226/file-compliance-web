<template>
  <div class="system-management">
    <!-- 顶部标题栏 -->
    <div class="page-header">
      <div class="header-left">
        <h2>系统管理</h2>
      </div>
    </div>

    <!-- Tab 导航按钮 -->
    <div class="nav-tabs">
      <button
        v-for="tab in navTabs"
        :key="tab.value"
        :class="['nav-tab', { active: activeTab === tab.value }]"
        @click="activeTab = tab.value"
      >
        <span class="tab-icon">{{ tab.icon }}</span>
        <span class="tab-label">{{ tab.label }}</span>
      </button>
    </div>

    <!-- 内容区域 -->
    <div class="content-area">
      <!-- 部门管理 -->
      <div v-show="activeTab === 'department'" class="tab-content">
        <div class="dept-layout">
          <!-- 左侧：组织架构树 -->
          <el-card class="dept-tree-card" shadow="never">
            <template #header>
              <div class="card-header">
                <span><el-icon><Folder /></el-icon> 组织架构</span>
                <el-button type="primary" size="small" @click="handleAddRootDept">
                  <el-icon><Plus /></el-icon> 添加
                </el-button>
              </div>
            </template>

            <div class="dept-tree-container">
              <el-tree
                ref="deptTreeRef"
                :data="orgData"
                node-key="id"
                default-expand-all
                :expand-on-click-node="false"
                :props="{ label: 'name', children: 'children' }"
                @node-contextmenu="handleDeptContextMenu"
                @node-click="handleDeptNodeClick"
              >
                <template #default="{ data }">
                  <div class="dept-node">
                    <span class="dept-name">
                      <el-icon class="dept-icon"><Folder /></el-icon>
                      {{ data.name }}
                    </span>
                    <span class="dept-count">{{ getDeptMemberCount(data.id) }}人</span>
                  </div>
                </template>
              </el-tree>

              <!-- 右键菜单 -->
              <div
                v-show="contextMenuVisible"
                class="context-menu"
                :style="{ top: contextMenuY + 'px', left: contextMenuX + 'px' }"
              >
                <div class="context-item" @click="handleAddChildDept">
                  <el-icon><Plus /></el-icon> 添加子部门
                </div>
                <div class="context-item" @click="handleEditDept">
                  <el-icon><Edit /></el-icon> 编辑部门
                </div>
                <div class="context-item danger" @click="handleDeleteDept">
                  <el-icon><Delete /></el-icon> 删除部门
                </div>
              </div>
            </div>
          </el-card>

          <!-- 右侧：部门员工 -->
          <el-card class="dept-employees-card" shadow="never">
            <template #header>
              <div class="card-header">
                <span>
                  <el-icon><User /></el-icon>
                  {{ selectedDeptName || '全部部门' }} - 员工列表
                </span>
              </div>
            </template>

            <div class="employee-toolbar">
              <el-input
                v-model="empSearch"
                placeholder="搜索姓名或账号..."
                prefix-icon="Search"
                clearable
                style="width: 240px"
                @input="handleSearchChange"
              />
              <div class="toolbar-right">
                <el-button type="primary" @click="handleNewAccount">
                  <el-icon><Plus /></el-icon> 新建账号
                </el-button>
                <el-button @click="showBatchImportDialog = true">
                  <el-icon><Upload /></el-icon> 批量导入
                </el-button>
              </div>
            </div>

            <!-- 角色筛选 -->
            <div class="role-tabs">
              <span
                v-for="tab in roleTabs"
                :key="tab.value"
                class="role-tab"
                :class="{ active: empRoleFilter === tab.value }"
                @click="handleRoleFilter(tab.value)"
              >
                {{ tab.label }} ({{ tab.count }})
              </span>
            </div>

            <!-- 批量操作栏 -->
            <transition name="slide-fade">
              <div v-if="selectedEmployees.length > 0" class="batch-actions">
                <span class="selected-info">
                  <el-icon><Check /></el-icon> 已选择 {{ selectedEmployees.length }} 项
                </span>
                <el-button size="small" @click="handleBatchDisable" :loading="batchLoading">
                  <el-icon><Close /></el-icon> 批量停用
                </el-button>
                <el-button size="small" type="danger" @click="handleBatchDelete" :loading="batchLoading">
                  <el-icon><Delete /></el-icon> 批量删除
                </el-button>
                <el-button size="small" @click="selectedEmployees = []">
                  <el-icon><RefreshRight /></el-icon> 取消
                </el-button>
              </div>
            </transition>

            <!-- 员工卡片列表 -->
            <div class="employee-list" v-loading="empLoading">
              <div
                v-for="emp in filteredEmployees"
                :key="emp.id"
                class="employee-card"
                :class="{ selected: selectedEmployees.includes(emp.id) }"
              >
                <div class="card-left">
                  <el-checkbox
                    :model-value="selectedEmployees.includes(emp.id)"
                    @change="(val: boolean) => toggleSelect(emp.id, val)"
                  />
                  <div class="avatar-circle" :class="`avatar-${getAvatarClass(emp.role)}`">
                    {{ getAvatarLetter(emp) }}
                  </div>
                </div>
                <div class="card-info">
                  <div class="info-main">
                    <span class="emp-name">{{ emp.name }}</span>
                    <span class="role-badge" :class="`role-badge-${getAvatarClass(emp.role)}`">
                      <span class="role-dot"></span>
                      {{ getRoleLabel(emp.role) }}
                    </span>
                    <span class="emp-dept">{{ emp.department?.name || '未分配' }}</span>
                  </div>
                  <div class="info-sub">
                    <span class="emp-username">{{ emp.username }}</span>
                    <span v-if="emp.email" class="emp-email">{{ emp.email }}</span>
                  </div>
                </div>
                <div class="card-actions">
                  <el-button link type="primary" @click="handleEditEmployee(emp)">
                    <el-icon><Edit /></el-icon> 编辑
                  </el-button>
                  <el-button link type="warning" @click="handleResetPassword(emp)">
                    <el-icon><Key /></el-icon> 重置密码
                  </el-button>
                  <el-button link type="danger" @click="handleDeleteEmployee(emp)">
                    <el-icon><Delete /></el-icon> 删除
                  </el-button>
                </div>
              </div>

              <!-- 空状态 -->
              <div v-if="filteredEmployees.length === 0 && !empLoading" class="empty-state">
                <el-empty description="暂无员工数据" />
              </div>
            </div>

            <!-- 分页 -->
            <div class="pagination-container" v-if="empTotal > 0">
              <el-pagination
                v-model:current-page="empPage"
                v-model:page-size="empPageSize"
                :page-sizes="[10, 20, 50]"
                layout="total, sizes, prev, pager, next"
                :total="empTotal"
                @size-change="fetchEmployees"
                @current-change="fetchEmployees"
              />
            </div>
          </el-card>
        </div>
      </div>

      <!-- 存储管理 -->
      <div v-show="activeTab === 'storage'" class="tab-content">
        <div class="storage-panel">
          <el-card shadow="never">
            <template #header>
              <div class="card-header">
                <span><el-icon><Files /></el-icon> 存储空间统计</span>
                <el-button type="primary" @click="fetchStorageStats" :loading="storageLoading">
                  <el-icon><RefreshRight /></el-icon> 刷新
                </el-button>
              </div>
            </template>

            <!-- 存储概览 -->
            <div class="storage-overview" v-loading="storageLoading">
              <div class="storage-total">
                <div class="total-main">
                  <span class="total-icon"><el-icon><Folder /></el-icon></span>
                  <div class="total-info">
                    <span class="total-value">{{ storageStats.totalSizeMB || '0' }}</span>
                    <span class="total-unit">MB</span>
                  </div>
                </div>
                <div class="total-label">总占用空间</div>
              </div>

              <!-- 使用进度条 -->
              <div class="storage-progress">
                <div class="progress-bar">
                  <div class="progress-used" :style="{ width: storageStats.referencedPercent || '0%' }"></div>
                  <div class="progress-orphaned" :style="{ width: storageStats.orphanedPercent || '0%' }"></div>
                </div>
                <div class="progress-legend">
                  <span class="legend-item referenced">
                    <span class="legend-dot"></span>
                    有效文件 {{ storageStats.referencedSizeMB || '0' }} MB
                  </span>
                  <span class="legend-item orphaned">
                    <span class="legend-dot"></span>
                    孤立文件 {{ storageStats.orphanedSizeMB || '0' }} MB
                  </span>
                </div>
              </div>
            </div>

            <!-- 统计卡片 -->
            <div class="storage-stats" v-loading="storageLoading">
              <div class="stat-card referenced">
                <div class="stat-icon referenced-icon"><el-icon><Document /></el-icon></div>
                <div class="stat-info">
                  <div class="stat-value">{{ storageStats.referencedSizeMB || '0' }} MB</div>
                  <div class="stat-label">有效文件</div>
                  <div class="stat-count">{{ storageStats.referencedFiles || 0 }} 个文件</div>
                </div>
              </div>

              <div class="stat-card orphaned" :class="{ 'has-orphaned': storageStats.orphanedFiles > 0 }">
                <div class="stat-icon orphaned-icon"><el-icon><Delete /></el-icon></div>
                <div class="stat-info">
                  <div class="stat-value">{{ storageStats.orphanedSizeMB || '0' }} MB</div>
                  <div class="stat-label">孤立文件</div>
                  <div class="stat-count">{{ storageStats.orphanedFiles || 0 }} 个文件</div>
                </div>
              </div>
            </div>

            <!-- 清理建议 -->
            <div v-if="storageStats.orphanedFiles > 0" class="cleanup-section">
              <el-alert
                type="warning"
                :closable="false"
                show-icon
              >
                <template #title>
                  检测到 <strong>{{ storageStats.orphanedFiles }} 个孤立文件</strong>，占用 <strong>{{ storageStats.orphanedSizeMB }} MB</strong> 空间
                </template>
              </el-alert>

              <div class="cleanup-actions">
                <el-form inline>
                  <el-form-item label="保留期限">
                    <el-select v-model="cleanupDays" style="width: 120px">
                      <el-option :value="1" label="1天前" />
                      <el-option :value="3" label="3天前" />
                      <el-option :value="7" label="7天前" />
                      <el-option :value="30" label="30天前" />
                    </el-select>
                  </el-form-item>
                  <el-form-item>
                    <el-button type="danger" @click="handleCleanup" :loading="cleanupLoading">
                      <el-icon><Delete /></el-icon> 清理孤立文件
                    </el-button>
                  </el-form-item>
                </el-form>
              </div>
            </div>

            <div v-else-if="!storageLoading" class="no-orphaned">
              <el-icon color="#67c23a" :size="32"><CircleCheckFilled /></el-icon>
              <span>存储空间使用正常，暂无孤立文件</span>
            </div>
          </el-card>
        </div>
      </div>
    </div>

    <!-- 部门弹窗 -->
    <el-dialog
      v-model="deptDialogVisible"
      :title="deptDialogType === 'add' ? (deptParentId ? '添加子部门' : '添加顶级部门') : '编辑部门'"
      width="420px"
    >
      <el-form :model="deptForm" label-width="80px">
        <el-form-item label="部门名称" required>
          <el-input v-model="deptForm.name" placeholder="请输入部门名称" />
        </el-form-item>
        <el-form-item label="上级部门" v-if="deptDialogType === 'add' && !deptParentId">
          <el-cascader
            v-model="deptForm.parentId"
            :data="orgData"
            :props="{ label: 'name', children: 'children', value: 'id', checkStrictly: true }"
            placeholder="留空表示顶级部门"
            clearable
            :show-all-levels="false"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="deptDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="deptSubmitting" @click="submitDeptForm">确定</el-button>
      </template>
    </el-dialog>

    <!-- 账号弹窗 -->
    <el-dialog
      v-model="accountDialogVisible"
      :title="accountDialogType === 'add' ? '新建账号' : '编辑账号'"
      width="620px"
    >
      <el-form :model="accountForm" label-width="85px">
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="登录账号" required>
              <el-input
                v-model="accountForm.username"
                placeholder="请输入登录账号"
                :disabled="accountDialogType === 'edit'"
              />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="真实姓名" required>
              <el-input v-model="accountForm.name" placeholder="请输入真实姓名" />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16" v-if="accountDialogType === 'add'">
          <el-col :span="12">
            <el-form-item label="初始密码" required>
              <div style="display:flex;gap:8px">
                <el-input v-model="accountForm.password" placeholder="自动生成" style="flex:1" />
                <el-button @click="generatePassword">生成</el-button>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="邮箱">
              <el-input v-model="accountForm.email" placeholder="可选" />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row :gutter="16" v-else>
          <el-col :span="12">
            <el-form-item label="邮箱">
              <el-input v-model="accountForm.email" placeholder="可选" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="修改密码">
              <el-input
                v-model="accountForm.password"
                placeholder="留空则保持不变"
                show-password
              />
            </el-form-item>
          </el-col>
        </el-row>

        <!-- 角色卡片选择 -->
        <el-form-item label="分配角色" required>
          <div class="role-card-group">
            <div
              v-for="role in roleOptions"
              :key="role.value"
              class="role-card"
              :class="{ 'role-card-active': accountForm.role === role.value }"
              @click="accountForm.role = role.value"
            >
              <span class="role-dot" :class="`role-dot-${role.cls}`"></span>
              <span>{{ role.label }}</span>
            </div>
          </div>
        </el-form-item>

        <el-alert v-if="accountDialogType === 'add'" type="info" :closable="false" show-icon>
          <template #title>密码将自动生成，首次登录后建议修改</template>
        </el-alert>
        <el-alert v-else type="info" :closable="false" show-icon>
          <template #title>如需重置密码，请在上方输入新密码后保存；留空则保持原密码不变</template>
        </el-alert>
      </el-form>
      <template #footer>
        <el-button @click="accountDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="accountSubmitting" @click="submitAccountForm">
          {{ accountDialogType === 'add' ? '创建账号' : '保存修改' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 批量导入弹窗 -->
    <el-dialog
      v-model="showBatchImportDialog"
      title="批量导入员工"
      width="680px"
    >
      <div class="batch-import-content">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px">
          <template #title>
            请上传包含员工信息的 Excel 文件，支持 .xlsx/.xls 格式
          </template>
        </el-alert>

        <!-- 下载模板 -->
        <div class="template-section">
          <el-button size="small" @click="downloadTemplate">
            <el-icon><Download /></el-icon> 下载导入模板
          </el-button>
        </div>

        <!-- Excel 预览 -->
        <div v-if="previewData.length > 0" class="preview-section">
          <div class="preview-header">
            <span>预览数据（共 {{ previewData.length }} 条）</span>
            <el-button link type="danger" size="small" @click="previewData = []">
              <el-icon><Delete /></el-icon> 清除
            </el-button>
          </div>
          <el-table :data="previewData" size="small" max-height="200" border>
            <el-table-column prop="username" label="登录账号" />
            <el-table-column prop="name" label="真实姓名" />
            <el-table-column prop="password" label="密码" />
            <el-table-column prop="role" label="角色">
              <template #default="{ row }">
                {{ getRoleLabel(row.role) }}
              </template>
            </el-table-column>
            <el-table-column label="一级部门" width="120">
              <template #default="{ row }">{{ row.deptLevel1 || '-' }}</template>
            </el-table-column>
            <el-table-column label="二级部门" width="120">
              <template #default="{ row }">{{ row.deptLevel2 || '-' }}</template>
            </el-table-column>
            <el-table-column label="三级部门" width="120">
              <template #default="{ row }">{{ row.deptLevel3 || '-' }}</template>
            </el-table-column>
            <el-table-column label="部门(旧)" width="100">
              <template #default="{ row }">{{ row.department || '-' }}</template>
            </el-table-column>
            <el-table-column prop="email" label="邮箱" />
          </el-table>
        </div>

        <!-- 上传区域 -->
        <div v-else class="upload-section">
          <el-upload
            ref="uploadRef"
            class="excel-uploader"
            drag
            :auto-upload="false"
            :limit="1"
            accept=".xlsx,.xls"
            :on-change="handleFileChange"
          >
            <el-icon class="upload-icon"><UploadFilled /></el-icon>
            <div class="upload-text">
              <span>将 Excel 文件拖到此处，或 <em>点击上传</em></span>
              <span class="upload-tip">仅支持 .xlsx, .xls 格式</span>
            </div>
          </el-upload>
        </div>
      </div>
      <template #footer>
        <el-button @click="showBatchImportDialog = false">取消</el-button>
        <el-button
          type="primary"
          :loading="batchImportLoading"
          :disabled="previewData.length === 0"
          @click="handleBatchImport"
        >
          确认导入 {{ previewData.length > 0 ? `(${previewData.length}条)` : '' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useUserStore } from '@/stores/user'
import {
  Plus, Search, Folder, Edit, Delete, Upload, Download, User, Key,
  Check, Close, RefreshRight, UploadFilled, Files, Document, CircleCheckFilled
} from '@element-plus/icons-vue'
import * as XLSX from 'xlsx'
import {
  getDepartmentsTreeApi,
  createDepartmentApi,
  updateDepartmentApi,
  deleteDepartmentApi,
  findOrCreateDepartmentPathApi,
  getEmployeesApi,
  createEmployeeApi,
  updateEmployeeApi,
  deleteEmployeeApi,
  batchCreateEmployeesApi,
  batchUpdateStatusApi,
  batchDeleteEmployeesApi,
  resetPasswordApi,
  getStorageStatsApi,
  cleanupFilesApi,
} from '@/api/system'

// ========== Tab 导航 ==========
const activeTab = ref('department')
const navTabs = [
  { label: '部门管理', value: 'department', icon: '🏢', desc: '组织架构与员工' },
  { label: '存储管理', value: 'storage', icon: '💾', desc: '文件存储与清理' },
]

// ========== 部门管理 ==========
const orgData = ref<any[]>([])
const deptTreeRef = ref()
const deptTreeLoading = ref(false)
const selectedDeptId = ref<string | null>(null)
const selectedDeptName = ref('')

// 右键菜单
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuDept = ref<any>(null)

const handleDeptContextMenu = (e: MouseEvent, data: any) => {
  e.preventDefault()
  contextMenuDept.value = data
  contextMenuX.value = e.clientX
  contextMenuY.value = e.clientY
  contextMenuVisible.value = true
}

const hideContextMenu = () => {
  contextMenuVisible.value = false
}

const handleDeptNodeClick = (data: any) => {
  if (selectedDeptId.value === data.id) {
    selectedDeptId.value = null
    selectedDeptName.value = ''
  } else {
    selectedDeptId.value = data.id
    selectedDeptName.value = data.name
  }
  empRoleFilter.value = 'ALL'
  empPage.value = 1
  empSearch.value = ''
  fetchEmployees()
  fetchDeptEmployeesForCount() // 切换部门时重新获取角色统计
}

const fetchDepartments = async () => {
  deptTreeLoading.value = true
  try {
    const res = await getDepartmentsTreeApi()
    orgData.value = res.data || []
  } catch (e) {
    console.error('获取部门数据失败', e)
    ElMessage.error('获取部门数据失败')
  } finally {
    deptTreeLoading.value = false
  }
}

const handleAddRootDept = () => {
  deptParentId.value = ''
  deptDialogType.value = 'add'
  deptForm.name = ''
  deptForm.parentId = []
  deptDialogVisible.value = true
}

const handleAddChildDept = () => {
  hideContextMenu()
  if (!contextMenuDept.value) return
  deptParentId.value = contextMenuDept.value.id
  deptDialogType.value = 'add'
  deptForm.name = ''
  deptForm.parentId = buildDeptPath(orgData.value, contextMenuDept.value.id) || []
  deptDialogVisible.value = true
}

const handleEditDept = () => {
  hideContextMenu()
  if (!contextMenuDept.value) return
  deptDialogType.value = 'edit'
  deptForm.id = contextMenuDept.value.id
  deptForm.name = contextMenuDept.value.name
  deptForm.parentId = contextMenuDept.value.parentId
    ? (buildDeptPath(orgData.value, contextMenuDept.value.parentId) || [])
    : []
  deptDialogVisible.value = true
}

const handleDeleteDept = () => {
  hideContextMenu()
  if (!contextMenuDept.value) return
  ElMessageBox.confirm(
    `确认删除部门 "${contextMenuDept.value.name}" 吗？删除后该部门下的员工将变为未分配状态。`,
    '删除确认',
    { type: 'warning' }
  ).then(async () => {
    try {
      await deleteDepartmentApi(contextMenuDept.value.id)
      ElMessage.success('部门已删除')
      // 如果删除的是当前选中的部门，清除选择
      if (selectedDeptId.value === contextMenuDept.value.id) {
        selectedDeptId.value = null
        selectedDeptName.value = ''
      }
      fetchDepartments()
      fetchEmployees()
      fetchGlobalEmployeesForCount()
      fetchDeptEmployeesForCount()
    } catch (e: any) {
      ElMessage.error(e.response?.data?.message || '删除失败')
    }
  }).catch(() => {})
}

// 部门表单
const deptDialogVisible = ref(false)
const deptDialogType = ref<'add' | 'edit'>('add')
const deptSubmitting = ref(false)
const deptParentId = ref('')
const deptForm = reactive({ id: '', name: '', parentId: [] as string[] })

const submitDeptForm = async () => {
  if (!deptForm.name.trim()) {
    ElMessage.warning('请输入部门名称')
    return
  }
  // 从 el-cascader 数组中提取最后一个元素作为实际 parentId
  const parentDeptId = Array.isArray(deptForm.parentId) && deptForm.parentId.length > 0
    ? deptForm.parentId[deptForm.parentId.length - 1]
    : undefined

  deptSubmitting.value = true
  try {
    if (deptDialogType.value === 'add') {
      await createDepartmentApi({ name: deptForm.name, parentId: parentDeptId || undefined })
      ElMessage.success('部门添加成功')
    } else {
      await updateDepartmentApi(deptForm.id, { name: deptForm.name })
      ElMessage.success('部门编辑成功')
    }
    deptDialogVisible.value = false
    fetchDepartments()
    fetchGlobalEmployeesForCount() // 部门变更后刷新计数
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '操作失败')
  } finally {
    deptSubmitting.value = false
  }
}

// ========== 员工管理 ==========
const employeeData = ref<any[]>([])
const allEmployeesData = ref<any[]>([]) // 当前部门下的全量员工数据（用于角色统计）
const empLoading = ref(false)
const empPage = ref(1)
const empPageSize = ref(10)
const empTotal = ref(0)
const empSearch = ref('')
const empRoleFilter = ref('ALL')
const selectedEmployees = ref<string[]>([])
const batchLoading = ref(false)

// 角色选项
const roleOptions = [
  { value: 'ADMIN', label: '管理员', cls: 'admin' },
  { value: 'MANAGER', label: '部门主管', cls: 'manager' },
  { value: 'USER', label: '普通员工', cls: 'user' },
]

// 角色统计基于当前部门下的全量数据（不受角色筛选影响）
const roleTabs = computed(() => {
  const all = allEmployeesData.value
  return [
    { label: '全部', value: 'ALL', count: all.length },
    { label: '管理员', value: 'ADMIN', count: all.filter(e => e.role === 'ADMIN').length },
    { label: '部门主管', value: 'MANAGER', count: all.filter(e => e.role === 'MANAGER').length },
    { label: '普通员工', value: 'USER', count: all.filter(e => e.role === 'USER').length },
  ]
})

const filteredEmployees = computed(() => {
  return employeeData.value
})

const getAvatarClass = (role: string) => {
  const map: Record<string, string> = { ADMIN: 'admin', MANAGER: 'manager', USER: 'user' }
  return map[role] || 'user'
}

const getAvatarLetter = (emp: any) => {
  return (emp.name || emp.username || '?').charAt(0).toUpperCase()
}

const getRoleLabel = (role: string) => {
  const map: Record<string, string> = { ADMIN: '管理员', MANAGER: '部门主管', USER: '普通员工' }
  return map[role] || role
}

// ========== 部门员工计数 ==========
const deptMemberCounts = ref<Record<string, number>>({})

// 递归收集子部门ID
const getSubDeptIds = (dept: any): string[] => {
  const ids = [dept.id]
  if (dept.children) {
    dept.children.forEach((child: any) => {
      ids.push(...getSubDeptIds(child))
    })
  }
  return ids
}

// 递归查找部门节点
const findDeptNode = (tree: any[], deptId: string): any => {
  for (const node of tree) {
    if (node.id === deptId) return node
    if (node.children) {
      const found = findDeptNode(node.children, deptId)
      if (found) return found
    }
  }
  return null
}

// 构建从根到目标部门的路径数组（el-cascader 需要）
const buildDeptPath = (tree: any[], targetId: string, path: string[] = []): string[] | null => {
  for (const node of tree) {
    const currentPath = [...path, node.id]
    if (node.id === targetId) return currentPath
    if (node.children) {
      const found = buildDeptPath(node.children, targetId, currentPath)
      if (found) return found
    }
  }
  return null
}

// 获取部门员工数（含子部门）
const getDeptMemberCount = (deptId: string) => {
  return deptMemberCounts.value[deptId] || 0
}

// 全局所有员工数据（用于部门树计数，不受部门筛选影响）
const globalEmployeesData = ref<any[]>([])

// 构建部门名称到ID的映射表
const buildDeptNameToIdMap = (depts: any[], parentPath = ''): Map<string, string> => {
  const map = new Map<string, string>()
  for (const dept of depts) {
    const fullPath = parentPath ? `${parentPath}/${dept.name}` : dept.name
    map.set(dept.name, dept.id) // 支持直接使用部门名称
    map.set(fullPath, dept.id) // 支持使用完整路径（如"技术部/前端组"）
    if (dept.children && dept.children.length > 0) {
      const childMap = buildDeptNameToIdMap(dept.children, fullPath)
      childMap.forEach((value, key) => map.set(key, value))
    }
  }
  return map
}

// 获取部门名称对应的ID
const getDepartmentIdByName = (deptName: string): string | undefined => {
  if (!deptName || !orgData.value || orgData.value.length === 0) {
    return undefined
  }
  
  const nameToIdMap = buildDeptNameToIdMap(orgData.value)
  
  // 尝试精确匹配
  if (nameToIdMap.has(deptName)) {
    return nameToIdMap.get(deptName)
  }
  
  // 尝试模糊匹配（去除空格）
  const trimmedName = deptName.trim()
  if (nameToIdMap.has(trimmedName)) {
    return nameToIdMap.get(trimmedName)
  }
  
  // 尝试部分匹配
  for (const [name, id] of nameToIdMap.entries()) {
    if (name.includes(trimmedName) || trimmedName.includes(name)) {
      console.warn(`部门名称 "${deptName}" 模糊匹配到 "${name}"`)
      return id
    }
  }
  
  console.warn(`未找到部门: "${deptName}"`)
  return undefined
}

// 多级部门路径查找（精确匹配）
const findDeptByPath = (depts: any[], path: string[]): any | undefined => {
  if (path.length === 0) return undefined
  const [current, ...rest] = path
  const found = depts.find(d => d.name === current)
  if (!found) return undefined
  if (rest.length === 0) return found
  return findDeptByPath(found.children || [], rest)
}

// 根据多级部门字段解析部门ID（使用后端接口，一次性完成查找或自动创建）
const resolveDepartmentId = async (level1: string, level2: string, level3: string): Promise<{ departmentId: string | undefined; createdDepts: string[] }> => {
  const levels = [level1, level2, level3].filter(l => l && l.trim())
  if (levels.length === 0) {
    return { departmentId: undefined, createdDepts: [] }
  }
  
  try {
    const { data } = await findOrCreateDepartmentPathApi({
      level1: level1?.trim(),
      level2: level2?.trim(),
      level3: level3?.trim()
    })
    return {
      departmentId: data.departmentId || undefined,
      createdDepts: data.created || []
    }
  } catch (e) {
    console.error('解析部门路径失败:', level1, level2, level3, e)
    // 失败时尝试本地查找（兼容旧版逻辑）
    const localLevels = [level1, level2, level3].filter(l => l && l.trim())
    const matched = findDeptByPath(orgData.value, localLevels)
    return {
      departmentId: matched?.id,
      createdDepts: []
    }
  }
}

// 获取全局全量员工数据（用于部门树计数）
const fetchGlobalEmployeesForCount = async () => {
  try {
    const { data } = await getEmployeesApi({ page: 1, limit: 99999, includeChildren: false })
    const records = data?.data || []
    globalEmployeesData.value = records.map((u: any) => ({
      id: u.id,
      departmentId: u.departmentId,
      role: u.role,
    }))
    updateDeptMemberCounts()
  } catch (e) {
    console.error('获取全局员工数据失败', e)
  }
}

// 获取当前部门下的全量员工数据（用于角色统计）
const fetchDeptEmployeesForCount = async () => {
  try {
    const params: any = { page: 1, limit: 99999, includeChildren: true }
    if (selectedDeptId.value) {
      params.departmentId = selectedDeptId.value
    }
    const { data } = await getEmployeesApi(params)
    const records = data?.data || []
    allEmployeesData.value = records.map((u: any) => ({
      id: u.id,
      departmentId: u.departmentId,
      role: u.role,
    }))
  } catch (e) {
    console.error('获取部门员工数据失败', e)
  }
}

// 更新部门员工计数（基于全局全量数据，每个部门计数包含其子部门员工）
const updateDeptMemberCounts = () => {
  const counts: Record<string, number> = {}
  globalEmployeesData.value.forEach((emp: any) => {
    if (emp.departmentId) {
      counts[emp.departmentId] = (counts[emp.departmentId] || 0) + 1
    }
  })
  // 递归计算每个部门的合计人数（含子部门）
  const computeWithChildren = (depts: any[]): Record<string, number> => {
    const result: Record<string, number> = {}
    for (const dept of depts) {
      const selfCount = counts[dept.id] || 0
      let total = selfCount
      if (dept.children && dept.children.length > 0) {
        const childCounts = computeWithChildren(dept.children)
        for (const child of dept.children) {
          total += childCounts[child.id] || 0
        }
        Object.assign(result, childCounts)
      }
      result[dept.id] = total
    }
    return result
  }
  deptMemberCounts.value = computeWithChildren(orgData.value)
}

const fetchEmployees = async () => {
  empLoading.value = true
  try {
    const { data } = await getEmployeesApi({
      page: empPage.value,
      limit: empPageSize.value,
      departmentId: selectedDeptId.value || undefined,
      role: empRoleFilter.value !== 'ALL' ? empRoleFilter.value : undefined,
      search: empSearch.value || undefined,
      includeChildren: true,
    })
    // 后端返回格式经过拦截器处理: { total, page, limit, totalPages, data: [...] }
    const records = data?.data || []
    employeeData.value = records.map((u: any) => ({
      id: u.id,
      username: u.username,
      name: u.name || u.username,
      role: u.role,
      email: u.email,
      department: u.department || null,
      departmentId: u.departmentId,
      enabled: u.enabled,
    }))
    empTotal.value = data?.total || 0
  } catch (e) {
    console.error('获取员工数据失败', e)
    ElMessage.error('获取员工数据失败')
  } finally {
    empLoading.value = false
  }
}

const handleSearchChange = () => {
  empPage.value = 1
  fetchEmployees()
}

const handleRoleFilter = (role: string) => {
  empRoleFilter.value = role
  empPage.value = 1
  fetchEmployees()
}

const toggleSelect = (id: string, selected: boolean) => {
  if (selected) {
    selectedEmployees.value.push(id)
  } else {
    selectedEmployees.value = selectedEmployees.value.filter(i => i !== id)
  }
}

const handleBatchDisable = () => {
  ElMessageBox.confirm(`确认停用选中的 ${selectedEmployees.value.length} 个账号？`, '批量停用', { type: 'warning' })
    .then(async () => {
      batchLoading.value = true
      try {
        await batchUpdateStatusApi(selectedEmployees.value, false)
        ElMessage.success('批量停用成功')
        selectedEmployees.value = []
        fetchEmployees()
        fetchGlobalEmployeesForCount()
        fetchDeptEmployeesForCount()
      } catch (e: any) {
        ElMessage.error(e.response?.data?.message || '操作失败')
      } finally {
        batchLoading.value = false
      }
    }).catch(() => {})
}

const handleBatchDelete = () => {
  ElMessageBox.confirm(`确认删除选中的 ${selectedEmployees.value.length} 个账号？此操作不可恢复！`, '批量删除', { type: 'warning' })
    .then(async () => {
      batchLoading.value = true
      try {
        await batchDeleteEmployeesApi(selectedEmployees.value)
        ElMessage.success('批量删除成功')
        selectedEmployees.value = []
        fetchEmployees()
        fetchGlobalEmployeesForCount()
        fetchDeptEmployeesForCount()
      } catch (e: any) {
        ElMessage.error(e.response?.data?.message || '操作失败')
      } finally {
        batchLoading.value = false
      }
    }).catch(() => {})
}

// 账号表单
const accountDialogVisible = ref(false)
const accountDialogType = ref<'add' | 'edit'>('add')
const accountSubmitting = ref(false)
const accountForm = reactive({
  id: '',
  username: '',
  name: '',
  password: '',
  role: 'USER',
  email: '',
  departmentId: [] as string[], // el-cascader 使用数组
})

const generatePassword = () => {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#'
  let pwd = ''
  for (let i = 0; i < 10; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  accountForm.password = pwd
}

const handleNewAccount = async () => {
  accountDialogType.value = 'add'
  accountForm.id = ''
  accountForm.username = ''
  accountForm.name = ''
  accountForm.password = ''
  accountForm.role = 'USER'
  accountForm.email = ''
  // 确保部门数据已加载
  if (orgData.value.length === 0) {
    await fetchDepartments()
  }
  // el-cascader v-model 需要完整路径数组
  accountForm.departmentId = selectedDeptId.value
    ? (buildDeptPath(orgData.value, selectedDeptId.value) || [])
    : []
  accountDialogVisible.value = true
}

const handleEditEmployee = async (row: any) => {
  accountDialogType.value = 'edit'
  accountForm.id = row.id
  accountForm.username = row.username
  accountForm.name = row.name
  accountForm.password = '' // 清空密码，编辑时由用户决定是否修改
  accountForm.role = row.role
  accountForm.email = row.email || ''
  // 确保部门数据已加载
  if (orgData.value.length === 0) {
    await fetchDepartments()
  }
  // el-cascader v-model 需要完整路径数组
  accountForm.departmentId = row.department?.id
    ? (buildDeptPath(orgData.value, row.department.id) || [])
    : []
  accountDialogVisible.value = true
}

const handleDeleteEmployee = (row: any) => {
  ElMessageBox.confirm(`确认删除账号 "${row.username}" 吗？`, '提示', { type: 'warning' })
    .then(async () => {
      try {
        await deleteEmployeeApi(row.id)
        ElMessage.success('账号已删除')
        fetchEmployees()
        fetchGlobalEmployeesForCount()
        fetchDeptEmployeesForCount()
      } catch (e: any) {
        ElMessage.error(e.response?.data?.message || '删除失败')
      }
    }).catch(() => {})
}

const handleResetPassword = (row: any) => {
  ElMessageBox.confirm(`确认重置账号 "${row.username}" 的密码？`, '重置密码', { type: 'warning' })
    .then(async () => {
      try {
        await resetPasswordApi(row.id)
        ElMessage.success('密码已重置为默认密码: 123456')
      } catch (e: any) {
        ElMessage.error(e.response?.data?.message || '重置失败')
      }
    }).catch(() => {})
}

const submitAccountForm = async () => {
  if (!accountForm.username || !accountForm.name) {
    ElMessage.warning('请填写完整的账号信息')
    return
  }
  // el-cascader 返回路径数组，取最后一个元素作为实际 departmentId
  const deptId = Array.isArray(accountForm.departmentId) && accountForm.departmentId.length > 0
    ? accountForm.departmentId[accountForm.departmentId.length - 1]
    : null

  accountSubmitting.value = true
  try {
    if (accountDialogType.value === 'add') {
      await createEmployeeApi({
        username: accountForm.username,
        password: accountForm.password || undefined,
        name: accountForm.name,
        role: accountForm.role,
        email: accountForm.email || undefined,
        departmentId: deptId || undefined,
      })
      ElMessage.success('账号添加成功')
    } else {
      // 编辑时，如果填写了新密码则更新，否则不更新密码
      const updateData: any = {
        name: accountForm.name,
        role: accountForm.role,
        email: accountForm.email || undefined,
        departmentId: deptId || null,
      }
      // 只有当密码字段有值时才传递密码更新
      if (accountForm.password && accountForm.password.trim()) {
        updateData.password = accountForm.password
      }
      await updateEmployeeApi(accountForm.id, updateData)
      ElMessage.success('账号编辑成功')
    }
    accountDialogVisible.value = false
    fetchEmployees()
    fetchGlobalEmployeesForCount()
    fetchDeptEmployeesForCount()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '操作失败')
  } finally {
    accountSubmitting.value = false
  }
}

// ========== 批量导入 ==========
const showBatchImportDialog = ref(false)
const uploadRef = ref()
const batchImportLoading = ref(false)
const previewData = ref<any[]>([])
const uploadedFile = ref<File | null>(null)

const downloadTemplate = () => {
  // 创建模板数据（支持多级部门）
  const templateData = [
    { '登录账号': 'zhangsan', '真实姓名': '张三', '密码': '123456', '角色': 'USER', '一级部门': '总公司', '二级部门': '研发部', '三级部门': '', '邮箱': 'zhangsan@example.com' },
    { '登录账号': 'lisi', '真实姓名': '李四', '密码': '123456', '角色': 'MANAGER', '一级部门': '总公司', '二级部门': '结构设计部', '三级部门': '', '邮箱': 'lisi@example.com' },
  ]
  const ws = XLSX.utils.json_to_sheet(templateData)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '员工导入模板')
  XLSX.writeFile(wb, '员工导入模板.xlsx')
}

const handleFileChange = (file: any) => {
  // 验证文件大小（最大 10MB）
  const maxSize = 10 * 1024 * 1024
  if (file.size > maxSize) {
    ElMessage.error(`文件大小超过限制（最大 10MB），当前大小：${(file.size / 1024 / 1024).toFixed(2)}MB`)
    uploadRef.value?.clearFiles()
    return
  }
  
  // 验证文件类型
  const fileName = file.name.toLowerCase()
  if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls') && !fileName.endsWith('.csv')) {
    ElMessage.error('仅支持 .xlsx、.xls、.csv 格式的文件')
    uploadRef.value?.clearFiles()
    return
  }
  
  uploadedFile.value = file.raw
  parseExcel(file.raw)
}

const parseExcel = (file: File) => {
  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target?.result as ArrayBuffer)
      const workbook = XLSX.read(data, { type: 'array' })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      const jsonData = XLSX.utils.sheet_to_json(firstSheet)
      
      // 标准化数据（支持多级部门字段）
      previewData.value = jsonData.map((row: any) => ({
        username: row['登录账号'] || row['username'] || '',
        name: row['真实姓名'] || row['name'] || '',
        password: row['密码'] || row['password'] || '',
        role: row['角色'] || row['role'] || 'USER',
        // 新版多级部门字段
        deptLevel1: row['一级部门'] || row['deptLevel1'] || '',
        deptLevel2: row['二级部门'] || row['deptLevel2'] || '',
        deptLevel3: row['三级部门'] || row['deptLevel3'] || '',
        // 兼容旧版单部门字段
        department: row['部门'] || row['department'] || '',
        email: row['邮箱'] || row['email'] || '',
      })).filter((r: any) => r.username && r.name)
    } catch (err) {
      console.error('解析Excel失败', err)
      ElMessage.error('解析Excel文件失败')
    }
  }
  reader.readAsArrayBuffer(file)
}

const handleBatchImport = async () => {
  if (previewData.value.length === 0) {
    ElMessage.warning('请先上传员工数据')
    return
  }
  
  // 过滤无效数据
  const validData = previewData.value.filter(r => r.username && r.name)
  if (validData.length === 0) {
    ElMessage.warning('没有有效的员工数据')
    return
  }

  batchImportLoading.value = true
  try {
    // 收集所有唯一的部门路径（去重）
    const deptPathMap = new Map<string, { level1: string; level2: string; level3: string }>()
    
    validData.forEach(r => {
      const levels = [r.deptLevel1, r.deptLevel2, r.deptLevel3].filter(l => l && l.trim())
      if (levels.length > 0) {
        const pathKey = levels.join('|')
        if (!deptPathMap.has(pathKey)) {
          deptPathMap.set(pathKey, { level1: r.deptLevel1, level2: r.deptLevel2, level3: r.deptLevel3 })
        }
      }
    })
    
    // 预创建不存在的部门（使用后端接口，并行处理所有部门路径）
    if (deptPathMap.size > 0) {
      ElMessage.info(`正在检查/创建 ${deptPathMap.size} 个部门路径...`)
      
      const allCreatedDepts: string[] = []
      const entries = Array.from(deptPathMap.entries())
      const results = await Promise.all(
        entries.map(([, path]) => resolveDepartmentId(path.level1, path.level2, path.level3))
      )
      results.forEach(r => allCreatedDepts.push(...r.createdDepts))
      
      if (allCreatedDepts.length > 0) {
        ElMessage.success(`已自动创建 ${allCreatedDepts.length} 个新部门`)
      }
    }
    
    // 刷新部门树
    await fetchDepartments()
    
    // 角色标准化 + 部门名称转ID
    const employees = validData.map(r => {
      // 将多级部门字段转换为部门ID
      let departmentId: string | undefined = undefined
      const levels = [r.deptLevel1, r.deptLevel2, r.deptLevel3].filter(l => l && l.trim())
      
      if (levels.length > 0) {
        // 使用新的多级部门匹配（已在前一步确保部门存在）
        const matched = findDeptByPath(orgData.value, levels)
        departmentId = matched?.id
      } else if (r.department) {
        // 兼容旧版单部门字段
        departmentId = getDepartmentIdByName(r.department)
      }
      
      return {
        username: r.username,
        name: r.name,
        password: r.password || undefined,
        role: r.role?.toUpperCase() || 'USER',
        departmentId,
        email: r.email || undefined,
      }
    })
    
    const result = await batchCreateEmployeesApi(employees)
    
    // 构建详细的结果消息
    const messages: string[] = []
    if (result.data.successCount > 0) {
      messages.push(`✅ 成功创建 ${result.data.successCount} 个账号`)
    }
    if (result.data.failCount > 0) {
      messages.push(`❌ 有 ${result.data.failCount} 个账号创建失败:`)
      // 显示前10条错误信息
      const errorList = result.data.errors.slice(0, 10).join('\n')
      messages.push(errorList)
      if (result.data.errors.length > 10) {
        messages.push(`... 还有 ${result.data.errors.length - 10} 条错误`)
      }
    }
    
    // 根据结果显示不同的消息类型
    if (result.data.failCount > 0) {
      ElMessageBox.alert(
        messages.join('\n\n'),
        '导入结果',
        {
          confirmButtonText: '确定',
          type: result.data.successCount > 0 ? 'warning' : 'error',
        }
      )
    } else {
      ElMessage.success(messages.join('\n'))
    }
    
    showBatchImportDialog.value = false
    previewData.value = []
    uploadedFile.value = null
    fetchEmployees()
  } catch (e: any) {
    console.error('批量导入失败:', e)
    const errorMsg = e.response?.data?.message || e.response?.data?.error || '批量导入失败'
    ElMessage.error(errorMsg)
  } finally {
    batchImportLoading.value = false
  }
}

// ========== 存储管理 ==========
const storageLoading = ref(false)
const cleanupLoading = ref(false)
const cleanupDays = ref(7)
const storageStats = ref<any>({})

const fetchStorageStats = async () => {
  // 检查登录状态
  const userStore = useUserStore()
  if (!userStore.token) {
    console.warn('未登录，跳过存储统计')
    return
  }

  storageLoading.value = true
  try {
    const { data } = await getStorageStatsApi()
    const stats = data || {}
    storageStats.value = {
      ...stats,
      // 计算百分比
      referencedPercent: stats.totalSize > 0
        ? ((stats.referencedSize / stats.totalSize) * 100).toFixed(1) + '%'
        : '0%',
      orphanedPercent: stats.totalSize > 0
        ? ((stats.orphanedSize / stats.totalSize) * 100).toFixed(1) + '%'
        : '0%',
    }
  } catch (e: any) {
    console.error('获取存储统计失败', e)
    // 不在这里弹错误提示，避免 401 时重复跳转登录页
    if (e.response?.status !== 401) {
      ElMessage.error('获取存储统计失败')
    }
  } finally {
    storageLoading.value = false
  }
}

const handleCleanup = async () => {
  if (storageStats.value.orphanedFiles <= 0) {
    ElMessage.warning('暂无孤立文件需要清理')
    return
  }

  try {
    await ElMessageBox.confirm(
      `确认清理 ${cleanupDays.value} 天前的孤立文件吗？这将释放约 ${storageStats.value.orphanedSizeMB} MB 空间。`,
      '清理确认',
      { type: 'warning' }
    )
  } catch {
    return
  }

  cleanupLoading.value = true
  try {
    const { data } = await cleanupFilesApi(cleanupDays.value)
    ElMessage.success(`清理完成：删除了 ${data.deleted} 个文件，释放了 ${(data.freedSpace / 1024 / 1024).toFixed(2)} MB 空间`)
    // 刷新统计
    fetchStorageStats()
  } catch (e: any) {
    ElMessage.error(e.response?.data?.message || '清理失败')
  } finally {
    cleanupLoading.value = false
  }
}

// 点击空白处关闭右键菜单
const handleClickOutside = (e: MouseEvent) => {
  if (contextMenuVisible.value) {
    hideContextMenu()
  }
}

onMounted(() => {
  fetchDepartments()
  fetchGlobalEmployeesForCount() // 获取全局数据用于部门树计数
  fetchDeptEmployeesForCount() // 获取角色统计数据
  fetchEmployees()
  fetchStorageStats()
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.system-management {
  padding: 20px;
  height: calc(100vh - 80px);
  overflow-y: auto;
}

/* 顶部标题栏 */
.page-header {
  margin-bottom: 20px;
}

.page-header h2 {
  font-size: 20px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin: 0;
}

/* 导航卡片 */
.nav-cards {
  display: flex;
  gap: 16px;
  margin-bottom: 20px;
}

.nav-card {
  flex: 1;
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  padding: 16px 20px;
  cursor: pointer;
  transition: all 0.2s;
}

.nav-card:hover {
  border-color: var(--corp-primary);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
}

.nav-card.active {
  border-color: var(--corp-primary);
  background: linear-gradient(135deg, rgba(64, 158, 255, 0.05), rgba(64, 158, 255, 0.02));
}

.nav-icon {
  font-size: 28px;
  margin-bottom: 8px;
}

.nav-label {
  font-size: 15px;
  font-weight: 600;
  color: var(--corp-text-primary);
  margin-bottom: 4px;
}

.nav-desc {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

/* Tab 导航 */
.nav-tabs {
  display: flex;
  gap: 8px;
  padding: 0 24px 16px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  margin-bottom: 0;
}

.nav-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  color: var(--el-text-color-secondary);
  transition: all 0.2s;
}

.nav-tab:hover {
  background: var(--el-fill-color-light);
  color: var(--el-text-color-primary);
}

.nav-tab.active {
  background: var(--el-color-primary-light-9);
  color: var(--el-color-primary);
  font-weight: 500;
}

.tab-icon {
  font-size: 16px;
}

.tab-label {
  font-size: 14px;
}

/* 内容区域 */
.content-area {
  min-height: calc(100% - 160px);
}

/* 部门布局 */
.dept-layout {
  display: flex;
  gap: 20px;
  height: calc(100vh - 220px);
}

.dept-tree-card {
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.dept-employees-card {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.dept-tree-container {
  flex: 1;
  overflow-y: auto;
  position: relative;
}

.dept-node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding-right: 8px;
  font-size: 15px; /* 增大字体 */
}

.dept-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
  font-size: 15px;
}

.dept-icon {
  color: #f59e0b;
  font-size: 16px;
}

.dept-count {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  padding: 2px 10px;
  border-radius: 10px;
}

/* 右键菜单 */
.context-menu {
  position: fixed;
  background: #fff;
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 6px 0;
  z-index: 9999;
  min-width: 140px;
}

.context-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.context-item:hover {
  background: var(--el-fill-color-light);
}

.context-item.danger {
  color: var(--el-color-danger);
}

/* 员工工具栏 */
.employee-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.toolbar-right {
  display: flex;
  gap: 10px;
}

/* 角色筛选 */
.role-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  padding-bottom: 8px;
}

.role-tab {
  padding: 6px 14px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.15s;
}

.role-tab:hover {
  color: var(--corp-primary);
  background: rgba(64, 158, 255, 0.06);
}

.role-tab.active {
  color: var(--corp-primary);
  background: rgba(64, 158, 255, 0.1);
  font-weight: 500;
}

/* 批量操作栏 */
.batch-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: rgba(64, 158, 255, 0.06);
  border-radius: 8px;
  margin-bottom: 12px;
}

.selected-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--corp-primary);
}

/* 员工卡片列表 */
.employee-list {
  flex: 1;
  overflow-y: auto;
}

.employee-card {
  display: flex;
  align-items: center;
  padding: 14px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  transition: background 0.15s;
}

.employee-card:hover {
  background: var(--el-fill-color-light);
}

.employee-card.selected {
  background: rgba(64, 158, 255, 0.06);
}

.card-left {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-right: 14px;
}

/* 头像 */
.avatar-circle {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
  flex-shrink: 0;
}

.avatar-admin   { background: #ef4444; }
.avatar-manager { background: #f59e0b; }
.avatar-user    { background: #3b82f6; }

.card-info {
  flex: 1;
  min-width: 0;
}

.info-main {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}

.emp-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--corp-text-primary);
}

.role-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
}

.role-badge-admin   { background: #fef2f2; color: #dc2626; }
.role-badge-manager { background: #fffbeb; color: #d97706; }
.role-badge-user    { background: #eff6ff; color: #2563eb; }

.role-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.role-badge-admin .role-dot   { background: #dc2626; }
.role-badge-manager .role-dot { background: #d97706; }
.role-badge-user .role-dot    { background: #2563eb; }

.emp-dept {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.info-sub {
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}

.card-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.card-actions .el-button {
  font-size: 13px;
  padding: 6px 8px;
}

/* 分页 */
.pagination-container {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
}

/* 角色卡片选择 */
.role-card-group {
  display: flex;
  gap: 10px;
}

.role-card {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: 1.5px solid var(--el-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
  font-size: 13px;
  font-weight: 500;
}

.role-card:hover {
  border-color: var(--el-border-color-dark);
}

.role-card-active {
  border-color: var(--corp-primary);
  background: rgba(64, 158, 255, 0.06);
  color: var(--corp-primary);
}

.role-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.role-dot-admin   { background: #ef4444; }
.role-dot-manager { background: #f59e0b; }
.role-dot-user    { background: #3b82f6; }

/* 批量导入 */
.batch-import-content {
  padding: 0 4px;
}

.template-section {
  margin-bottom: 16px;
}

.preview-section {
  margin-top: 16px;
}

.preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  font-size: 13px;
  font-weight: 500;
  color: var(--corp-text-primary);
}

.upload-section {
  margin-top: 16px;
}

.excel-uploader {
  width: 100%;
}

:deep(.el-upload-dragger) {
  padding: 40px 20px;
}

.upload-icon {
  font-size: 48px;
  color: var(--el-text-color-secondary);
  margin-bottom: 16px;
}

.upload-text {
  color: var(--el-text-color-secondary);
}

.upload-text em {
  color: var(--corp-primary);
  font-style: normal;
  cursor: pointer;
}

.upload-tip {
  display: block;
  font-size: 12px;
  margin-top: 8px;
  color: var(--el-text-color-disabled);
}

/* 空状态 */
.empty-state {
  padding: 60px 0;
  text-align: center;
}

/* 存储管理样式 */
.storage-panel {
  max-width: 900px;
}

/* 存储概览 */
.storage-overview {
  display: flex;
  align-items: center;
  gap: 32px;
  padding: 24px;
  margin-bottom: 20px;
  background: linear-gradient(135deg, rgba(64, 158, 255, 0.06), rgba(64, 158, 255, 0.02));
  border: 1px solid rgba(64, 158, 255, 0.1);
  border-radius: 12px;
}

.storage-total {
  text-align: center;
  min-width: 120px;
}

.total-main {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 4px;
}

.total-icon {
  font-size: 20px;
  color: #409eff;
  margin-right: 4px;
}

.total-value {
  font-size: 36px;
  font-weight: 700;
  color: var(--corp-primary, #2563eb);
  line-height: 1;
}

.total-unit {
  font-size: 16px;
  font-weight: 500;
  color: var(--el-text-color-secondary);
}

.total-label {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  margin-top: 4px;
}

/* 存储进度条 */
.storage-progress {
  flex: 1;
}

.progress-bar {
  height: 12px;
  background: var(--el-fill-color-light);
  border-radius: 6px;
  overflow: hidden;
  display: flex;
}

.progress-used {
  background: linear-gradient(90deg, #67c23a, #85ce61);
  transition: width 0.3s ease;
}

.progress-orphaned {
  background: linear-gradient(90deg, #e6a23c, #f5c76a);
  transition: width 0.3s ease;
}

.progress-legend {
  display: flex;
  gap: 24px;
  margin-top: 8px;
  font-size: 12px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--el-text-color-secondary);
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}

.legend-item.referenced .legend-dot {
  background: #67c23a;
}

.legend-item.orphaned .legend-dot {
  background: #e6a23c;
}

/* 统计卡片 */
.storage-stats {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.stat-card {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  border-radius: 10px;
  background: var(--el-fill-color-light);
  border: 1px solid var(--el-border-color-lighter);
}

.stat-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.referenced-icon {
  background: rgba(103, 194, 58, 0.1);
  color: #67c23a;
}

.orphaned-icon {
  background: rgba(230, 162, 60, 0.1);
  color: #e6a23c;
}

.stat-card.has-orphaned {
  border-color: rgba(230, 162, 60, 0.3);
  background: rgba(230, 162, 60, 0.04);
}

.stat-info {
  flex: 1;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--corp-text-primary);
  line-height: 1.2;
}

.stat-label {
  font-size: 12px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

.stat-count {
  font-size: 11px;
  color: var(--el-text-color-secondary);
  margin-top: 2px;
}

/* 清理区域 */
.cleanup-section {
  margin-top: 16px;
}

.cleanup-actions {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.no-orphaned {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 24px;
  color: var(--el-text-color-secondary);
  font-size: 14px;
}

/* 过渡动画 */
.slide-fade-enter-active {
  transition: all 0.3s ease-out;
}

.slide-fade-leave-active {
  transition: all 0.2s ease-in;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateY(-10px);
  opacity: 0;
}

/* el-card body */
:deep(.el-card__body) {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
