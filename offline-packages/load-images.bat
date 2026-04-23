@echo off
REM ============================================
REM ???????? - ????????
REM ????????????
REM ============================================

echo.
echo ============================================
echo   ???????? - ??????
echo ============================================
echo.

set SCRIPT_DIR=%~dp0

REM ?? Docker
docker --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker ???????? Docker Desktop
    pause
    exit /b 1
)

echo [INFO] ??? Docker
echo.

REM ???? tar ??
echo [INFO] ????????...
for %%%%f in ("%SCRIPT_DIR%\*.tar") do (
    if exist "%%%%f" (
        echo [INFO] ????: %%%%~nxf
        docker load -i "%%%%f"
        if errorlevel 1 (
            echo [ERROR] ????: %%%%~nxf
        ) else (
            echo [SUCCESS] ????: %%%%~nxf
        )
        echo.
    )
)

REM ?? MaxKB ??
if exist "%SCRIPT_DIR%\maxkb-images" (
    echo [INFO] ???? MaxKB ??...
    for %%%%f in ("%SCRIPT_DIR%\maxkb-images\*.tar") do (
        if exist "%%%%f" (
            echo [INFO] ??: %%%%~nxf
            docker load -i "%%%%f"
            if errorlevel 1 (
                echo [ERROR] ????: %%%%~nxf
            ) else (
                echo [SUCCESS] ????: %%%%~nxf
            )
            echo.
        )
    )
)

echo.
echo ============================================
echo   ??????!
echo ============================================
echo.
echo [INFO] ??????:
docker images | findstr /i "file-review pgvector redis maxkb"
echo.
echo [INFO] ?????:
echo   1. ?? compose-files ??????
echo   2. ?? compose-files ??
echo   3. ??: docker-compose -f docker-compose.offline.yml up -d
echo.
pause
