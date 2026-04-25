# LLM 配置问题修复说明

## 🐛 问题描述

1. **LLM 配置无法保存** - 刷新页面后配置恢复为默认值
2. **默认模型列表无用** - 预置的模型名称不适用于所有用户

## ✅ 已实施的修复

### 1. 添加详细的调试日志

在 `frontend/src/views/LLMConfig/ChatModelTab.vue` 中添加了完整的日志输出：

- ✅ 保存前打印配置内容
- ✅ 打印 API 测试结果
- ✅ 打印发送到后端的数据
- ✅ 打印保存结果
- ✅ 保存后立即验证配置
- ✅ 加载时打印从服务器获取的配置
- ✅ 详细记录每个字段的更新过程

### 2. 移除默认模型列表

将 `commonModels` 数组改为空数组，用户可以自由输入任何模型名称：

```typescript
// 之前
const commonModels = [
  'Qwen/Qwen2.5-72B-Instruct',
  'deepseek-ai/DeepSeek-V3',
  // ... 更多模型
]

// 现在
const commonModels: string[] = []
```

### 3. 改进配置加载逻辑

- ✅ 只在配置数据非空时才更新表单
- ✅ 过滤掉空字符串值
- ✅ 添加更清晰的日志提示

## 🔍 诊断步骤

### 在内网环境中测试

1. **打开浏览器开发者工具** (F12)
2. **切换到 Console 标签**
3. **进入 LLM 配置页面**
4. **填写配置信息并保存**
5. **查看控制台输出**

应该看到类似以下的日志：

```
开始加载 LLM 配置...
从服务器获取的配置: {value: {...}}
解析后的配置数据: {...}
更新字段 apiKey: sk-xxx
更新字段 apiBaseUrl: https://...
更新字段 modelName: Qwen/...
配置加载完成
```

保存时应该看到：

```
准备保存配置: {...}
连接测试结果: {success: true, ...}
正在保存配置到数据库...
发送的数据: {value: {...}}
保存结果: {...}
配置保存成功！
验证加载的配置: {value: {...}}
```

## 📋 可能的问题原因

### 1. 数据库连接问题

如果日志显示"加载配置失败"或"保存配置失败"，检查：

```sql
-- 在 PostgreSQL 中执行
SELECT key, value, "updatedAt" 
FROM "SystemConfig" 
WHERE key = 'llm_chat_model';
```

如果没有结果，说明配置没有保存到数据库。

### 2. 后端 API 问题

检查后端日志：

```bash
docker logs file_review_backend --tail 50
```

查找错误信息，如：
- 数据库连接失败
- 权限不足
- 参数验证失败

### 3. 前端缓存问题

如果配置已保存但页面仍显示旧值：

1. 清除浏览器缓存 (Ctrl+Shift+Delete)
2. 或使用无痕模式测试
3. 强制刷新页面 (Ctrl+F5)

## 🚀 部署步骤

### 方法1：重新编译并更新 Docker（推荐）

```powershell
# 1. 停止前端容器
docker stop file_review_frontend

# 2. 重新编译前端
cd e:\工作\file-compliance-web\frontend
npx vite build

# 3. 重新构建 Docker 镜像（无缓存）
cd e:\工作\file-compliance-web
docker build --no-cache -f Dockerfile.frontend -t file-compliance-web-frontend:latest .

# 4. 删除旧容器
docker rm file_review_frontend

# 5. 启动新容器
docker compose -f docker-compose.complete.yml up -d frontend

# 6. 导出离线包
docker save file-compliance-web-frontend:latest -o offline-packages\frontend-latest.tar
```

### 方法2：直接复制 dist 文件（快速测试）

如果不想重新构建 Docker，可以直接替换容器中的文件：

```powershell
# 1. 编译前端
cd e:\工作\file-compliance-web\frontend
npx vite build

# 2. 复制到容器
docker cp dist/ file_review_frontend:/usr/share/nginx/html/

# 3. 重启 Nginx
docker exec file_review_frontend nginx -s reload
```

## 🧪 验证修复

1. **访问 LLM 配置页面**
2. **填写配置信息**：
   - API 密钥
   - API 基础 URL
   - 模型名称（现在可以自由输入）
3. **点击"测试连接"** - 查看测试结果
4. **点击"保存配置"** - 查看保存结果
5. **刷新页面** - 验证配置是否保留
6. **查看控制台日志** - 确认所有步骤正常

## 📝 注意事项

1. **首次保存**：如果数据库中没有配置，会创建新记录
2. **更新配置**：如果已有配置，会更新现有记录
3. **测试失败**：即使测试失败，用户仍可选择"仍然保存"
4. **模型名称**：现在支持任意模型名称，不再限制于预定义列表

## 🔧 后续优化建议

1. **添加配置历史记录** - 保存多次配置变更历史
2. **支持多套配置** - 允许保存多个 LLM 配置并切换
3. **配置导入导出** - 支持配置的备份和恢复
4. **智能模型推荐** - 根据 API URL 自动推荐常用模型

---

**修复日期**: 2026-04-24  
**修复版本**: v1.1  
**相关文件**: 
- `frontend/src/views/LLMConfig/ChatModelTab.vue`
- `backend/src/controllers/systemConfig.controller.ts`
