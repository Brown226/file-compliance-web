@echo off
REM ============================================
REM 文件智能审查系统 - 离线部署脚本 (Windows)
REM 使用 docker-compose 统一编排部署
REM 包含: PostgreSQL + Redis + MarkItDown + 后端 + 前端 + MaxKB
REM ============================================

setlocal enabledelayedexpansion

echo ============================================
echo   文件智能审查系统 - 离线部署
echo ============================================
echo.

REM 检查 Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker 未安装，请先安装 Docker
    pause
    exit /b 1
)

REM 检查 docker-compose
docker-compose --version >nul 2>&1
if errorlevel 1 (
    docker compose version >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] docker-compose 未安装
        pause
        exit /b 1
    )
    set COMPOSE_CMD=docker compose
) else (
    set COMPOSE_CMD=docker-compose
)

REM 获取脚本所在目录
set SCRIPT_DIR=%~dp0

REM 检查镜像是否已加载
echo [INFO] 检查 Docker 镜像...
docker images | findstr /i "file-review-backend" >nul 2>&1
if errorlevel 1 (
    echo [WARN] 未检测到预构建镜像，正在加载...
    if exist "%SCRIPT_DIR%load-images.bat" (
        call "%SCRIPT_DIR%load-images.bat"
    ) else (
        echo [ERROR] 镜像未加载且找不到 load-images.bat
        pause
        exit /b 1
    )
)

REM 进入 compose 配置目录
cd /d "%SCRIPT_DIR%compose-files"

REM 检查配置文件
if not exist "docker-compose.offline.yml" (
    echo [ERROR] 配置文件不存在: docker-compose.offline.yml
    pause
    exit /b 1
)

REM 加载 compose-files\.env（若存在），让端口检查与 compose 实际映射一致
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if /I "%%A"=="FRONTEND_PORT" set "FRONTEND_PORT=%%B"
        if /I "%%A"=="BACKEND_PORT" set "BACKEND_PORT=%%B"
        if /I "%%A"=="MAXKB_PORT" set "MAXKB_PORT=%%B"
        if /I "%%A"=="PARSER_PORT" set "PARSER_PORT=%%B"
        if /I "%%A"=="PG_PORT" set "PG_PORT=%%B"
        if /I "%%A"=="REDIS_PORT" set "REDIS_PORT=%%B"
    )
)

if not defined FRONTEND_PORT set "FRONTEND_PORT=80"
if not defined BACKEND_PORT set "BACKEND_PORT=3000"
if not defined MAXKB_PORT set "MAXKB_PORT=8080"
if not defined PARSER_PORT set "PARSER_PORT=8000"
if not defined PG_PORT set "PG_PORT=5432"
if not defined REDIS_PORT set "REDIS_PORT=6379"

REM ==========================================
REM 端口占用检测
REM ==========================================
echo.
echo [INFO] 检查端口占用情况...
set PORT_CONFLICT=0

REM 定义需要检测的端口: 变量名=端口号=服务描述
set "CHK_FRONTEND=FRONTEND_PORT=!FRONTEND_PORT!=前端Web"
set "CHK_BACKEND=BACKEND_PORT=!BACKEND_PORT!=后端API"
set "CHK_MAXKB=MAXKB_PORT=!MAXKB_PORT!=MaxKB"
set "CHK_PARSER=PARSER_PORT=!PARSER_PORT!=MarkItDown"
set "CHK_PG=PG_PORT=!PG_PORT!=PostgreSQL"
set "CHK_REDIS=REDIS_PORT=!REDIS_PORT!=Redis"

for /f "tokens=1,2,3 delims==" %%a in ("!CHK_FRONTEND!") do call :CHECK_PORT %%a %%b %%c
for /f "tokens=1,2,3 delims==" %%a in ("!CHK_BACKEND!") do call :CHECK_PORT %%a %%b %%c
for /f "tokens=1,2,3 delims==" %%a in ("!CHK_MAXKB!") do call :CHECK_PORT %%a %%b %%c
for /f "tokens=1,2,3 delims==" %%a in ("!CHK_PARSER!") do call :CHECK_PORT %%a %%b %%c
for /f "tokens=1,2,3 delims==" %%a in ("!CHK_PG!") do call :CHECK_PORT %%a %%b %%c
for /f "tokens=1,2,3 delims==" %%a in ("!CHK_REDIS!") do call :CHECK_PORT %%a %%b %%c


if "!PORT_CONFLICT!"=="1" (
    echo.
    echo [ERROR] 存在端口冲突，请先释放上述端口或修改 .env 文件中的端口映射
    echo [INFO] 可在 compose-files/ 目录下创建 .env 文件自定义端口，例如:
    echo     FRONTEND_PORT=8081
    echo     BACKEND_PORT=3001
    echo     MAXKB_PORT=8082
    pause
    exit /b 1
)

echo [OK] 所有端口均可用
echo.

REM ==========================================
REM 启动服务
REM ==========================================
echo [INFO] 使用 docker-compose 启动所有服务...
echo.

REM 清理本项目的旧容器（含旧版容器名，不影响其他项目）
echo [INFO] 清理本项目旧容器...
for %%c in (file_review_postgres file_review_redis file_review_markitdown file_review_maxkb_pgsql file_review_maxkb_redis file_review_maxkb file_review_backend file_review_frontend markitdown_service maxkb maxkb-pgsql maxkb-redis) do (
    docker rm -f %%c >nul 2>&1
)

REM 使用 docker-compose 启动（后台模式）
%COMPOSE_CMD% -f docker-compose.offline.yml up -d

if errorlevel 1 (
    echo [ERROR] 服务启动失败
    echo [INFO] 查看日志: %COMPOSE_CMD% -f docker-compose.offline.yml logs
    pause
    exit /b 1
)

echo.
echo [INFO] 等待服务就绪（约60秒，MaxKB 启动较慢）...
timeout /t 60 /nobreak >nul

REM 检查服务状态
echo.
echo ============================================
echo   服务状态
echo ============================================
%COMPOSE_CMD% -f docker-compose.offline.yml ps

echo.
echo ============================================
echo   部署完成!
echo ============================================
echo.
echo 访问地址:
echo   - Web UI:   http://localhost:%FRONTEND_PORT%
echo   - API:      http://localhost:%BACKEND_PORT%/api
echo   - MaxKB:    http://localhost:%MAXKB_PORT%
echo   - 健康检查:  http://localhost:%BACKEND_PORT%/health

echo.
echo 初始账号:
echo   - 管理员: admin / admin123
echo   - 主管:   zhangsan / 123456
echo   - 员工:   lisi / 123456
echo.
echo 常用命令:
echo   - 查看日志: %COMPOSE_CMD% -f docker-compose.offline.yml logs -f [服务名]
echo   - 停止服务: %COMPOSE_CMD% -f docker-compose.offline.yml down
echo   - 重启服务: %COMPOSE_CMD% -f docker-compose.offline.yml restart
echo.

pause
exit /b 0

:CHECK_PORT
set PVAR=%1
set PNUM=%2
set PNAME=%3
netstat -ano | findstr ":%PNUM% " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo   [占用] 端口 %PNUM% (%PNAME%) 已被占用
    set PORT_CONFLICT=1
) else (
    echo   [空闲] 端口 %PNUM% (%PNAME%)
)
goto :EOF
