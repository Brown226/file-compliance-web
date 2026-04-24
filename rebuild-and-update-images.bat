@echo off
chcp 65001 >nul
echo ========================================
echo 重新构建并更新离线镜像包
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] 重新构建后端镜像...
docker build -f Dockerfile.backend -t file-review-backend:v1.0 .
if errorlevel 1 (
    echo 错误: 后端镜像构建失败
    pause
    exit /b 1
)
echo ✓ 后端镜像构建成功
echo.

echo [2/3] 重新构建前端镜像...
docker build -f Dockerfile.frontend -t file-review-frontend:v1.0 .
if errorlevel 1 (
    echo 错误: 前端镜像构建失败
    pause
    exit /b 1
)
echo ✓ 前端镜像构建成功
echo.

echo [3/3] 导出镜像到离线包...
docker save file-review-backend:v1.0 -o offline-packages\backend-v1.0.tar
docker save file-review-frontend:v1.0 -o offline-packages\frontend-v1.0.tar

echo.
echo ========================================
echo 镜像更新完成！
echo ========================================
echo.
echo 已更新的镜像文件:
dir offline-packages\backend-v1.0.tar | findstr backend
dir offline-packages\frontend-v1.0.tar | findstr frontend
echo.
pause
