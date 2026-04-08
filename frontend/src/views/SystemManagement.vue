<template>
  <div class="system-management-container">
    <!-- 左侧组织架构树 -->
    <el-card class="org-tree-panel" shadow="never">
      <template #header>
        <div class="panel-header">
          <span>组织架构</span>
          <el-button type="primary" link @click="handleAddRootDept">添加部门</el-button>
        </div>
      </template>
      <el-tree
        :data="orgData"
        node-key="id"
        default-expand-all
        :expand-on-click-node="false"
        @node-click="handleNodeClick"
        highlight-current
      >
        <template #default="{ node, data }">
          <div class="custom-tree-node">
            <span>{{ node.label }}</span>
            <span class="node-actions">
              <el-button link type="primary" size="small" @click.stop="handleAddDept(data)">
                添加
              </el-button>
              <el-button link type="primary" size="small" @click.stop="handleEditDept(node, data)">
                编辑
              </el-button>
              <el-button link type="danger" size="small" @click.stop="handleDeleteDept(node, data)">
                删除
              </el-button>
            </span>
          </div>
        </template>
      </el-tree>
    </el-card>

    <!-- 右侧员工列表 -->
    <el-card class="employee-list-panel" shadow="never">
      <template #header>
        <div class="panel-header">
          <span>{{ selectedDeptLabel ? `${selectedDeptLabel} - 员工列表` : '所有员工列表' }}</span>
          <el-button type="primary" @click="handleNewAccount">新建账号</el-button>
        </div>
      </template>
      <el-table :data="filteredEmployees" style="width: 100%" v-loading="loading" stripe border>
        <el-table-column prop="username" label="登录账号" />
        <el-table-column prop="realName" label="姓名" />
        <el-table-column prop="role" label="角色">
          <template #default="{ row }">
            <el-tag :type="getRoleTagType(row.role)">{{ getRoleLabel(row.role) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="departmentId" label="所属部门">
          <template #default="{ row }">
            {{ getDeptLabel(row.departmentId) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态">
          <template #default="{ row }">
            <el-switch
              v-model="row.status"
              :active-value="1"
              :inactive-value="0"
              @change="handleStatusChange(row)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="handleEditEmployee(row)">编辑</el-button>
            <el-button link type="danger" @click="handleDeleteEmployee(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 部门弹窗 -->
    <el-dialog
      v-model="deptDialogVisible"
      :title="deptDialogType === 'add' ? '添加部门' : '编辑部门'"
      width="400px"
    >
      <el-form :model="deptForm" label-width="80px">
        <el-form-item label="部门名称" required>
          <el-input v-model="deptForm.label" placeholder="请输入部门名称" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="deptDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitDeptForm">确定</el-button>
        </span>
      </template>
    </el-dialog>

    <!-- 账号弹窗 -->
    <el-dialog
      v-model="accountDialogVisible"
      :title="accountDialogType === 'add' ? '新建账号' : '编辑账号'"
      width="500px"
    >
      <el-form :model="accountForm" label-width="100px">
        <el-form-item label="登录账号" required>
          <el-input v-model="accountForm.username" placeholder="请输入登录账号" :disabled="accountDialogType === 'edit'" />
        </el-form-item>
        <el-form-item label="真实姓名" required>
          <el-input v-model="accountForm.realName" placeholder="请输入真实姓名" />
        </el-form-item>
        <el-form-item label="分配角色" required>
          <el-select v-model="accountForm.role" placeholder="请选择角色" style="width: 100%">
            <el-option label="管理员" value="admin" />
            <el-option label="部门主管" value="manager" />
            <el-option label="普通员工" value="employee" />
          </el-select>
        </el-form-item>
        <el-form-item label="所属部门" required>
          <el-tree-select
            v-model="accountForm.departmentId"
            :data="orgData"
            node-key="id"
            :props="{ label: 'label', value: 'id' }"
            check-strictly
            :render-after-expand="false"
            placeholder="请选择部门"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="账号状态">
          <el-switch v-model="accountForm.status" :active-value="1" :inactive-value="0" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="accountDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="submitAccountForm">确定</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'

interface Department {
  id: string
  label: string
  children?: Department[]
}

interface Employee {
  id: string
  username: string
  realName: string
  role: 'admin' | 'manager' | 'employee'
  departmentId: string
  status: 1 | 0
}

// Mock Data for Departments
const mockDepartments: Department[] = [
  {
    id: 'd1',
    label: '总公司',
    children: [
      {
        id: 'd1-1',
        label: '研发部',
        children: [
          { id: 'd1-1-1', label: '前端组' },
          { id: 'd1-1-2', label: '后端组' }
        ]
      },
      {
        id: 'd1-2',
        label: '产品部'
      },
      {
        id: 'd1-3',
        label: '设计部'
      }
    ]
  }
]

// Mock Data for Employees
const mockEmployees: Employee[] = [
  { id: 'u1', username: 'admin', realName: '超级管理员', role: 'admin', departmentId: 'd1', status: 1 },
  { id: 'u2', username: 'zhangsan', realName: '张三', role: 'manager', departmentId: 'd1-1', status: 1 },
  { id: 'u3', username: 'lisi', realName: '李四', role: 'employee', departmentId: 'd1-1-1', status: 1 },
  { id: 'u4', username: 'wangwu', realName: '王五', role: 'employee', departmentId: 'd1-1-2', status: 0 },
  { id: 'u5', username: 'zhaoliu', realName: '赵六', role: 'manager', departmentId: 'd1-2', status: 1 },
]

const orgData = ref<Department[]>([])
const employeeData = ref<Employee[]>([])
const selectedDeptId = ref<string | null>(null)
const selectedDeptLabel = ref<string>('')
const loading = ref(false)

onMounted(() => {
  loading.value = true
  setTimeout(() => {
    orgData.value = JSON.parse(JSON.stringify(mockDepartments))
    employeeData.value = JSON.parse(JSON.stringify(mockEmployees))
    loading.value = false
  }, 500)
})

// === Department Management ===
const deptDialogVisible = ref(false)
const deptForm = reactive({
  id: '',
  label: '',
  parentId: ''
})
const deptDialogType = ref<'add' | 'edit'>('add')

const flatDepartments = computed(() => {
  const result: { id: string, label: string }[] = []
  const traverse = (nodes: Department[]) => {
    nodes.forEach(node => {
      result.push({ id: node.id, label: node.label })
      if (node.children) traverse(node.children)
    })
  }
  traverse(orgData.value)
  return result
})

const getDeptLabel = (id: string) => {
  const dept = flatDepartments.value.find(d => d.id === id)
  return dept ? dept.label : '未知部门'
}

const handleNodeClick = (data: Department) => {
  if (selectedDeptId.value === data.id) {
    // deselect
    selectedDeptId.value = null
    selectedDeptLabel.value = ''
    return
  }
  selectedDeptId.value = data.id
  selectedDeptLabel.value = data.label
}

const handleAddRootDept = () => {
  deptDialogType.value = 'add'
  deptForm.id = ''
  deptForm.label = ''
  deptForm.parentId = ''
  deptDialogVisible.value = true
}

const handleAddDept = (data: Department) => {
  deptDialogType.value = 'add'
  deptForm.id = ''
  deptForm.label = ''
  deptForm.parentId = data.id
  deptDialogVisible.value = true
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleEditDept = (_node: any, data: Department) => {
  deptDialogType.value = 'edit'
  deptForm.id = data.id
  deptForm.label = data.label
  deptDialogVisible.value = true
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const handleDeleteDept = (_node: any, data: Department) => {
  ElMessageBox.confirm(`确认删除部门 "${data.label}" 吗？此操作不可恢复。`, '提示', {
    type: 'warning'
  }).then(() => {
    const removeNode = (nodes: Department[], id: string) => {
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].id === id) {
          nodes.splice(i, 1)
          return true
        }
        if (nodes[i].children && removeNode(nodes[i].children!, id)) {
          return true
        }
      }
      return false
    }
    removeNode(orgData.value, data.id)
    if (selectedDeptId.value === data.id) {
      selectedDeptId.value = null
      selectedDeptLabel.value = ''
    }
    ElMessage.success('部门已删除')
  }).catch(() => {})
}

const submitDeptForm = () => {
  if (!deptForm.label.trim()) {
    ElMessage.warning('请输入部门名称')
    return
  }

  if (deptDialogType.value === 'add') {
    const newNode: Department = {
      id: `d-${Date.now()}`,
      label: deptForm.label.trim()
    }
    if (deptForm.parentId) {
      const appendNode = (nodes: Department[], pId: string) => {
        for (const node of nodes) {
          if (node.id === pId) {
            if (!node.children) node.children = []
            node.children.push(newNode)
            return true
          }
          if (node.children && appendNode(node.children, pId)) return true
        }
        return false
      }
      appendNode(orgData.value, deptForm.parentId)
    } else {
      orgData.value.push(newNode)
    }
    ElMessage.success('部门添加成功')
  } else {
    const editNode = (nodes: Department[], id: string) => {
      for (const node of nodes) {
        if (node.id === id) {
          node.label = deptForm.label.trim()
          return true
        }
        if (node.children && editNode(node.children, id)) return true
      }
      return false
    }
    editNode(orgData.value, deptForm.id)
    ElMessage.success('部门编辑成功')
  }
  deptDialogVisible.value = false
}

// === Employee Management ===
const filteredEmployees = computed(() => {
  if (!selectedDeptId.value) return employeeData.value
  
  const getSubDeptIds = (nodes: Department[], targetId: string, found = false): string[] => {
    let ids: string[] = []
    for (const node of nodes) {
      if (node.id === targetId || found) {
        ids.push(node.id)
        if (node.children) {
          ids = ids.concat(getSubDeptIds(node.children, '', true))
        }
        if (!found) return ids 
      } else if (node.children) {
        const subIds = getSubDeptIds(node.children, targetId)
        if (subIds.length > 0) return subIds
      }
    }
    return ids
  }

  const validDeptIds = getSubDeptIds(orgData.value, selectedDeptId.value)
  return employeeData.value.filter(emp => validDeptIds.includes(emp.departmentId))
})

const getRoleLabel = (role: string) => {
  const map: Record<string, string> = {
    admin: '管理员',
    manager: '部门主管',
    employee: '普通员工'
  }
  return map[role] || role
}

const getRoleTagType = (role: string) => {
  const map: Record<string, 'danger' | 'warning' | 'info' | 'primary' | 'success'> = {
    admin: 'danger',
    manager: 'warning',
    employee: 'info'
  }
  return map[role] || 'info'
}

const handleStatusChange = (row: Employee) => {
  ElMessage.success(`用户 ${row.username} 状态已更新为 ${row.status === 1 ? '启用' : '禁用'}`)
}

// Account Dialog
const accountDialogVisible = ref(false)
const accountForm = reactive<Omit<Employee, 'id'> & { id?: string }>({
  username: '',
  realName: '',
  role: 'employee',
  departmentId: '',
  status: 1
})
const accountDialogType = ref<'add' | 'edit'>('add')

const handleNewAccount = () => {
  accountDialogType.value = 'add'
  accountForm.id = undefined
  accountForm.username = ''
  accountForm.realName = ''
  accountForm.role = 'employee'
  accountForm.departmentId = selectedDeptId.value || ''
  accountForm.status = 1
  accountDialogVisible.value = true
}

const handleEditEmployee = (row: Employee) => {
  accountDialogType.value = 'edit'
  accountForm.id = row.id
  accountForm.username = row.username
  accountForm.realName = row.realName
  accountForm.role = row.role
  accountForm.departmentId = row.departmentId
  accountForm.status = row.status
  accountDialogVisible.value = true
}

const handleDeleteEmployee = (row: Employee) => {
  ElMessageBox.confirm(`确认删除账号 "${row.username}" 吗？此操作不可恢复。`, '提示', {
    type: 'warning'
  }).then(() => {
    employeeData.value = employeeData.value.filter(e => e.id !== row.id)
    ElMessage.success('账号已删除')
  }).catch(() => {})
}

const submitAccountForm = () => {
  if (!accountForm.username || !accountForm.realName || !accountForm.departmentId) {
    ElMessage.warning('请填写完整的账号信息')
    return
  }

  if (accountDialogType.value === 'add') {
    employeeData.value.push({
      ...accountForm,
      id: `u-${Date.now()}`
    } as Employee)
    ElMessage.success('账号添加成功')
  } else {
    const index = employeeData.value.findIndex(e => e.id === accountForm.id)
    if (index > -1) {
      employeeData.value[index] = { ...accountForm } as Employee
      ElMessage.success('账号编辑成功')
    }
  }
  accountDialogVisible.value = false
}
</script>

<style scoped>
.system-management-container {
  display: flex;
  gap: 20px;
  height: calc(100vh - 100px); /* Adjust based on layout */
}

.org-tree-panel {
  width: 320px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
}

.employee-list-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: bold;
}

.custom-tree-node {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
  padding-right: 8px;
}

.node-actions {
  display: none;
}

.el-tree-node__content:hover .node-actions {
  display: inline-block;
}

:deep(.el-card__body) {
  flex: 1;
  overflow: auto;
  padding: 16px;
}
</style>
