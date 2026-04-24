# 批量导入用户 - 部门映射修复说明

## 🔍 问题描述

用户在批量导入时，虽然在 Excel 模板中填写了正确的部门名称（如"技术部"、"安全部"等），但导入后用户没有被分配到对应的部门。

## 🐛 根本原因

**前端代码存在严重缺陷**：

1. **Excel 中填写的是部门名称**（字符串，如"技术部"）
2. **数据库存储需要的是部门ID**（UUID）
3. **前端提交数据时完全忽略了 `department` 字段**，导致后端收到的 `departmentId` 为 `undefined`

### 原代码问题（SystemManagement.vue 第 1146-1152 行）

```typescript
// ❌ 错误：没有包含 departmentId
const employees = validData.map(r => ({
  username: r.username,
  name: r.name,
  password: r.password || undefined,
  role: r.role?.toUpperCase() || 'USER',
  email: r.email || undefined,
  // 缺少 departmentId!
}))
```

---

## ✅ 修复方案

### 1. 添加部门名称到 ID 的映射函数

```typescript
// 构建部门名称到ID的映射表（支持层级结构）
const buildDeptNameToIdMap = (depts: any[], parentPath = ''): Map<string, string> => {
  const map = new Map<string, string>()
  for (const dept of depts) {
    const fullPath = parentPath ? `${parentPath}/${dept.name}` : dept.name
    map.set(dept.name, dept.id)           // 支持直接使用部门名称
    map.set(fullPath, dept.id)            // 支持使用完整路径
    if (dept.children && dept.children.length > 0) {
      const childMap = buildDeptNameToIdMap(dept.children, fullPath)
      childMap.forEach((value, key) => map.set(key, value))
    }
  }
  return map
}

// 获取部门名称对应的ID（支持精确匹配和模糊匹配）
const getDepartmentIdByName = (deptName: string): string | undefined => {
  if (!deptName || !orgData.value || orgData.value.length === 0) {
    return undefined
  }
  
  const nameToIdMap = buildDeptNameToIdMap(orgData.value)
  
  // 1. 尝试精确匹配
  if (nameToIdMap.has(deptName)) {
    return nameToIdMap.get(deptName)
  }
  
  // 2. 尝试去除空格后匹配
  const trimmedName = deptName.trim()
  if (nameToIdMap.has(trimmedName)) {
    return nameToIdMap.get(trimmedName)
  }
  
  // 3. 尝试部分匹配（模糊匹配）
  for (const [name, id] of nameToIdMap.entries()) {
    if (name.includes(trimmedName) || trimmedName.includes(name)) {
      console.warn(`部门名称 "${deptName}" 模糊匹配到 "${name}"`)
      return id
    }
  }
  
  console.warn(`未找到部门: "${deptName}"`)
  return undefined
}
```

### 2. 修改批量导入逻辑，添加部门ID映射

```typescript
const handleBatchImport = async () => {
  // ... 前置检查
  
  try {
    // ✅ 修复：角色标准化 + 部门名称转ID
    const employees = validData.map(r => {
      // 将部门名称转换为部门ID
      let departmentId: string | undefined = undefined
      if (r.department) {
        departmentId = getDepartmentIdByName(r.department)
        if (!departmentId) {
          console.warn(`用户 "${r.username}" 的部门 "${r.department}" 未找到，将不分配部门`)
        }
      }
      
      return {
        username: r.username,
        name: r.name,
        password: r.password || undefined,
        role: r.role?.toUpperCase() || 'USER',
        departmentId, // ✅ 添加部门ID
        email: r.email || undefined,
      }
    })
    
    const result = await batchCreateEmployeesApi(employees)
    
    // ... 结果处理
    
    // ✅ 新增：检查是否有部门未匹配的情况
    const deptWarnings = validData.filter(r => r.department && !getDepartmentIdByName(r.department))
    if (deptWarnings.length > 0) {
      messages.push(`\n⚠️ 以下用户的部门未找到，将不分配部门：`)
      deptWarnings.slice(0, 5).forEach(r => {
        messages.push(`  - ${r.username}: "${r.department}"`)
      })
      if (deptWarnings.length > 5) {
        messages.push(`  ... 还有 ${deptWarnings.length - 5} 个用户`)
      }
    }
  } catch (e: any) {
    // ... 错误处理
  }
}
```

---

## 🎯 修复效果

### 支持的部门名称格式

1. **精确匹配**：Excel 中填写 "技术部" → 匹配到 ID
2. **完整路径**：Excel 中填写 "技术部/前端组" → 匹配到子部门 ID
3. **模糊匹配**：Excel 中填写 "技术" → 匹配到包含"技术"的部门
4. **容错处理**：找不到部门时给出警告，但不阻止导入

### 导入结果提示优化

导入完成后会显示：

```
✅ 成功创建 8 个账号
❌ 有 2 个账号创建失败:
  第3行: 用户名 "zhangsan" 已存在
  第5行: 无效的角色 "GUEST"，应为 ADMIN/MANAGER/USER

⚠️ 以下用户的部门未找到，将不分配部门：
  - lisi: "不存在的部门"
  - wangwu: "旧部门名称"
```

---

## 📝 使用建议

### Excel 模板填写规范

| 登录账号 | 真实姓名 | 密码 | 角色 | 部门 | 邮箱 |
|---------|---------|------|------|------|------|
| zhangsan | 张三 | 123456 | USER | 技术部 | zhangsan@example.com |
| lisi | 李四 | 123456 | MANAGER | 技术部/前端组 | lisi@example.com |
| wangwu | 王五 | 123456 | USER | 安全部 | wangwu@example.com |

### 注意事项

1. **部门名称必须与系统中的部门名称完全一致**（区分大小写）
2. **如果部门有层级关系，建议使用完整路径**（如"技术部/前端组"）
3. **导入前可以先查看系统管理中的部门列表，确认部门名称**
4. **如果部门不存在，用户会被创建但不分配部门，可以后续手动调整**

---

## 🚀 部署步骤

### 1. 重新构建前端（因为代码已修改）

```bash
cd frontend
npm run build
```

### 2. 重新构建前端 Docker 镜像

```bash
cd ..
docker build -f Dockerfile.frontend -t file-review-frontend:v1.1 .
```

### 3. 更新离线镜像包

```bash
docker save file-review-frontend:v1.1 -o offline-packages\frontend-v1.1.tar
```

### 4. 重启前端容器

```bash
docker restart file_review_frontend
```

或者完全重建：

```bash
docker compose -f docker-compose.offline.yml down
docker compose -f docker-compose.offline.yml up -d
```

---

## 🔍 验证方法

### 测试步骤

1. **准备测试数据**：
   - 在系统管理中创建几个新部门（如"测试部A"、"测试部B"）
   - 准备一个 Excel 文件，包含这些新部门名称

2. **执行批量导入**：
   - 上传 Excel 文件
   - 点击"确认导入"

3. **检查结果**：
   - 查看导入结果提示，确认是否有部门未匹配的警告
   - 进入"员工管理"页面，检查新创建的用户是否分配到了正确的部门
   - 点击部门树，确认各部门人数统计正确

### 预期结果

- ✅ 填写正确部门名称的用户 → 分配到对应部门
- ✅ 填写错误部门名称的用户 → 创建成功但不分配部门，并在结果中显示警告
- ✅ 部门树中的人数统计正确更新

---

## 📊 技术细节

### 部门映射算法

1. **构建映射表**：递归遍历部门树，建立 `名称 -> ID` 的 Map
2. **多层级支持**：同时存储短名称（"前端组"）和完整路径（"技术部/前端组"）
3. **三级匹配策略**：
   - 精确匹配（最快）
   - 去空格匹配（容错）
   - 模糊匹配（兜底）

### 性能考虑

- 每次导入时会重新构建映射表（因为部门可能动态变化）
- 对于大量用户（>1000），可以考虑缓存映射表
- 当前实现对于常规场景（<100个部门，<500个用户）性能足够

---

## ⚠️ 已知限制

1. **不支持部门别名**：如果系统中部门改名，Excel 中必须使用新名称
2. **不支持自动创建部门**：如果部门不存在，不会自动创建，只会跳过部门分配
3. **模糊匹配可能误判**：如果有多个相似部门名，可能匹配到错误的部门

### 未来优化方向

- [ ] 支持部门别名配置
- [ ] 导入时自动创建不存在的部门
- [ ] 提供部门名称下拉选择，避免拼写错误
- [ ] 增加导入预览功能，显示部门匹配结果

---

**修复完成时间**: 2026-04-24  
**涉及文件**: `frontend/src/views/SystemManagement.vue`  
**影响范围**: 用户批量导入功能的部门分配
