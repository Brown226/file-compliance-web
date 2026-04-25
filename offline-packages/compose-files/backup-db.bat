@echo off
REM ============================================
REM 文件智能审查系统 - 数据库备份脚本 (Windows)
REM 用法: backup-db.bat [备份文件名前缀]
REM 输出: backups\backup_YYYYMMDD_HHMMSS.sql
REM ============================================

setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "BACKUP_DIR=%SCRIPT_DIR%backups"

for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (
    set "TIMESTAMP=%%c%%a%%b"
)
for /f "tokens=1-2 delims=: " %%a in ('time /t') do (
    set "TIMESTAMP=!TIMESTAMP!_%%a%%b"
)
set "TIMESTAMP=!TIMESTAMP: =0!"

if "%~1"=="" (
    set "PREFIX=backup"
) else (
    set "PREFIX=%~1"
)

set "BACKUP_FILE=%BACKUP_DIR%\%PREFIX%_%TIMESTAMP%.sql"

REM 数据库连接信息
set "DB_USER=file_review_user"
set "DB_PASSWORD=file_review_password"
set "DB_NAME=file_review_db"

echo ============================================
echo   数据库备份
echo ============================================
echo.

REM 创建备份目录
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"

REM 检查 PostgreSQL 容器是否运行
docker ps | findstr "file_review_postgres" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] PostgreSQL 容器未运行，无法备份
    exit /b 1
)

REM 使用 Docker 容器执行备份
echo [INFO] 正在备份数据库...
docker exec file_review_postgres pgdump -U %DB_USER% -d %DB_NAME% --clean --if-exists > "%BACKUP_FILE%"

if errorlevel 1 (
    echo [ERROR] 备份失败
    del "%BACKUP_FILE%" 2>nul
    exit /b 1
)

echo [SUCCESS] 备份完成: %BACKUP_FILE%

REM 显示文件大小
for %%F in ("%BACKUP_FILE%") do (
    echo [INFO] 文件大小: %%~zF 字节
)

echo.
echo [INFO] 最近备份文件:
dir /b /o-d "%BACKUP_DIR%\*.sql" 2>nul | findstr /n "^" | findstr "^[1-5]:"

pause
