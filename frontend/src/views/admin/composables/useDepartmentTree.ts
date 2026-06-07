/**
 * 部门树管理相关逻辑
 * 从 DepartmentManagement.vue 提取
 */
import { ref, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getDepartmentsTreeApi, createDepartmentApi, updateDepartmentApi, deleteDepartmentApi,
} from '@/api/system'

export function useDepartmentTree() {
  const orgData = ref<any[]>([])
  const deptTreeRef = ref()
  const deptTreeLoading = ref(false)
  const selectedDeptId = ref<string | null>(null)
  const selectedDeptName = ref('')
  const contextMenuVisible = ref(false)
  const contextMenuX = ref(0)
  const contextMenuY = ref(0)
  const contextMenuDept = ref<any>(null)

  const deptDialogVisible = ref(false)
  const deptDialogType = ref<'add' | 'edit'>('add')
  const deptSubmitting = ref(false)
  const deptParentId = ref('')
  const deptForm = reactive({ id: '', name: '', parentId: [] as string[] })

  // ===== 部门树工具函数 =====
  const getSubDeptIds = (dept: any): string[] => {
    const ids = [dept.id]
    if (dept.children) dept.children.forEach((child: any) => ids.push(...getSubDeptIds(child)))
    return ids
  }

  const findDeptNode = (tree: any[], deptId: string): any => {
    for (const node of tree) {
      if (node.id === deptId) return node
      if (node.children) { const found = findDeptNode(node.children, deptId); if (found) return found }
    }
    return null
  }

  const buildDeptPath = (tree: any[], targetId: string, path: string[] = []): string[] | null => {
    for (const node of tree) {
      const currentPath = [...path, node.id]
      if (node.id === targetId) return currentPath
      if (node.children) { const found = buildDeptPath(node.children, targetId, currentPath); if (found) return found }
    }
    return null
  }

  const buildDeptNameToIdMap = (depts: any[], parentPath = ''): Map<string, string> => {
    const map = new Map<string, string>()
    for (const dept of depts) {
      const fullPath = parentPath ? `${parentPath}/${dept.name}` : dept.name
      map.set(dept.name, dept.id)
      map.set(fullPath, dept.id)
      if (dept.children && dept.children.length > 0) {
        const childMap = buildDeptNameToIdMap(dept.children, fullPath)
        childMap.forEach((value, key) => map.set(key, value))
      }
    }
    return map
  }

  const getDepartmentIdByName = (deptName: string): string | undefined => {
    if (!deptName || !orgData.value || orgData.value.length === 0) return undefined
    const nameToIdMap = buildDeptNameToIdMap(orgData.value)
    if (nameToIdMap.has(deptName)) return nameToIdMap.get(deptName)
    const trimmedName = deptName.trim()
    if (nameToIdMap.has(trimmedName)) return nameToIdMap.get(trimmedName)
    for (const [name, id] of nameToIdMap.entries()) {
      if (name.includes(trimmedName) || trimmedName.includes(name)) {
        console.warn(`部门名称 "${deptName}" 模糊匹配到 "${name}"`)
        return id
      }
    }
    console.warn(`未找到部门: "${deptName}"`)
    return undefined
  }

  const findDeptByPath = (depts: any[], path: string[]): any | undefined => {
    if (path.length === 0) return undefined
    const [current, ...rest] = path
    const found = depts.find((d: any) => d.name === current)
    if (!found) return undefined
    if (rest.length === 0) return found
    return findDeptByPath(found.children || [], rest)
  }

  // ===== API 调用 =====
  const fetchDepartments = async () => {
    deptTreeLoading.value = true
    try {
      const res = await getDepartmentsTreeApi()
      orgData.value = res.data || []
    } catch (e) { console.error('获取部门数据失败', e); ElMessage.error('获取部门数据失败') }
    finally { deptTreeLoading.value = false }
  }

  // ===== 事件处理 =====
  const handleDeptContextMenu = (e: MouseEvent, data: any) => {
    e.preventDefault()
    contextMenuDept.value = data
    contextMenuX.value = e.clientX
    contextMenuY.value = e.clientY
    contextMenuVisible.value = true
  }

  const hideContextMenu = () => { contextMenuVisible.value = false }

  const handleDeptNodeClick = (data: any, onSelect?: () => void) => {
    if (selectedDeptId.value === data.id) {
      selectedDeptId.value = null; selectedDeptName.value = ''
    } else {
      selectedDeptId.value = data.id; selectedDeptName.value = data.name
    }
    onSelect?.()
  }

  const handleAddRootDept = () => {
    deptParentId.value = ''; deptDialogType.value = 'add'
    deptForm.name = ''; deptForm.parentId = []
    deptDialogVisible.value = true
  }

  const handleAddChildDept = () => {
    hideContextMenu(); if (!contextMenuDept.value) return
    deptParentId.value = contextMenuDept.value.id; deptDialogType.value = 'add'
    deptForm.name = ''
    deptForm.parentId = buildDeptPath(orgData.value, contextMenuDept.value.id) || []
    deptDialogVisible.value = true
  }

  const handleEditDept = () => {
    hideContextMenu(); if (!contextMenuDept.value) return
    deptDialogType.value = 'edit'; deptForm.id = contextMenuDept.value.id; deptForm.name = contextMenuDept.value.name
    deptForm.parentId = contextMenuDept.value.parentId ? (buildDeptPath(orgData.value, contextMenuDept.value.parentId) || []) : []
    deptDialogVisible.value = true
  }

  const handleDeleteDept = async (onDeleted?: () => void) => {
    hideContextMenu(); if (!contextMenuDept.value) return
    try {
      await ElMessageBox.confirm(`确认删除部门 "${contextMenuDept.value.name}" 吗？删除后该部门下的员工将变为未分配状态。`, '删除确认', { type: 'warning' })
      try {
        await deleteDepartmentApi(contextMenuDept.value.id); ElMessage.success('部门已删除')
        if (selectedDeptId.value === contextMenuDept.value.id) { selectedDeptId.value = null; selectedDeptName.value = '' }
        fetchDepartments()
        onDeleted?.()
      } catch (e: any) { ElMessage.error(e.response?.data?.message || '删除失败') }
    } catch { /* cancelled */ }
  }

  const submitDeptForm = async (onSuccess?: () => void) => {
    if (!deptForm.name.trim()) { ElMessage.warning('请输入部门名称'); return }
    const parentDeptId = Array.isArray(deptForm.parentId) && deptForm.parentId.length > 0 ? deptForm.parentId[deptForm.parentId.length - 1] : undefined
    deptSubmitting.value = true
    try {
      if (deptDialogType.value === 'add') { await createDepartmentApi({ name: deptForm.name, parentId: parentDeptId || undefined }); ElMessage.success('部门添加成功') }
      else { await updateDepartmentApi(deptForm.id, { name: deptForm.name }); ElMessage.success('部门编辑成功') }
      deptDialogVisible.value = false; fetchDepartments(); onSuccess?.()
    } catch (e: any) { ElMessage.error(e.response?.data?.message || '操作失败') }
    finally { deptSubmitting.value = false }
  }

  return {
    orgData, deptTreeRef, deptTreeLoading,
    selectedDeptId, selectedDeptName,
    contextMenuVisible, contextMenuX, contextMenuY, contextMenuDept,
    deptDialogVisible, deptDialogType, deptSubmitting, deptParentId, deptForm,
    fetchDepartments,
    handleDeptContextMenu, hideContextMenu, handleDeptNodeClick,
    handleAddRootDept, handleAddChildDept, handleEditDept, handleDeleteDept, submitDeptForm,
    getSubDeptIds, findDeptNode, buildDeptPath, getDepartmentIdByName, findDeptByPath, buildDeptNameToIdMap,
  }
}
