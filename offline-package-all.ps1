# ============================================
# 文件智能审查系统 - 离线镜像打包脚本 (Windows)
# 功能: 构建所有 Docker 镜像并导出为 tar 文件
# ============================================

param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$OUTPUT_DIR = Join-Path $SCRIPT_DIR "offline-packages"

function Write-Info($msg) {
    Write-Host "[INFO] $msg" -ForegroundColor Cyan
}

function Write-Success($msg) {
    Write-Host "[SUCCESS] $msg" -ForegroundColor Green
}

function Write-Warn($msg) {
    Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

function Write-Err($msg) {
    Write-Host "[ERROR] $msg" -ForegroundColor Red
}

# 创建输出目录
if (-not (Test-Path $OUTPUT_DIR)) {
    New-Item -ItemType Directory -Path $OUTPUT_DIR | Out-Null
}

Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  文件智能审查系统 - 离线镜像打包" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""

# 检查 Docker
try {
    $dockerVersion = docker --version 2>&1
    Write-Info "检测到 Docker: $dockerVersion"
} catch {
    Write-Err "Docker 未安装，请先安装 Docker Desktop"
    exit 1
}

Set-Location $SCRIPT_DIR

# ==========================================
# 步骤 0: 编译前端和后端（必须先编译，Docker 镜像需要产物）
# ==========================================
if (-not $SkipBuild) {
    Write-Info "步骤 0: 编译前端和后端..."

    # 编译前端
    Write-Info "编译前端..."
    Push-Location ".\frontend"
    npm run build 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Err "前端编译失败"
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Success "前端编译完成"

    # 编译后端
    Write-Info "编译后端..."
    Push-Location ".\backend"
    npm run build 2>&1 | Write-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Err "后端编译失败"
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Success "后端编译完成"
} else {
    Write-Warn "跳过编译步骤（-SkipBuild）"
}

# 1. 导出 pgvector 镜像
Write-Info "步骤 1/7: 处理 PostgreSQL (pgvector) 镜像..."
$PG_IMAGE = "pgvector/pgvector:pg15"
$PG_OUTPUT = Join-Path $OUTPUT_DIR "pgvector-pg15.tar"

if (docker image inspect $PG_IMAGE 2>$null) {
    if (-not (Test-Path $PG_OUTPUT)) {
        Write-Info "导出镜像: $PG_IMAGE -> $PG_OUTPUT"
        docker save -o $PG_OUTPUT $PG_IMAGE
        Write-Success "已导出: $PG_OUTPUT"
    } else {
        Write-Warn "已存在，跳过: $PG_OUTPUT"
    }
} else {
    Write-Err "镜像不存在，请先拉取: docker pull $PG_IMAGE"
}

# 2. 导出 Redis 镜像
Write-Info "步骤 2/7: 处理 Redis 镜像..."
$REDIS_IMAGE = "redis:7-alpine"
$REDIS_OUTPUT = Join-Path $OUTPUT_DIR "redis-7-alpine.tar"

if (docker image inspect $REDIS_IMAGE 2>$null) {
    if (-not (Test-Path $REDIS_OUTPUT)) {
        Write-Info "导出镜像: $REDIS_IMAGE -> $REDIS_OUTPUT"
        docker save -o $REDIS_OUTPUT $REDIS_IMAGE
        Write-Success "已导出: $REDIS_OUTPUT"
    } else {
        Write-Warn "已存在，跳过: $REDIS_OUTPUT"
    }
} else {
    Write-Err "镜像不存在，请先拉取: docker pull $REDIS_IMAGE"
}

# 3. 构建 MarkItDown 镜像
Write-Info "步骤 3/7: 构建 MarkItDown 文档解析服务..."
$MARKITDOWN_IMAGE = "file-review-markitdown:v1.0"
$MARKITDOWN_CONTEXT = ".\backend\markitdown-service"
$MARKITDOWN_DOCKERFILE = Join-Path $MARKITDOWN_CONTEXT "Dockerfile"

if (Test-Path $MARKITDOWN_DOCKERFILE) {
    Write-Info "构建镜像: $MARKITDOWN_IMAGE"
    docker build -t $MARKITDOWN_IMAGE -f $MARKITDOWN_DOCKERFILE $MARKITDOWN_CONTEXT
    
    $MARKITDOWN_OUTPUT = Join-Path $OUTPUT_DIR "markitdown-v1.0.tar"
    docker save -o $MARKITDOWN_OUTPUT $MARKITDOWN_IMAGE
    Write-Success "已导出: $MARKITDOWN_OUTPUT"
} else {
    Write-Err "Dockerfile 不存在: $MARKITDOWN_DOCKERFILE"
}

# 4. 构建后端镜像
Write-Info "步骤 4/7: 构建后端 API 服务..."
$BACKEND_IMAGE = "file-review-backend:v1.0"
$BACKEND_DOCKERFILE = ".\Dockerfile.backend"

if (Test-Path $BACKEND_DOCKERFILE) {
    Write-Info "构建镜像: $BACKEND_IMAGE"
    docker build -t $BACKEND_IMAGE -f $BACKEND_DOCKERFILE .
    
    $BACKEND_OUTPUT = Join-Path $OUTPUT_DIR "backend-v1.0.tar"
    docker save -o $BACKEND_OUTPUT $BACKEND_IMAGE
    Write-Success "已导出: $BACKEND_OUTPUT"
} else {
    Write-Err "Dockerfile.backend 不存在"
}

# 5. 构建前端镜像
Write-Info "步骤 5/7: 构建前端 Web 服务..."
$FRONTEND_IMAGE = "file-review-frontend:v1.0"
$FRONTEND_DOCKERFILE = ".\Dockerfile.frontend"

if (Test-Path $FRONTEND_DOCKERFILE) {
    Write-Info "构建镜像: $FRONTEND_IMAGE"
    docker build -t $FRONTEND_IMAGE -f $FRONTEND_DOCKERFILE .
    
    $FRONTEND_OUTPUT = Join-Path $OUTPUT_DIR "frontend-v1.0.tar"
    docker save -o $FRONTEND_OUTPUT $FRONTEND_IMAGE
    Write-Success "已导出: $FRONTEND_OUTPUT"
} else {
    Write-Err "Dockerfile.frontend 不存在"
}

# 6. 处理 MaxKB 镜像
Write-Info "步骤 6/7: 处理 MaxKB 知识库镜像..."
$MAXKB_SOURCE = ".\maxkb-v2.8.0-x86_64-offline-installer\maxkb-v2.8.0-x86_64-offline-installer\images"
$MAXKB_OUTPUT = Join-Path $OUTPUT_DIR "maxkb-images"

if (Test-Path $MAXKB_SOURCE) {
    Write-Info "找到 MaxKB 离线镜像目录: $MAXKB_SOURCE"
    if (-not (Test-Path $MAXKB_OUTPUT)) {
        New-Item -ItemType Directory -Path $MAXKB_OUTPUT | Out-Null
    }
    
    Get-ChildItem $MAXKB_SOURCE -Filter "*.tar" | ForEach-Object {
        $destPath = Join-Path $MAXKB_OUTPUT $_.Name
        Copy-Item $_.FullName -Destination $destPath -Force
        Write-Success "复制: $($_.Name)"
    }
} else {
    Write-Warn "MaxKB 离线镜像目录不存在，跳过"
}

# 7. 复制部署配置文件
Write-Info "步骤 7/7: 复制部署配置文件..."
$COMPOSE_OUTPUT = Join-Path $OUTPUT_DIR "compose-files"
if (-not (Test-Path $COMPOSE_OUTPUT)) {
    New-Item -ItemType Directory -Path $COMPOSE_OUTPUT | Out-Null
}

$configFiles = @(
    "docker-compose.complete.yml",
    "docker-compose.offline.yml",
    ".env.offline",
    ".env.production",
    "nginx.conf",
    "backend\prisma\init-db.sql"
)

foreach ($file in $configFiles) {
    if (Test-Path $file) {
        $dest = Join-Path $COMPOSE_OUTPUT (Split-Path $file -Leaf)
        Copy-Item $file -Destination $dest -Force
        Write-Info "复制: $file -> $COMPOSE_OUTPUT"
    }
}

# 复制 Prisma 迁移目录
$migrationsSrc = "backend\prisma\migrations"
$migrationsDest = Join-Path $COMPOSE_OUTPUT "backend\prisma\migrations"
if (Test-Path $migrationsSrc) {
    if (Test-Path $migrationsDest) { Remove-Item $migrationsDest -Recurse -Force }
    Copy-Item $migrationsSrc -Destination $migrationsDest -Recurse -Force
    Write-Info "复制: $migrationsSrc -> $migrationsDest"
}

# 复制部署脚本和文档
$deployScripts = @(
    "offline-packages\deploy-offline.bat",
    "offline-packages\deploy-offline.sh",
    "offline-packages\load-images.bat",
    "offline-packages\load-images.sh",
    "offline-packages\DEPLOYMENT.md",
    "offline-packages\QUICK-REFERENCE.md",
    "offline-packages\CHECKLIST.txt"
)

foreach ($file in $deployScripts) {
    if (Test-Path $file) {
        $dest = Join-Path $OUTPUT_DIR (Split-Path $file -Leaf)
        Copy-Item $file -Destination $dest -Force
    }
}

# 复制 MaxKB 运行时配置
$maxkbRuntimeDest = Join-Path $OUTPUT_DIR "maxkb-runtime"
if (Test-Path "maxkb-runtime") {
    if (Test-Path $maxkbRuntimeDest) { Remove-Item $maxkbRuntimeDest -Recurse -Force }
    Copy-Item "maxkb-runtime" -Destination $maxkbRuntimeDest -Recurse -Force
    Write-Info "复制: maxkb-runtime -> $maxkbRuntimeDest"
}

Write-Success "配置文件已复制到: $COMPOSE_OUTPUT"

# 生成镜像加载脚本
Write-Host ""
Write-Info "生成镜像加载脚本..."

$loadScript = @'
@echo off
REM 离线镜像加载脚本
REM 在目标服务器上执行

echo ============================================
echo   开始加载离线镜像
echo ============================================

set SCRIPT_DIR=%~dp0

REM 加载所有 tar 镜像
for %%f in ("%SCRIPT_DIR%\*.tar") do (
    echo 加载镜像: %%~nxf
    docker load -i "%%f"
)

REM 加载 MaxKB 镜像
if exist "%SCRIPT_DIR%\maxkb-images" (
    echo.
    echo 加载 MaxKB 镜像...
    for %%f in ("%SCRIPT_DIR%\maxkb-images\*.tar") do (
        echo 加载: %%~nxf
        docker load -i "%%f"
    )
)

echo.
echo 镜像加载完成!
docker images | findstr /i "file-review pgvector redis maxkb"

pause
'@

$loadScriptPath = Join-Path $OUTPUT_DIR "load-images.bat"
Set-Content -Path $loadScriptPath -Value $loadScript -Encoding ASCII
Write-Success "已生成镜像加载脚本: $loadScriptPath"

# 复制预编写的部署脚本（使用 docker-compose，替代旧的 --link 方式）
$deployScripts = @("deploy.bat", "deploy.sh")
foreach ($script in $deployScripts) {
    $src = Join-Path $OUTPUT_DIR $script
    if (Test-Path $src) {
        Write-Info "部署脚本已存在: $src"
    }
}

# 输出结果
Write-Host ""
Write-Host "============================================" -ForegroundColor Magenta
Write-Host "  镜像打包完成!" -ForegroundColor Magenta
Write-Host "============================================" -ForegroundColor Magenta
Write-Host ""
Write-Info "镜像清单:"
Write-Host ""

Get-ChildItem $OUTPUT_DIR -File | Where-Object { $_.Extension -eq ".tar" } | ForEach-Object {
    $size = "{0:N2}" -f ($_.Length / 1MB)
    Write-Host "  $($_.Name) ($size MB)"
}

Get-ChildItem $OUTPUT_DIR -Directory | ForEach-Object {
    Write-Host "  $($_.Name)/"
    Get-ChildItem $_.FullName -File | ForEach-Object {
        $size = "{0:N2}" -f ($_.Length / 1MB)
        Write-Host "    $($_.Name) ($size MB)"
    }
}

Write-Host ""
$totalSize = Get-ChildItem $OUTPUT_DIR -Recurse | Measure-Object -Property Length -Sum
$totalSizeMB = "{0:N2}" -f ($totalSize.Sum / 1MB)
Write-Info "总大小: $totalSizeMB MB"
Write-Host ""
Write-Success "离线打包完成! 文件位于: $OUTPUT_DIR"
