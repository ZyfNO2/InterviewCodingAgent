@echo off
chcp 65001 >nul
title Minimal Coding Agent - 一键启动器
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ======================================================================
echo           ⚡ Minimal Coding Agent - 一键启动与运行环境检测
echo ======================================================================
echo.

:: 1. 检查 Node.js 环境
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js 环境！
    echo 请先前往 https://nodejs.org/ 下载并安装 Node.js (推荐 v18 或更高版本)。
    echo.
    pause
    exit /b 1
)

:: 2. 检查依赖包 node_modules
if not exist "node_modules\" (
    echo [提示] 检测到尚未安装项目依赖包，正在自动执行 npm install ...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败，请检查网络或 npm 配置！
        pause
        exit /b 1
    )
    echo [成功] 依赖安装完成！
    echo.
)

:: 3. 检查环境配置文件 .env
if not exist ".env" (
    if exist ".env.example" (
        echo [提示] 未检测到 .env 配置文件，已从 .env.example 自动复制生成。
        echo [提示] 若需要连接真后端 LLM，请在 .env 中填入你的 OPENAI_API_KEY。
        copy ".env.example" ".env" >nul
    )
)

:: 4. 自动构建编译 TypeScript
if not exist "dist\" (
    echo [提示] 正在编译项目源码 (npm run build) ...
    call npm run build
    if %errorlevel% neq 0 (
        echo [错误] TypeScript 编译失败！
        pause
        exit /b 1
    )
    echo [成功] 编译完成！
    echo.
)

:MENU
echo ----------------------------------------------------------------------
echo 请选择运行模式 (输入数字后回车，默认 [1]):
echo.
echo   [1] 启动 WebUI 界面 (推荐 - 浏览器可视化交互，支持离线 Mock 与真后端 API)
echo   [2] 启动 CLI 交互式命令行终端
echo   [3] 重新编译项目源码 (npm run build)
echo   [4] 运行类型检查 (npm run typecheck)
echo   [0] 退出
echo ----------------------------------------------------------------------
set /p "CHOICE=请输入选项 [1-4, 0] (默认 1): "

if "%CHOICE%"=="" set CHOICE=1
if "%CHOICE%"=="1" goto START_WEB
if "%CHOICE%"=="2" goto START_CLI
if "%CHOICE%"=="3" goto REBUILD
if "%CHOICE%"=="4" goto TYPECHECK
if "%CHOICE%"=="0" goto EXIT_PROG

echo [提示] 无效输入，请输入 0 到 4 之间的数字。
echo.
goto MENU

:START_WEB
echo.
echo ======================================================================
echo 正在启动 Minimal Coding Agent WebUI 服务...
echo 默认地址: http://127.0.0.1:8046
echo 正在自动为您打开浏览器...
echo ======================================================================
echo.
:: 稍作延迟后在默认浏览器中打开 Web 界面
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:8046"
call npm run web
goto END

:START_CLI
echo.
echo ======================================================================
echo 正在启动 CLI 交互式终端...
echo 输入 /exit 即可退出交互。
echo ======================================================================
echo.
call npm start
goto END

:REBUILD
echo.
echo [提示] 正在重新执行构建编译...
call npm run build
if %errorlevel% equ 0 (
    echo [成功] 编译完成！
) else (
    echo [错误] 编译未通过！
)
echo.
goto MENU

:TYPECHECK
echo.
echo [提示] 正在执行全量类型检查...
call npm run typecheck
if %errorlevel% equ 0 (
    echo [成功] 类型检查 100%% 通过！
) else (
    echo [错误] 存在类型报错！
)
echo.
goto MENU

:EXIT_PROG
echo 感谢使用！
exit /b 0

:END
pause
