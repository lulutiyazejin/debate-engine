@echo off
rem Debate Engine 0.1.0 安装脚本：复制程序到用户目录并写入 PATH
setlocal
chcp 65001 >nul
set "TARGET=%LOCALAPPDATA%\Programs\DebateEngine"

echo ============================================
echo  Debate Engine 0.1.0 安装程序
echo ============================================
echo 安装位置: %TARGET%
echo.

if exist "%TARGET%" (
    echo 检测到旧版本，正在覆盖更新...
)
xcopy /E /I /Y "%~dp0DebateEngine" "%TARGET%" >nul
if errorlevel 1 (
    echo [错误] 文件复制失败，安装中止。
    pause
    exit /b 1
)

rem 初始化知识库目录（含预置 Skill 文件，不覆盖已有）
if not exist "%TARGET%\knowledge_base" (
    xcopy /E /I /Y "%~dp0knowledge_base" "%TARGET%\knowledge_base" >nul
)

rem 写入用户 PATH（若尚未包含）
echo %PATH% | find /i "%TARGET%" >nul
if errorlevel 1 (
    for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USERPATH=%%b"
    setx PATH "%USERPATH%;%TARGET%" >nul
    echo 已将安装目录加入用户 PATH（重新打开终端后生效）。
)

echo.
echo 安装完成！使用方法（新开终端）:
echo   DebateEngine health                          检查依赖状态
echo   DebateEngine import 文档.pdf --stance liberal  导入文档
echo   DebateEngine rebut "论点" --stance liberal     生成反驳
echo   DebateEngine serve                           启动 API 服务(127.0.0.1:7700)
echo.
pause
