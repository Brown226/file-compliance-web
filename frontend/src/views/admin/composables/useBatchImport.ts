/**
 * 批量导入员工相关逻辑
 * 从 DepartmentManagement.vue 提取
 */
import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import * as XLSX from 'xlsx'
import { batchCreateEmployeesApi } from '@/api/system'

export function useBatchImport(
  orgData: any,
  fetchDepartments: () => Promise<void>,
  findDeptByPath: (depts: any[], path: string[]) => any | undefined,
  getDepartmentIdByName: (name: string) => string | undefined,
  resolveDepartmentId: (l1: string, l2: string, l3: string) => Promise<{ departmentId?: string; createdDepts: string[] }>,
  onImported: () => void,
) {
  const showBatchImportDialog = ref(false)
  const uploadRef = ref()
  const batchImportLoading = ref(false)
  const previewData = ref<any[]>([])
  const uploadedFile = ref<File | null>(null)

  const downloadTemplate = () => {
    const templateData = [
      { '登录账号': 'zhangsan', '真实姓名': '张三', '密码': 'User@12345', '角色': 'USER', '一级部门': '总公司', '二级部门': '研发部', '三级部门': '', '邮箱': 'zhangsan@example.com' },
      { '登录账号': 'lisi', '真实姓名': '李四', '密码': 'User@12345', '角色': 'MANAGER', '一级部门': '总公司', '二级部门': '结构设计部', '三级部门': '', '邮箱': 'lisi@example.com' },
    ]
    const ws = XLSX.utils.json_to_sheet(templateData)
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '员工导入模板')
    XLSX.writeFile(wb, '员工导入模板.xlsx')
  }

  const handleFileChange = (file: any) => {
    const maxSize = 10 * 1024 * 1024
    if (file.size > maxSize) { ElMessage.error(`文件大小超过限制（最大 10MB），当前大小：${(file.size / 1024 / 1024).toFixed(2)}MB`); uploadRef.value?.clearFiles(); return }
    const fileName = file.name.toLowerCase()
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls') && !fileName.endsWith('.csv')) { ElMessage.error('仅支持 .xlsx、.xls、.csv 格式的文件'); uploadRef.value?.clearFiles(); return }
    uploadedFile.value = file.raw; parseExcel(file.raw)
  }

  const parseExcel = (file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const workbook = XLSX.read(data, { type: 'array' })
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
        const jsonData = XLSX.utils.sheet_to_json(firstSheet)
        previewData.value = jsonData.map((row: any) => ({
          username: row['登录账号'] || row['username'] || '',
          name: row['真实姓名'] || row['name'] || '',
          password: row['密码'] || row['password'] || '',
          role: row['角色'] || row['role'] || 'USER',
          deptLevel1: row['一级部门'] || row['deptLevel1'] || '',
          deptLevel2: row['二级部门'] || row['deptLevel2'] || '',
          deptLevel3: row['三级部门'] || row['deptLevel3'] || '',
          department: row['部门'] || row['department'] || '',
          email: row['邮箱'] || row['email'] || '',
        })).filter((r: any) => r.username && r.name)
      } catch (err) { console.error('解析Excel失败', err); ElMessage.error('解析Excel文件失败') }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleBatchImport = async () => {
    if (previewData.value.length === 0) { ElMessage.warning('请先上传员工数据'); return }
    const validData = previewData.value.filter((r: any) => r.username && r.name)
    if (validData.length === 0) { ElMessage.warning('没有有效的员工数据'); return }
    batchImportLoading.value = true
    try {
      const deptPathMap = new Map<string, { level1: string; level2: string; level3: string }>()
      validData.forEach((r: any) => {
        const levels = [r.deptLevel1, r.deptLevel2, r.deptLevel3].filter((l: string) => l && l.trim())
        if (levels.length > 0) { const pathKey = levels.join('|'); if (!deptPathMap.has(pathKey)) deptPathMap.set(pathKey, { level1: r.deptLevel1, level2: r.deptLevel2, level3: r.deptLevel3 }) }
      })
      if (deptPathMap.size > 0) {
        ElMessage.info(`正在检查/创建 ${deptPathMap.size} 个部门路径...`)
        const entries = Array.from(deptPathMap.entries())
        const results = await Promise.all(entries.map(([, path]) => resolveDepartmentId(path.level1, path.level2, path.level3)))
        const allCreatedDepts: string[] = []
        results.forEach(r => allCreatedDepts.push(...r.createdDepts))
        if (allCreatedDepts.length > 0) ElMessage.success(`已自动创建 ${allCreatedDepts.length} 个新部门`)
      }
      await fetchDepartments()
      const employees = validData.map((r: any) => {
        let departmentId: string | undefined = undefined
        const levels = [r.deptLevel1, r.deptLevel2, r.deptLevel3].filter((l: string) => l && l.trim())
        if (levels.length > 0) { const matched = findDeptByPath(orgData.value, levels); departmentId = matched?.id }
        else if (r.department) departmentId = getDepartmentIdByName(r.department)
        return { username: r.username, name: r.name, password: r.password || undefined, role: r.role?.toUpperCase() || 'USER', departmentId, email: r.email || undefined }
      })
      const result = await batchCreateEmployeesApi(employees)
      const messages: string[] = []
      if (result.data.successCount > 0) messages.push(`✅ 成功创建 ${result.data.successCount} 个账号`)
      if (result.data.failCount > 0) {
        messages.push(`❌ 有 ${result.data.failCount} 个账号创建失败:`)
        const errorList = result.data.errors.slice(0, 10).join('\n'); messages.push(errorList)
        if (result.data.errors.length > 10) messages.push(`... 还有 ${result.data.errors.length - 10} 条错误`)
      }
      if (result.data.failCount > 0) {
        ElMessageBox.alert(messages.join('\n\n'), '导入结果', { confirmButtonText: '确定', type: result.data.successCount > 0 ? 'warning' : 'error' })
      } else { ElMessage.success(messages.join('\n')) }
      showBatchImportDialog.value = false; previewData.value = []; uploadedFile.value = null; onImported()
    } catch (e: any) {
      const errorMsg = e.response?.data?.message || e.response?.data?.error || '批量导入失败'; ElMessage.error(errorMsg)
    } finally { batchImportLoading.value = false }
  }

  return {
    showBatchImportDialog, uploadRef, batchImportLoading, previewData, uploadedFile,
    downloadTemplate, handleFileChange, parseExcel, handleBatchImport,
  }
}
