@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
rem Windows 前台启动入口，支持 Python Launcher 和 PATH 中的 Python。
pushd "%~dp0.." || exit /b 1
py -3 -c "import sys" >nul 2>&1
if not errorlevel 1 goto use_launcher
python -c "import sys; assert sys.version_info.major == 3" >nul 2>&1
if not errorlevel 1 goto use_python
echo 未找到 Python 3，请安装 Python 3.9 或更新版本，并勾选 Add python.exe to PATH。
popd
pause
exit /b 1

:use_launcher
py -3 -u backend\server.py %*
goto finished

:use_python
python -u backend\server.py %*

:finished
set "CODE=%ERRORLEVEL%"
popd
if not "%CODE%"=="0" pause
exit /b %CODE%
