# ============================================
# MarkItDown 文档解析服务 - Windows 本地开发启动脚本
# 用法: .\start.ps1 [端口号]
#   默认端口 8000，可自定义: .\start.ps1 8001
# ============================================

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$MarkitdownSrc = Join-Path $ScriptDir "vendor\markitdown"

# 端口配置：优先使用参数，其次环境变量 PORT，默认 8000
$Port = if ($args[0]) { $args[0] } elseif ($env:PORT) { $env:PORT } else { 8000 }

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " MarkItDown 文档解析服务 - 开发模式" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# 检查 markitdown 源码
if (-not (Test-Path $MarkitdownSrc)) {
    Write-Host "❌ 找不到 markitdown 源码: $MarkitdownSrc" -ForegroundColor Red
    Write-Host "   请确保 vendor\markitdown\ 目录存在" -ForegroundColor Red
    exit 1
}

# 检查 Python
$pythonCmd = $null
foreach ($cmd in @("python", "python3", "py")) {
    try {
        $version = & $cmd --version 2>&1
        if ($version -match "3\.(\d+)") {
            $minor = [int]$matches[1]
            if ($minor -ge 10) {
                $pythonCmd = $cmd
                Write-Host "✅ Python: $version" -ForegroundColor Green
                break
            }
        }
    } catch {}
}

if (-not $pythonCmd) {
    Write-Host "❌ 未找到 Python 3.10+，请先安装" -ForegroundColor Red
    exit 1
}

# 创建虚拟环境
$VenvDir = Join-Path $ScriptDir ".venv"
if (-not (Test-Path $VenvDir)) {
    Write-Host "📦 创建虚拟环境..." -ForegroundColor Yellow
    & $pythonCmd -m venv $VenvDir
}

# 激活虚拟环境
$activateScript = Join-Path $VenvDir "Scripts\Activate.ps1"
if (Test-Path $activateScript) {
    & $activateScript
} else {
    Write-Host "❌ 虚拟环境激活脚本不存在: $activateScript" -ForegroundColor Red
    exit 1
}

# 安装依赖
Write-Host "📦 安装依赖..." -ForegroundColor Yellow
pip install --quiet -r (Join-Path $ScriptDir "requirements.txt")

# 安装 markitdown（从 vendor 目录源码）
Write-Host "📦 安装 markitdown (DOCX/XLSX/PDF/PPTX)..." -ForegroundColor Yellow
pip install --quiet -e "$MarkitdownSrc[docx,xlsx,pdf,pptx]"

# 启动服务
Write-Host ""
Write-Host "🚀 启动服务 (http://localhost:${Port}) ..." -ForegroundColor Green
Write-Host "   API 文档: http://localhost:${Port}/docs" -ForegroundColor Green
Write-Host ""

Set-Location $ScriptDir
$env:PORT = $Port
& python main.py
