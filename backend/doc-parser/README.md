# 文档解析服务

基于 anydoc（Firecrawl，Rust 实现）的文档解析微服务，14 种格式统一转 Markdown + 结构化数据，
扫描件 PDF 走 RapidOCR 本地识别兜底。

## 支持格式

| 格式 | 扩展名 | 解析器 | 说明 |
|------|--------|--------|------|
| Word | `.doc` `.docm` `.docx` | anydoc | 老格式原生支持，无需 antiword/LibreOffice |
| PowerPoint | `.ppt` `.pps` `.pot` `.pptx` `.pptm` `.ppsx` `.ppsm` | anydoc | 幻灯片/表格/图表/备注 |
| Excel | `.xls` `.xlsx` `.xlsm` `.xlsb` | anydoc | 多 Sheet/合并单元格 → Markdown 表格 |
| OpenDocument | `.odt` `.ods` `.odp` | anydoc | 文档/表格/演示 |
| 其他 | `.rtf` `.epub` `.csv` | anydoc | RTF/电子书/表格 |
| PDF（文本型） | `.pdf` | anydoc（内置 pdf-inspector） | 本地转换，无需 OCR |
| PDF（扫描件） | `.pdf` | RapidOCR → Vision LLM | 无文本层时触发 OCR 兜底 |

> 引擎选择：默认 anydoc。环境变量 `PARSER_ENGINE=markitdown` 可回退旧引擎（灰度/回滚用，需另行安装 markitdown）。

## 目录结构

```
doc-parser/
├── main.py              # FastAPI 应用入口（anydoc 主力 + PDF fallback/OCR 调度）
├── pdf_enhanced.py      # PDF 增强解析器（fallback，PyMuPDF，含页眉页脚过滤）
├── rapid_ocr.py         # RapidOCR 本地 OCR（扫描件 PDF 兜底）
├── vision_ocr.py        # Vision LLM OCR（超低质量扫描件兜底）
├── requirements.txt     # Python 依赖声明
├── Dockerfile           # Docker 镜像构建
├── docker-compose.yml   # Docker Compose 编排
├── start.sh             # Linux/Mac 启动脚本
├── start.ps1            # Windows 启动脚本
└── README.md
```

## 快速启动

### 方式一：Windows PowerShell（推荐开发用）

```powershell
cd backend/doc-parser
.\start.ps1          # 默认端口 8000
.\start.ps1 8001     # 自定义端口
```

### 方式二：手动安装

```bash
# 1. 创建虚拟环境
python -m venv .venv
.venv\Scripts\Activate.ps1    # Windows
# source .venv/bin/activate   # Linux/Mac

# 2. 安装依赖
pip install -r requirements.txt

# 3. 启动服务
python main.py
```

### 方式三：Docker

```bash
# 从项目根目录构建并启动
docker-compose up -d doc-parser

# 自定义端口
PARSER_PORT=8001 docker-compose up -d doc-parser
```

## API 接口

服务默认运行在 `http://localhost:8000`，Swagger 文档：`http://localhost:8000/docs`

### 1. 健康检查

```
GET /health
```

响应：
```json
{
  "status": "ok",
  "version": "4.0.0",
  "supported_formats": [".docx", ".xlsx", ".pdf", ".pptx"]
}
```

### 2. 文件解析

```
POST /api/parse
Content-Type: multipart/form-data

file: <文件>
file_type: docx    # 可选，自动从文件名推断
```

### 3. 文件转换（仅 Markdown）

```
POST /api/convert
Content-Type: multipart/form-data

file: <文件>
```

### 4. Base64 转换

```
POST /api/convert/base64?data=<base64编码>&filename=example.pdf
```

## 端口配置

默认端口 `8000`，可通过环境变量修改：

```bash
# 环境变量
PORT=8001 python main.py

# Docker
PARSER_PORT=8001 docker-compose up -d doc-parser
```

Node.js 后端的 `PARSER_SERVICE_URL` 需与实际端口一致。
