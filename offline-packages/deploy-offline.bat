@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

:: ============================================
:: 文件智能审查系统 - 一键离线部署脚本 (Windows)
:: 功能: 加载镜像 -> 初始化环境 -> 启动服务 -> 健康检查
:: ============================================

echo.
echo ========================================
echo   文件智能审查系统 - 一键离线部署
echo ========================================
echo.

:: 检查 Docker 是否安装
where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] Docker 未安装或未添加到 PATH
    pause
    exit /b 1
)

where docker-compose >nul 2>nul
if %errorlevel% neq 0 (
    :: 尝试新的 docker compose 命令
    docker compose version >nul 2>nul
    if %errorlevel% neq 0 (
        echo [错误] Docker Compose 未安装
        echo 请确保 Docker Desktop 已安装并启用 Compose 插件
        pause
        exit /b 1
    )
    set COMPOSE_CMD=docker compose
) else (
    set COMPOSE_CMD=docker-compose
)

echo [检查] Docker Compose 版本...
%COMPOSE_CMD% version
echo.

:: 切换到 compose-files 目录
cd /d "%~dp0compose-files"

:: 检查环境变量文件
if not exist ".env.offline" (
    echo [错误] 配置文件缺失: .env.offline
    pause
    exit /b 1
)

echo [步骤 1/4] 检查并加载 Docker 镜像...
echo.
cd ..
call load-images.bat
if %errorlevel% neq 0 (
    echo [错误] 镜像加载失败
    pause
    exit /b 1
)
cd compose-files
echo.

echo [步骤 2/4] 初始化环境配置...
echo.
:: 复制环境变量文件
if exist ".env.production" (
    copy /Y ".env.production" ".env" >nul
    echo       ✓ 环境配置文件已就绪
) else (
    echo       ⚠ 使用默认配置
)
echo.

echo [步骤 3/4] 启动所有服务...
echo.
echo       正在启动容器组，请稍候...
echo       (首次启动可能需要 2-3 分钟)
echo.

%COMPOSE_CMD% -f docker-compose.offline.yml up -d

if %errorlevel% neq 0 (
    echo.
    echo [错误] 服务启动失败
    echo 请检查日志: %COMPOSE_CMD% -f docker-compose.offline.yml logs
    pause
    exit /b 1
)

echo       ✓ 容器启动命令已发送
echo.

echo [步骤 4/4] 服务健康检查...
echo.

:: 等待服务启动
echo       等待服务初始化 (30秒)...
timeout /t 30 /nobreak >nul

:: 检查各个服务状态
set CHECK_PASSED=0
set CHECK_TOTAL=6

echo       检查 PostgreSQL 数据库...
%COMPOSE_CMD% -f docker-compose.offline.yml ps postgres | findstr "Up" >nul
if !errorlevel! equ 0 (
    echo         ✓ PostgreSQL 运行正常
    set /a CHECK_PASSED+=1
) else (
    echo         ✗ PostgreSQL 启动异常
)

echo       检查 Redis 缓存...
%COMPOSE_CMD% -f docker-compose.offline.yml ps redis | findstr "Up" >nul
if !errorlevel! equ 0 (
    echo         ✓ Redis 运行正常
    set /a CHECK_PASSED+=1
) else (
    echo         ✗ Redis 启动异常
)

echo       检查 MarkItDown 解析服务...
%COMPOSE_CMD% -f docker-compose.offline.yml ps markitdown | findstr "Up" >nul
if !errorlevel! equ 0 (
    echo         ✓ MarkItDown 运行正常
    set /a CHECK_PASSED+=1
) else (
    echo         ✗ MarkItDown 启动异常
)

echo       检查后端 API 服务...
%COMPOSE_CMD% -f docker-compose.offline.yml ps backend | findstr "Up" >nul
if !errorlevel! equ 0 (
    echo         ✓ 后端服务运行正常
    set /a CHECK_PASSED+=1
) else (
    echo         ✗ 后端服务启动异常
)

echo       检查前端 Web 服务...
%COMPOSE_CMD% -f docker-compose.offline.yml ps frontend | findstr "Up" >nul
if !errorlevel! equ 0 (
    echo         ✓ 前端服务运行正常
    set /a CHECK_PASSED+=1
) else (
    echo         ✗ 前端服务启动异常
)

echo       检查 MaxKB 知识库...
%COMPOSE_CMD% -f docker-compose.offline.yml ps maxkb | findstr "Up" >nul
if !errorlevel! equ 0 (
    echo         ✓ MaxKB 运行正常
    set /a CHECK_PASSED+=1
) else (
    echo         ✗ MaxKB 启动异常（可能仍在初始化，MaxKB 首次启动需 2-3 分钟）
)

echo.
echo ========================================
echo   部署结果
echo ========================================
echo   健康检查: %CHECK_PASSED%/%CHECK_TOTAL% 通过
echo.

if %CHECK_PASSED% equ %CHECK_TOTAL% (
    echo [成功] 系统部署完成！
    echo.
    echo 📊 访问地址:
    echo    前端界面: http://localhost
    echo    后端API:  http://localhost:3000/api
    echo    健康检查: http://localhost:3000/health
    echo.
    echo 🔑 默认账号:
    echo    用户名: admin
    echo    密码:   admin123
    echo.
    echo 📝 常用命令:
    echo    查看日志:   %COMPOSE_CMD% -f docker-compose.offline.yml logs -f
    echo    停止服务:   %COMPOSE_CMD% -f docker-compose.offline.yml down
    echo    重启服务:   %COMPOSE_CMD% -f docker-compose.offline.yml restart
    echo.
) else (
    echo [警告] 部分服务启动异常
    echo.
    echo 请执行以下命令查看详细日志:
    echo   %COMPOSE_CMD% -f docker-compose.offline.yml logs
    echo.
)

pause
