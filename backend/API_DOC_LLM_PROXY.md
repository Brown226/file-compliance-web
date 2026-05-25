# LLM Proxy API 文档

## 概述

LLM Proxy 接口提供统一的 OpenAI 格式兼容入口，支持 Chat、Embedding 和 Rerank 三种模型类型。用户只需在系统配置中填写基础 URL（至 `/v1` 层级），接口会自动处理路径拼接和格式转换。

## 接口列表

| 方法 | 路径 | 功能 | 权限 |
|------|------|------|------|
| POST | `/api/llm-proxy/chat/completions` | 聊天模型代理 | 已认证用户 |
| POST | `/api/llm-proxy/embeddings` | Embedding 模型代理 | 已认证用户 |
| POST | `/api/llm-proxy/rerank` | Rerank 模型代理 | 已认证用户 |
| GET | `/api/llm-proxy/status` | 获取代理状态 | 已认证用户 |
| POST | `/api/llm-proxy/test` | 测试连接 | ADMIN |

---

## 1. Chat Completions 接口

### 接口地址
`POST /api/llm-proxy/chat/completions`

### 请求格式

```json
{
  "model": "string (可选, 使用配置的默认模型)",
  "messages": [
    {
      "role": "string (必填, 取值: system/user/assistant/tool)",
      "content": "string (必填, 消息内容)"
    }
  ],
  "max_tokens": "number (可选, 最大生成token数, 默认8192)",
  "temperature": "number (可选, 温度系数 0-2, 默认0.7)",
  "stream": "boolean (可选, 是否流式输出, 默认false)"
}
```

### 示例请求

```bash
curl -X POST http://localhost:3000/api/llm-proxy/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "messages": [
      {"role": "system", "content": "你是一个助手"},
      {"role": "user", "content": "你好"}
    ],
    "max_tokens": 512,
    "temperature": 0.7
  }'
```

### 响应格式

```json
{
  "code": 200,
  "message": "请求成功",
  "data": {
    "id": "chatcmpl-xxx",
    "object": "chat.completion",
    "created": 1699999999,
    "model": "BAAI/bge-m3",
    "choices": [
      {
        "index": 0,
        "message": {
          "role": "assistant",
          "content": "你好！有什么我可以帮助你的？"
        },
        "finish_reason": "stop"
      }
    ],
    "usage": {
      "prompt_tokens": 10,
      "completion_tokens": 15,
      "total_tokens": 25
    }
  }
}
```

---

## 2. Embeddings 接口

### 接口地址
`POST /api/llm-proxy/embeddings`

### 请求格式

```json
{
  "model": "string (可选, 使用配置的默认模型)",
  "input": "string | string[] (必填, 输入文本或文本数组)",
  "encoding_format": "string (可选, 编码格式: float/base64, 默认float)"
}
```

### 示例请求

```bash
curl -X POST http://localhost:3000/api/llm-proxy/embeddings \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "input": ["文本1", "文本2"],
    "encoding_format": "float"
  }'
```

### 响应格式

```json
{
  "code": 200,
  "message": "请求成功",
  "data": {
    "object": "list",
    "data": [
      {
        "object": "embedding",
        "index": 0,
        "embedding": [0.1, 0.2, 0.3, ...]
      }
    ],
    "model": "BAAI/bge-m3",
    "usage": {
      "prompt_tokens": 5,
      "total_tokens": 5
    }
  }
}
```

---

## 3. Rerank 接口

### 接口地址
`POST /api/llm-proxy/rerank`

### 请求格式

```json
{
  "model": "string (可选, 使用配置的默认模型)",
  "query": "string (必填, 查询文本)",
  "documents": "string[] (必填, 待排序文档数组)",
  "top_n": "number (可选, 返回前N个结果)",
  "return_documents": "boolean (可选, 是否返回文档内容, 默认true)"
}
```

### 示例请求

```bash
curl -X POST http://localhost:3000/api/llm-proxy/rerank \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "query": "建筑防火规范",
    "documents": [
      "建筑设计防火规范适用于新建建筑",
      "建筑结构荷载规范适用于结构设计",
      "建筑抗震设计规范适用于抗震设计"
    ],
    "top_n": 2,
    "return_documents": true
  }'
```

### 响应格式

```json
{
  "code": 200,
  "message": "请求成功",
  "data": {
    "results": [
      {
        "index": 0,
        "document": "建筑设计防火规范适用于新建建筑",
        "score": 0.95
      },
      {
        "index": 2,
        "document": "建筑抗震设计规范适用于抗震设计",
        "score": 0.72
      }
    ]
  }
}
```

---

## 4. 获取代理状态

### 接口地址
`GET /api/llm-proxy/status`

### 响应格式

```json
{
  "code": 200,
  "message": "获取状态成功",
  "data": {
    "chat": {
      "configured": true,
      "modelName": "BAAI/bge-m3",
      "apiBaseUrl": "https://api.siliconflow.cn/v1"
    },
    "embedding": {
      "configured": true,
      "modelName": "BAAI/bge-m3",
      "apiBaseUrl": "https://api.siliconflow.cn/v1"
    },
    "rerank": {
      "configured": false,
      "modelName": "未配置",
      "apiBaseUrl": "未配置"
    }
  }
}
```

---

## 5. 测试连接

### 接口地址
`POST /api/llm-proxy/test`

### 请求格式

```json
{
  "modelType": "string (必填, 取值: chat/embedding/rerank)"
}
```

### 示例请求

```bash
curl -X POST http://localhost:3000/api/llm-proxy/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"modelType": "embedding"}'
```

### 响应格式

```json
{
  "code": 200,
  "message": "连接测试成功",
  "data": {
    "success": true,
    "modelType": "embedding",
    "modelName": "BAAI/bge-m3",
    "apiBaseUrl": "https://api.siliconflow.cn/v1",
    "latency": "1052ms",
    "message": "连接测试成功"
  }
}
```

---

## 错误处理

### 错误响应格式

```json
{
  "code": 400,
  "message": "参数验证失败: messages 必须是数组格式; 消息内容不能为空"
}
```

### 常见错误码

| 错误码 | 说明 |
|--------|------|
| 400 | 参数验证失败或模型未配置 |
| 401 | 未提供认证 Token |
| 403 | 无操作权限 |
| 500 | 服务器内部错误 |

---

## 配置要求

### API 基础 URL 格式

配置系统时，API 基础 URL 只需填写至 `/v1` 层级即可：

- **正确格式**: `https://api.siliconflow.cn/v1`
- **错误格式**: `https://api.siliconflow.cn/v1/chat/completions`

系统会自动根据请求类型拼接完整路径：
- Chat: `/v1/chat/completions`
- Embedding: `/v1/embeddings`
- Rerank: `/v1/rerank`

### 支持的服务商

| 服务商 | 基础 URL |
|--------|----------|
| SiliconFlow | `https://api.siliconflow.cn/v1` |
| OpenAI | `https://api.openai.com/v1` |
| 火山引擎 | `https://ark.cn-beijing.volces.com/api/v3` |
| 自定义 | 任意 OpenAI 兼容 API |

---

## 使用注意事项

1. **认证要求**: 所有接口需要在请求头中携带 `Authorization: Bearer <token>`
2. **超时设置**: 默认超时时间为 120 秒，可在系统配置中调整
3. **权限控制**: 测试接口仅管理员可访问，其他接口所有已认证用户均可访问
4. **格式兼容**: 接口输出严格遵循 OpenAI API 格式规范
5. **错误日志**: 所有错误会记录到服务器日志中，便于排查问题