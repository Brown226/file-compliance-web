@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ============================================
:: 文件智能审查系统 - 离线镜像加载脚本 (Windows)
:: 功能: 加载所有 Docker 镜像并验证
:: ============================================

echo.
echo ========================================
echo   文件智能审查系统 - 离线镜像加载
echo ========================================
echo.

:: 检查 Docker 是否安装
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] Docker 未安装或未添加到 PATH
    echo 请先安装 Docker Desktop: https://www.docker.com/products/docker-desktop
    pause
    exit /b 1
)

echo [检查] Docker 版本...
docker --version
if %errorlevel% neq 0 (
    echo [错误] Docker 命令执行失败
    pause
    exit /b 1
)
echo.

:: 定义镜像列表
set IMAGE_DIR=%~dp0
set TOTAL_IMAGES=6
set LOADED_COUNT=0
set FAILED_COUNT=0

echo [开始] 正在加载 Docker 镜像 (共 %TOTAL_IMAGES% 个)...
echo.

:: 1. 加载 PostgreSQL
echo [1/6] 加载 PostgreSQL 数据库镜像...
if exist "%IMAGE_DIR%pgvector-pg15.tar" (
    docker load -i "%IMAGE_DIR%pgvector-pg15.tar"
    if !errorlevel! equ 0 (
        echo       ✓ PostgreSQL 镜像加载成功
        set /a LOADED_COUNT+=1
    ) else (
        echo       ✗ PostgreSQL 镜像加载失败
        set /a FAILED_COUNT+=1
    )
) else (
    echo       ✗ 文件不存在: pgvector-pg15.tar
    set /a FAILED_COUNT+=1
)
echo.

:: 2. 加载 Redis
echo [2/6] 加载 Redis 缓存镜像...
if exist "%IMAGE_DIR%redis-7-alpine.tar" (
    docker load -i "%IMAGE_DIR%redis-7-alpine.tar"
    if !errorlevel! equ 0 (
        echo       ✓ Redis 镜像加载成功
        set /a LOADED_COUNT+=1
    ) else (
        echo       ✗ Redis 镜像加载失败
        set /a FAILED_COUNT+=1
    )
) else (
    echo       ✗ 文件不存在: redis-7-alpine.tar
    set /a FAILED_COUNT+=1
)
echo.

:: 3. 加载 MarkItDown
echo [3/6] 加载 MarkItDown 解析服务镜像...
if exist "%IMAGE_DIR%markitdown-v1.0.tar" (
    docker load -i "%IMAGE_DIR%markitdown-v1.0.tar"
    if !errorlevel! equ 0 (
        echo       ✓ MarkItDown 镜像加载成功
        set /a LOADED_COUNT+=1
    ) else (
        echo       ✗ MarkItDown 镜像加载失败
        set /a FAILED_COUNT+=1
    )
) else (
    echo       ✗ 文件不存在: markitdown-v1.0.tar
    set /a FAILED_COUNT+=1
)
echo.

:: 4. 加载后端
echo [4/6] 加载后端服务镜像...
if exist "%IMAGE_DIR%backend-v1.0.tar" (
    docker load -i "%IMAGE_DIR%backend-v1.0.tar"
    if !errorlevel! equ 0 (
        echo       ✓ 后端镜像加载成功
        set /a LOADED_COUNT+=1
    ) else (
        echo       ✗ 后端镜像加载失败
        set /a FAILED_COUNT+=1
    )
) else (
    echo       ✗ 文件不存在: backend-v1.0.tar
    set /a FAILED_COUNT+=1
)
echo.

:: 5. 加载前端
echo [5/6] 加载前端服务镜像...
if exist "%IMAGE_DIR%frontend-v1.0.tar" (
    docker load -i "%IMAGE_DIR%frontend-v1.0.tar"
    if !errorlevel! equ 0 (
        echo       ✓ 前端镜像加载成功
        set /a LOADED_COUNT+=1
    ) else (
        echo       ✗ 前端镜像加载失败
        set /a FAILED_COUNT+=1
    )
) else (
    echo       ✗ 文件不存在: frontend-v1.0.tar
    set /a FAILED_COUNT+=1
)
echo.

:: 6. 加载 MaxKB
echo [6/6] 加载 MaxKB 知识库镜像...
if exist "%IMAGE_DIR%maxkb-images\maxkb.tar.gz" (
    docker load -i "%IMAGE_DIR%maxkb-images\maxkb.tar.gz"
    if !errorlevel! equ 0 (
        echo       ✓ MaxKB 镜像加载成功
        set /a LOADED_COUNT+=1
    ) else (
        echo       ✗ MaxKB 镜像加载失败
        set /a FAILED_COUNT+=1
    )
) else (
    echo       ✗ 文件不存在: maxkb-images\maxkb.tar.gz
    set /a FAILED_COUNT+=1
)
echo.

:: 显示加载结果
echo ========================================
echo   镜像加载完成
echo ========================================
echo   成功: %LOADED_COUNT%/%TOTAL_IMAGES%
echo   失败: %FAILED_COUNT%/%TOTAL_IMAGES%
echo.

if %FAILED_COUNT% gtr 0 (
    echo [警告] 部分镜像加载失败，请检查文件完整性
    echo.
)

:: 显示已加载的镜像列表
echo [信息] 当前系统中的相关镜像:
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" | findstr /i "file-review pgvector redis maxkb markitdown"
echo.

if %LOADED_COUNT% equ %TOTAL_IMAGES% (
    echo [成功] 所有镜像加载完成！
    echo.
    echo 下一步: 运行 deploy-offline.bat 启动服务
    echo.
) else (
    echo [错误] 镜像加载不完整，无法启动服务
    echo.
)

pause
