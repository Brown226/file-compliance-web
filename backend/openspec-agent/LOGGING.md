# Agent 服务日志系统说明

## 概述

Agent 服务已配置统一的日志系统，所有日志输出到 stdout，便于 Docker 容器捕获和管理。

## 日志配置

### 环境变量

通过环境变量 `APP_LOG_LEVEL` 控制日志级别：

```bash
APP_LOG_LEVEL=INFO    # 默认
APP_LOG_LEVEL=DEBUG   # 调试模式
APP_LOG_LEVEL=WARNING # 仅警告和错误
APP_LOG_LEVEL=ERROR   # 仅错误
```

在 `docker-compose.yml` 或 `.env` 文件中配置：

```yaml
environment:
  - APP_LOG_LEVEL=INFO
```

### 日志格式

统一的日志格式：

```
2025-01-08 14:30:15 - archspec-agent - INFO - [app.py:26] - ArchSpec Agent Service Starting...
```

格式说明：
- 时间戳：`2025-01-08 14:30:15`
- Logger 名称：`archspec-agent` / `construction_agent` / `construction_tools` 等
- 日志级别：`DEBUG` / `INFO` / `WARNING` / `ERROR` / `CRITICAL`
- 文件位置：`[app.py:26]`
- 日志消息：实际的日志内容

## 使用方法

### 在新模块中使用日志

```python
from utils.logger import get_logger

# 创建 logger 实例
logger = get_logger('my_module_name')

# 使用日志
logger.debug("调试信息")
logger.info("一般信息")
logger.warning("警告信息")
logger.error("错误信息", exc_info=True)  # exc_info=True 会打印堆栈
logger.critical("严重错误")
```

### 日志级别使用建议

- **DEBUG**: 详细的调试信息，仅开发环境使用
  ```python
  logger.debug(f"[Researcher] Starting thinking phase (streaming)")
  ```

- **INFO**: 关键业务流程的正常信息
  ```python
  logger.info(f"[Router] Intent classified: {intent}")
  logger.info("[Generate] Document generation completed successfully")
  ```

- **WARNING**: 非致命问题，但需要关注
  ```python
  logger.warning(f"[Generate] Context too long, truncating to {MAX_CONTEXT_CHARS}")
  logger.warning(f"[RAGFlow] No relevant content found in {kb_name}")
  ```

- **ERROR**: 错误信息，但服务仍可运行
  ```python
  logger.error(f"[Generate] Failed to compile prompt: {e}", exc_info=True)
  logger.error(f"[RAGFlow] Retrieval failed: {e}", exc_info=True)
  ```

- **CRITICAL**: 严重错误，可能导致服务停止
  ```python
  logger.critical(f"Failed to start server: {e}")
  ```

## Docker 日志查看

### 实时查看日志

```bash
# 查看 agent 服务日志
docker logs -f archspec-agent

# 查看最近 100 行
docker logs --tail 100 archspec-agent

# 查看带时间戳的日志
docker logs -t archspec-agent
```

### 日志持久化配置

在 `docker-compose.yml` 中已配置：

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "50m"      # 单个日志文件最大 50MB
    max-file: "3"        # 最多保留 3 个日志文件
```

日志文件位置：
```
/var/lib/docker/containers/<container-id>/<container-id>-json.log
```

## 已优化的模块

以下模块已替换 `print` 为标准日志：

### 核心模块
- ✅ `app.py` - 应用入口，全局异常处理
- ✅ `utils/logger.py` - 统一日志配置模块

### API 模块
- ✅ `api/workflow_api.py` - Workflow API
- ✅ `api/rag_api.py` - RAG API
- ✅ `api/file_api.py` - File API

### 服务模块
- ✅ `service/workflow/construction_agent.py` - 建筑施工文档生成 Agent
- ✅ `service/tools/construction_tools.py` - RAGFlow 检索工具
- ✅ `service/rag/extract_info.py` - 信息提取服务
- ✅ `service/rag/rag_service_ragflow.py` - RAGFlow 服务

## 关键日志点

### 1. 应用启动/关闭
```python
logger.info("ArchSpec Agent Service started successfully")
logger.info("ArchSpec Agent Service shutting down...")
```

### 2. API 请求
```python
logger.info(f"[workflow_chat_stream] 请求收到: message={request.message[:50]}...")
logger.info("[workflow_chat_stream] 开始流式响应")
```

### 3. Agent 工作流
```python
logger.info(f"[Router] Intent classified: {intent}")
logger.info("[Generate] Starting document generation...")
logger.info("[Generate] Document generation completed successfully")
```

### 4. 工具调用
```python
logger.info(f"[RAGFlow] Retrieving from {kb_name}: {query[:50]}...")
logger.debug(f"[RAGFlow] Retrieved {len(context_list)} chunks from {kb_name}")
```

### 5. 错误处理
```python
logger.error(f"Unhandled exception: {type(exc).__name__}: {str(exc)}")
logger.error(f"Request URL: {request.url}")
logger.error(f"Traceback:\n{error_traceback}")
```

## 故障排查

### 问题：Docker 中看不到日志

**原因**：
- 日志级别设置过高（如 ERROR），导致 INFO 日志不显示
- 日志输出到了文件而非 stdout

**解决方案**：
```bash
# 检查环境变量
docker exec archspec-agent env | grep APP_LOG_LEVEL

# 设置为 DEBUG 级别查看详细日志
docker-compose up -d --build --force-recreate \
  -e APP_LOG_LEVEL=DEBUG
```

### 问题：日志文件过大

**解决方案**：
已配置日志轮转，自动限制日志文件大小和数量。如需调整：

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"   # 减小单文件大小
    max-file: "5"     # 增加保留文件数
```

### 问题：错误没有堆栈信息

**解决方案**：
在 `logger.error()` 调用时添加 `exc_info=True`：

```python
try:
    # some code
except Exception as e:
    logger.error(f"Error occurred: {e}", exc_info=True)  # 添加堆栈
```

## 最佳实践

1. **使用结构化日志消息**
   ```python
   # 好的做法
   logger.info(f"[Generate] Context length: {len(context)} chars")

   # 避免
   print("Context:", context)
   ```

2. **添加模块标识**
   ```python
   logger.info(f"[Router] Intent classified: {intent}")
   logger.debug(f"[Researcher] Starting thinking phase")
   ```

3. **敏感信息脱敏**
   ```python
   # 好的做法
   logger.info(f"API key: {api_key[:8]}***")

   # 避免
   logger.info(f"API key: {api_key}")
   ```

4. **异常时记录上下文**
   ```python
   try:
       result = process(data)
   except Exception as e:
       logger.error(f"Failed to process data: {e}", exc_info=True)
       logger.error(f"Input data: {data[:100]}...")  # 记录输入
   ```

5. **避免过度日志**
   ```python
   # 避免在循环中打印大量日志
   for item in items:
       logger.debug(f"Processing: {item}")  # 使用 DEBUG 级别
   ```

## 监控建议

### 日志聚合

推荐使用日志聚合工具：
- **ELK Stack** (Elasticsearch + Logstash + Kibana)
- **Loki** (轻量级，与 Grafana 集成)
- **Fluentd** (云原生日志收集)

### 告警规则

建议设置告警：
- ERROR 级别日志数量激增
- CRITICAL 级别日志出现
- 特定错误模式匹配（如 "API 调用失败"）

## 更新日志

- **2025-01-08**: 初始版本，完成统一日志系统配置
  - 创建统一日志配置模块 `utils/logger.py`
  - 替换所有模块中的 `print` 为标准日志
  - 添加全局异常处理器
  - 配置 Docker 日志轮转
