@echo off
REM ============================================
REM 文件智能审查系统 - 离线镜像加载脚本
REM 用于内网环境加载离线 Docker 镜像
REM ============================================

echo ============================================
echo   开始加载离线镜像
echo ============================================
echo.

set SCRIPT_DIR=%~dp0

REM 加载所有 tar 镜像（主服务）
for %%f in ("%SCRIPT_DIR%\*.tar") do (
    echo 加载镜像: %%~nxf
    docker load -i "%%f"
)

REM 加载 MaxKB 镜像
if exist "%SCRIPT_DIR%\maxkb-images" (
    echo.
    echo 加载 MaxKB 镜像...
    for %%f in ("%SCRIPT_DIR%\maxkb-images\*") do (
        echo 加载: %%~nxf
        docker load -i "%%f"
    )
) else (
    echo [WARN] 未找到 maxkb-images 目录，MaxKB 镜像未加载
)

echo.
echo ============================================
echo   镜像加载完成!
echo ============================================
echo.
docker images | findstr /i "file-review pgvector redis maxkb"

echo.
pause
