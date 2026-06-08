# ============================================
# 文件智能审查系统 - 一键构建 & 导出脚本 (Windows)
# 功能: 编译前后端 -> 构建 Docker 镜像 -> 导出 .tar
#
# 用法:
#   .\offline-deploy\scripts\build-all.ps1          # 完整构建
# ============================================

param(
    [switch]$SkipOCR,       # 已废弃（OCR 已合并到 doc-parser）
    [switch]$SkipDocParser  # 跳过文档解析服务构建（已有 tar 时自动跳过）
)

$ErrorActionPreference = 'Stop'

# ---------- 颜色 ----------
$Cyan = [ConsoleColor]::Cyan
$Green = [ConsoleColor]::Green
$Yellow = [ConsoleColor]::Yellow
$Red = [ConsoleColor]::Red

function Write-Step { Write-Host "`n═══════════════════════════════" -ForegroundColor $Cyan; Write-Host "  $args" -ForegroundColor $Cyan; Write-Host "═══════════════════════════════" -ForegroundColor $Cyan }
function Write-Ok { Write-Host "  ✓ $args" -ForegroundColor $Green }
function Write-Warn { Write-Host "  ⚠ $args" -ForegroundColor $Yellow }
function Write-Err { Write-Host "  ✗ $args" -ForegroundColor $Red; exit 1 }

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Resolve-Path "$ScriptDir\..\.."
$OfflineDir = Resolve-Path "$ScriptDir\.."
$ImageDir = "$OfflineDir\images"

Write-Host "============================================" -ForegroundColor $Cyan
Write-Host "  文件智能审查系统 - 镜像构建与导出" -ForegroundColor $Cyan
Write-Host "============================================" -ForegroundColor $Cyan
Write-Host ""
Write-Host "  项目根目录:  $ProjectRoot"
Write-Host "  离线包目录:  $OfflineDir"
Write-Host "  镜像输出:    $ImageDir"
Write-Host ""

# 创建镜像输出目录
if (!(Test-Path $ImageDir)) { New-Item -ItemType Directory -Path $ImageDir | Out-Null }

# ==========================================
# 步骤 1: 编译前端
# ==========================================
Write-Step "[1/5] 编译前端 (npm run build)..."
Push-Location "$ProjectRoot\frontend"

if (!(Test-Path "node_modules")) {
    Write-Host "  安装前端依赖..."
    npm install
}

npm run build
if ($LASTEXITCODE -ne 0) { Write-Err "前端编译失败" }
Write-Ok "前端编译完成 -> frontend/dist/"

Pop-Location

# ==========================================
# 步骤 2: 编译后端
# ==========================================
Write-Step "[2/5] 编译后端 (tsc)..."
Push-Location "$ProjectRoot\backend"

if (!(Test-Path "node_modules")) {
    Write-Host "  安装后端依赖..."
    npm ci
}

# 生成 Prisma Client
npx prisma generate
Write-Ok "Prisma Client 生成完成"

# 编译 TypeScript
npx tsc
if ($LASTEXITCODE -ne 0) { Write-Err "后端编译失败" }
Write-Ok "后端编译完成 -> backend/dist/"

Pop-Location

# ==========================================
# 步骤 3: 构建 Docker 镜像
# ==========================================
Write-Step "[3/5] 构建 Docker 镜像..."

# 3a. 前端镜像
Write-Host "  构建: file-review-frontend:v2.0 ..."
docker build -f "$ProjectRoot\Dockerfile.frontend" -t file-review-frontend:v2.0 "$ProjectRoot"
if ($LASTEXITCODE -ne 0) { Write-Err "前端镜像构建失败" }
Write-Ok "前端镜像构建完成"

# 3b. 后端镜像
Write-Host "  构建: file-review-backend:v2.0 ..."
if (!(Test-Path "$ProjectRoot\.env.production")) {
    Copy-Item "$OfflineDir\compose-files\.env.production" "$ProjectRoot\.env.production"
    Write-Warn "复制 .env.production 到项目根目录（供 Dockerfile 使用）"
}
docker build -f "$ProjectRoot\Dockerfile.backend" -t file-review-backend:v2.0 "$ProjectRoot"
if ($LASTEXITCODE -ne 0) { Write-Err "后端镜像构建失败" }
Write-Ok "后端镜像构建完成"

# 3c. 文档解析服务镜像（检查是否已存在 tar）
$docParserTar = "$ImageDir\doc-parser-v1.0.tar"
if ($SkipDocParser -or (Test-Path $docParserTar)) {
    if (Test-Path $docParserTar) {
        $size = [math]::Round((Get-Item $docParserTar).Length / 1MB, 1)
        Write-Warn "doc-parser-v1.0.tar 已存在 ($size MB)，跳过构建"
    } else {
        Write-Warn "跳过文档解析服务构建（-SkipDocParser）"
    }
} else {
    $docParserDf = "$ProjectRoot\backend\doc-parser\Dockerfile"
    if (Test-Path $docParserDf) {
        Write-Host "  构建: file-review-doc-parser:v1.0 ..."
        docker build -f $docParserDf -t file-review-doc-parser:v1.0 "$ProjectRoot\backend\doc-parser"
        if ($LASTEXITCODE -ne 0) { Write-Err "文档解析镜像构建失败" }
        Write-Ok "文档解析服务镜像构建完成"
    } else {
        Write-Warn "backend/doc-parser/Dockerfile 不存在，跳过构建（如需构建请手动准备源码）"
    }
}

# 3d. OCR 服务已废弃 — 功能合并到 doc-parser（视觉模型 OCR）
# 保留注释供参考：原 OCR 镜像构建不再需要

# ==========================================
# 步骤 4: 导出镜像为 .tar
# ==========================================
Write-Step "[4/5] 导出镜像为 tar 文件..."

# 自定义镜像
$customImages = @(
    @{ Name = "file-review-frontend:v2.0"; File = "frontend-v2.0.tar" },
    @{ Name = "file-review-backend:v2.0"; File = "backend-v2.0.tar" },
    @{ Name = "file-review-doc-parser:v1.0"; File = "doc-parser-v1.0.tar" }
)



foreach ($img in $customImages) {
    $tarPath = "$ImageDir\$($img.File)"
    if (Test-Path $tarPath) {
        $size = [math]::Round((Get-Item $tarPath).Length / 1MB, 1)
        Write-Warn "$($img.File) 已存在 ($size MB)，跳过导出"
        continue
    }
    Write-Host "  导出: $($img.Name) -> $($img.File)"
    docker save -o $tarPath $img.Name
    if ($LASTEXITCODE -eq 0) {
        $size = [math]::Round((Get-Item $tarPath).Length / 1MB, 1)
        Write-Ok "$($img.File) ($size MB)"
    } else {
        Write-Err "$($img.File) 导出失败"
    }
}

# 导出基础镜像（检查本地是否存在）
Write-Step "检查并导出基础镜像..."

$baseImages = @(
    @{ Name = "pgvector/pgvector:pg15"; File = "pgvector-pg15.tar" },
    @{ Name = "redis:7-alpine"; File = "redis-7-alpine.tar" }
)

foreach ($img in $baseImages) {
    $tarPath = "$ImageDir\$($img.File)"
    $exists = docker images --format "{{.Repository}}:{{.Tag}}" | Where-Object { $_ -eq $img.Name }
    if ($exists) {
        Write-Host "  导出: $($img.Name) -> $($img.File)"
        docker save -o $tarPath $img.Name
        if ($LASTEXITCODE -eq 0) {
            $size = [math]::Round((Get-Item $tarPath).Length / 1MB, 1)
            Write-Ok "$($img.File) ($size MB)"
        }
    } else {
        Write-Warn "$($img.Name) 本地不存在，跳过（可从旧 offline-packages/ 迁入）"
    }
}

# ==========================================
# 步骤 5: 同步配置文件
# ==========================================
Write-Step "[5/5] 同步配置文件..."

# 从项目根目录同步最新的 nginx.conf
Copy-Item "$ProjectRoot\nginx.conf" "$OfflineDir\compose-files\nginx.conf" -Force
Write-Ok "nginx.conf 已同步"

# 同步 .env.production（如果存在）
if (Test-Path "$ProjectRoot\.env.production") {
    Copy-Item "$ProjectRoot\.env.production" "$OfflineDir\compose-files\.env.production" -Force
    Write-Ok ".env.production 已同步"
}

# 同步 init-db.sql
Copy-Item "$ProjectRoot\backend\prisma\init-db.sql" "$OfflineDir\compose-files\init-db.sql" -Force
Write-Ok "init-db.sql 已同步"

# ==========================================
# 汇总
# ==========================================
Write-Host "`n============================================" -ForegroundColor $Cyan
Write-Host "  构建与导出完成!" -ForegroundColor $Green
Write-Host "============================================" -ForegroundColor $Cyan
Write-Host ""
Write-Host "  离线包位置: $OfflineDir"
Write-Host ""

# 列出镜像文件
Get-ChildItem "$ImageDir\*.tar" | ForEach-Object {
    $size = [math]::Round($_.Length / 1MB, 1)
    Write-Host "    $($_.Name)  ($size MB)"
}

$totalSize = [math]::Round((Get-ChildItem "$ImageDir\*.tar" | Measure-Object -Property Length -Sum).Sum / 1GB, 2)
Write-Host "`n  镜像总大小: $totalSize GB" -ForegroundColor $Cyan
Write-Host ""
Write-Host "  下一步: 将 offline-deploy/ 整个目录拷到 U盘，带到内网服务器运行" -ForegroundColor $Yellow
Write-Host "          cd offline-deploy && bash scripts/deploy-offline.sh" -ForegroundColor $Yellow
Write-Host ""
