/**
 * 员工列表管理相关逻辑
 * 从 DepartmentManagement.vue 提取
 */
import { ref, computed, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  getEmployeesApi, createEmployeeApi, updateEmployeeApi,
  deleteEmployeeApi, batchUpdateStatusApi, batchDeleteEmployeesApi, resetPasswordApi,
} from '@/api/system'

export const roleOptions = [
  { value: 'ADMIN', label: '管理员', cls: 'admin' },
  { value: 'MANAGER', label: '二级管理员', cls: 'manager' },
  { value: 'USER', label: '普通员工', cls: 'user' },
]

export function useEmployeeList(selectedDeptId: Ref<string | null>, orgData: Ref<any[]>, buildDeptPath: (tree: any[], targetId: string) => string[] | null) {
  const employeeData = ref<any[]>([])
  const allEmployeesData = ref<any[]>([])
  const globalEmployeesData = ref<any[]>([])
  const empLoading = ref(false)
  const empPage = ref(1)
  const empPageSize = ref(10)
  const empTotal = ref(0)
  const empSearch = ref('')
  const empRoleFilter = ref('ALL')
  const selectedEmployees = ref<string[]>([])
  const batchLoading = ref(false)
  const deptMemberCounts = ref<Record<string, number>>({})

  // ===== 账号表单 =====
  const accountDialogVisible = ref(false)
  const accountDialogType = ref<'add' | 'edit'>('add')
  const accountSubmitting = ref(false)
  const accountForm = reactive({ id: '', username: '', name: '', password: '', role: 'USER', email: '', departmentId: [] as string[] })

  const PASSWORD_COMPLEXITY_DESC = '密码须包含大写字母、小写字母、数字、特殊符号，至少8位'

  // ===== Computed =====
  const roleTabs = computed(() => {
    const all = allEmployeesData.value
    return [
      { label: '全部', value: 'ALL', count: all.length },
      { label: '管理员', value: 'ADMIN', count: all.filter((e: any) => e.role === 'ADMIN').length },
      { label: '二级管理员', value: 'MANAGER', count: all.filter((e: any) => e.role === 'MANAGER').length },
      { label: '普通员工', value: 'USER', count: all.filter((e: any) => e.role === 'USER').length },
    ]
  })

  const filteredEmployees = computed(() => employeeData.value)

  const isAllSelected = computed(() => {
    if (filteredEmployees.value.length === 0) return false
    return filteredEmployees.value.every((emp: any) => selectedEmployees.value.includes(emp.id))
  })

  const isIndeterminate = computed(() => {
    if (filteredEmployees.value.length === 0) return false
    const someSelected = filteredEmployees.value.some((emp: any) => selectedEmployees.value.includes(emp.id))
    return someSelected && !isAllSelected.value
  })

  // ===== 工具函数 =====
  const getAvatarClass = (role: string) => { const map: Record<string, string> = { ADMIN: 'admin', MANAGER: 'manager', USER: 'user' }; return map[role] || 'user' }
  const getAvatarLetter = (emp: any) => (emp.name || emp.username || '?').charAt(0).toUpperCase()
  const getRoleLabel = (role: string) => { const map: Record<string, string> = { ADMIN: '管理员', MANAGER: '二级管理员', USER: '普通员工' }; return map[role] || role }

  const getDeptMemberCount = (deptId: string) => deptMemberCounts.value[deptId] || 0

  const updateDeptMemberCounts = () => {
    const counts: Record<string, number> = {}
    globalEmployeesData.value.forEach((emp: any) => {
      if (emp.departmentId) counts[emp.departmentId] = (counts[emp.departmentId] || 0) + 1
    })
    const computeWithChildren = (depts: any[]): Record<string, number> => {
      const result: Record<string, number> = {}
      for (const dept of depts) {
        const selfCount = counts[dept.id] || 0
        let total = selfCount
        if (dept.children && dept.children.length > 0) {
          const childCounts = computeWithChildren(dept.children)
          for (const child of dept.children) total += childCounts[child.id] || 0
          Object.assign(result, childCounts)
        }
        result[dept.id] = total
      }
      return result
    }
    deptMemberCounts.value = computeWithChildren(orgData.value)
  }

  const validatePwdComplexity = (pwd: string): string | null => {
    if (!pwd || pwd.length < 8) return '密码长度不能小于8位'
    if (!/[A-Z]/.test(pwd)) return '密码缺少大写字母'
    if (!/[a-z]/.test(pwd)) return '密码缺少小写字母'
    if (!/[0-9]/.test(pwd)) return '密码缺少数字'
    if (!/[!@#$%^&*()_+\-=\[\]{}|;':",./<>?~`\\]/.test(pwd)) return '密码缺少特殊符号'
    return null
  }

  const generatePassword = () => {
    const upper = 'ABCDEFGHJKMNPQRSTUVWXYZ'
    const lower = 'abcdefghjkmnpqrstuvwxyz'
    const digits = '23456789'
    const specials = '!@#$%^&*'
    const all = upper + lower + digits + specials
    let pwd = ''
    pwd += upper.charAt(Math.floor(Math.random() * upper.length))
    pwd += lower.charAt(Math.floor(Math.random() * lower.length))
    pwd += digits.charAt(Math.floor(Math.random() * digits.length))
    pwd += specials.charAt(Math.floor(Math.random() * specials.length))
    for (let i = 4; i < 10; i++) {
      pwd += all.charAt(Math.floor(Math.random() * all.length))
    }
    pwd = pwd.split('').sort(() => Math.random() - 0.5).join('')
    accountForm.password = pwd
  }

  // ===== API 调用 =====
  const fetchGlobalEmployeesForCount = async () => {
    try {
      const { data } = await getEmployeesApi({ page: 1, limit: 99999, includeChildren: false })
      const records = data?.data || []
      globalEmployeesData.value = records.map((u: any) => ({ id: u.id, departmentId: u.departmentId, role: u.role }))
      updateDeptMemberCounts()
    } catch (e) { console.error('获取全局员工数据失败', e) }
  }

  const fetchDeptEmployeesForCount = async () => {
    try {
      const params: any = { page: 1, limit: 99999, includeChildren: true }
      if (selectedDeptId.value) params.departmentId = selectedDeptId.value
      const { data } = await getEmployeesApi(params)
      const records = data?.data || []
      allEmployeesData.value = records.map((u: any) => ({ id: u.id, departmentId: u.departmentId, role: u.role }))
    } catch (e) { console.error('获取部门员工数据失败', e) }
  }

  const fetchEmployees = async () => {
    empLoading.value = true
    try {
      const { data } = await getEmployeesApi({
        page: empPage.value, limit: empPageSize.value,
        departmentId: selectedDeptId.value || undefined,
        role: empRoleFilter.value !== 'ALL' ? empRoleFilter.value : undefined,
        search: empSearch.value || undefined, includeChildren: true,
      })
      const records = data?.data || []
      employeeData.value = records.map((u: any) => ({
        id: u.id, username: u.username, name: u.name || u.username,
        role: u.role, email: u.email, department: u.department || null,
        departmentId: u.departmentId, enabled: u.enabled,
      }))
      empTotal.value = data?.total || 0
    } catch (e) { console.error('获取员工数据失败', e); ElMessage.error('获取员工数据失败') }
    finally { empLoading.value = false }
  }

  // ===== 事件处理 =====
  const handleSearchChange = () => { empPage.value = 1; fetchEmployees() }
  const handleRoleFilter = (role: string) => { empRoleFilter.value = role; empPage.value = 1; fetchEmployees() }

  const toggleSelectAll = (val: boolean) => {
    const currentIds = filteredEmployees.value.map((emp: any) => emp.id)
    if (val) { const newSet = new Set([...selectedEmployees.value, ...currentIds]); selectedEmployees.value = Array.from(newSet) }
    else { const currentIdSet = new Set(currentIds); selectedEmployees.value = selectedEmployees.value.filter((id: string) => !currentIdSet.has(id)) }
  }

  const toggleSelect = (id: string, selected: boolean) => {
    if (selected) selectedEmployees.value.push(id)
    else selectedEmployees.value = selectedEmployees.value.filter((i: string) => i !== id)
  }

  const handleBatchDisable = async () => {
    try {
      await ElMessageBox.confirm(`确认停用选中的 ${selectedEmployees.value.length} 个账号？`, '批量停用', { type: 'warning' })
      batchLoading.value = true
      try { await batchUpdateStatusApi(selectedEmployees.value, false); ElMessage.success('批量停用成功'); selectedEmployees.value = []; fetchEmployees(); fetchGlobalEmployeesForCount(); fetchDeptEmployeesForCount() }
      catch (e: any) { ElMessage.error(e.response?.data?.message || '操作失败') }
      finally { batchLoading.value = false }
    } catch { /* cancelled */ }
  }

  const handleBatchDelete = async () => {
    try {
      await ElMessageBox.confirm(`确认删除选中的 ${selectedEmployees.value.length} 个账号？此操作不可恢复！`, '批量删除', { type: 'warning' })
      batchLoading.value = true
      try { await batchDeleteEmployeesApi(selectedEmployees.value); ElMessage.success('批量删除成功'); selectedEmployees.value = []; fetchEmployees(); fetchGlobalEmployeesForCount(); fetchDeptEmployeesForCount() }
      catch (e: any) { ElMessage.error(e.response?.data?.message || '操作失败') }
      finally { batchLoading.value = false }
    } catch { /* cancelled */ }
  }

  const handleNewAccount = async () => {
    accountDialogType.value = 'add'; accountForm.id = ''; accountForm.username = ''; accountForm.name = ''
    accountForm.password = ''; accountForm.role = 'USER'; accountForm.email = ''
    if (orgData.value.length === 0) return
    accountForm.departmentId = selectedDeptId.value ? (buildDeptPath(orgData.value, selectedDeptId.value) || []) : []
    accountDialogVisible.value = true
  }

  const handleEditEmployee = async (row: any) => {
    accountDialogType.value = 'edit'; accountForm.id = row.id; accountForm.username = row.username; accountForm.name = row.name
    accountForm.password = ''; accountForm.role = row.role; accountForm.email = row.email || ''
    if (orgData.value.length === 0) return
    accountForm.departmentId = row.department?.id ? (buildDeptPath(orgData.value, row.department.id) || []) : []
    accountDialogVisible.value = true
  }

  const handleDeleteEmployee = async (row: any) => {
    try {
      await ElMessageBox.confirm(`确认删除账号 "${row.username}" 吗？`, '提示', { type: 'warning' })
      try { await deleteEmployeeApi(row.id); ElMessage.success('账号已删除'); fetchEmployees(); fetchGlobalEmployeesForCount(); fetchDeptEmployeesForCount() }
      catch (e: any) { ElMessage.error(e.response?.data?.message || '删除失败') }
    } catch { /* cancelled */ }
  }

  const handleResetPassword = async (row: any) => {
    try {
      await ElMessageBox.confirm(`确认重置账号 "${row.username}" 的密码？`, '重置密码', { type: 'warning' })
      try { await resetPasswordApi(row.id); ElMessage.success('密码已重置为默认密码: User@12345') }
      catch (e: any) { ElMessage.error(e.response?.data?.message || '重置失败') }
    } catch { /* cancelled */ }
  }

  const submitAccountForm = async (deptPathResolver?: (levels: string[]) => string | undefined) => {
    if (!accountForm.username || !accountForm.name) { ElMessage.warning('请填写完整的账号信息'); return }
    if (accountDialogType.value === 'add') {
      const pwdErr = validatePwdComplexity(accountForm.password)
      if (pwdErr) { ElMessage.warning(pwdErr); return }
    }
    if (accountDialogType.value === 'edit' && accountForm.password && accountForm.password.trim()) {
      const pwdErr = validatePwdComplexity(accountForm.password)
      if (pwdErr) { ElMessage.warning(pwdErr); return }
    }
    const deptId = Array.isArray(accountForm.departmentId) && accountForm.departmentId.length > 0 ? accountForm.departmentId[accountForm.departmentId.length - 1] : null
    accountSubmitting.value = true
    try {
      if (accountDialogType.value === 'add') {
        await createEmployeeApi({ username: accountForm.username, password: accountForm.password || undefined, name: accountForm.name, role: accountForm.role, email: accountForm.email || undefined, departmentId: deptId || undefined })
        ElMessage.success('账号添加成功')
      } else {
        const updateData: any = { name: accountForm.name, role: accountForm.role, email: accountForm.email || undefined, departmentId: deptId || null }
        if (accountForm.password && accountForm.password.trim()) updateData.password = accountForm.password
        await updateEmployeeApi(accountForm.id, updateData)
        ElMessage.success('账号编辑成功')
      }
      accountDialogVisible.value = false; fetchEmployees(); fetchGlobalEmployeesForCount(); fetchDeptEmployeesForCount()
    } catch (e: any) { ElMessage.error(e.response?.data?.message || '操作失败') }
    finally { accountSubmitting.value = false }
  }

  return {
    employeeData, allEmployeesData, globalEmployeesData,
    empLoading, empPage, empPageSize, empTotal, empSearch, empRoleFilter,
    selectedEmployees, batchLoading, deptMemberCounts,
    accountDialogVisible, accountDialogType, accountSubmitting, accountForm,
    roleTabs, filteredEmployees, isAllSelected, isIndeterminate,
    PASSWORD_COMPLEXITY_DESC,
    getAvatarClass, getAvatarLetter, getRoleLabel, getDeptMemberCount, updateDeptMemberCounts,
    validatePwdComplexity, generatePassword,
    fetchGlobalEmployeesForCount, fetchDeptEmployeesForCount, fetchEmployees,
    handleSearchChange, handleRoleFilter, toggleSelectAll, toggleSelect,
    handleBatchDisable, handleBatchDelete, handleNewAccount, handleEditEmployee,
    handleDeleteEmployee, handleResetPassword, submitAccountForm,
  }
}
