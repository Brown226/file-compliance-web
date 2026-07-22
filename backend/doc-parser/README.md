# 文档解析服务

基于原生 Python 库的文档解析微服务，各格式使用独立的增强解析器，提供 Markdown 转换和结构化解析能力。

## 支持格式

| 格式 | 扩展名 | 解析器 | 说明 |
|------|--------|--------|------|
| Word | `.docx` | python-docx | 标题/表格/列表/脚注/尾注 → Markdown |
| Excel | `.xlsx` | openpyxl | 多 Sheet/合并单元格 → Markdown 表格 |
| PDF | `.pdf` | PyMuPDF + pdfplumber | 文本/标题检测/表格 → Markdown |
| PowerPoint | `.pptx` | python-pptx | 幻灯片/表格/图表/备注 → Markdown |

## 目录结构

```
markitdown-service/
├── main.py              # FastAPI 应用入口
├── pdf_enhanced.py      # PDF 增强解析器（PyMuPDF + pdfplumber）
├── docx_enhanced.py     # DOCX 增强解析器（python-docx）
├── xlsx_enhanced.py     # XLSX 增强解析器（openpyxl）
├── pptx_enhanced.py     # PPTX 增强解析器（python-pptx）
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
cd backend/markitdown-service
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
