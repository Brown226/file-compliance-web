@echo off
chcp 65001 >nul
echo ========================================
echo   快速构建前端（跳过类型检查）
echo ========================================
echo.

cd frontend

echo [1/3] 清理旧的构建文件...
if exist dist rmdir /s /q dist

echo [2/3] 执行 Vite 构建（跳过 TypeScript 类型检查）...
npx vite build --mode production

if %errorlevel% neq 0 (
    echo.
    echo ❌ 构建失败！
    exit /b 1
)

echo.
echo [3/3] 构建成功！
echo.
echo ✅ 前端文件已生成到 frontend/dist/
echo.
echo 下一步操作：
echo   1. 重新构建 Docker 镜像: docker build -f Dockerfile.frontend -t file-review-frontend:v1.1 .
echo   2. 更新离线包: docker save file-review-frontend:v1.1 -o offline-packages\frontend-v1.1.tar
echo   3. 重启容器: docker restart file_review_frontend
echo.

cd ..
pause
