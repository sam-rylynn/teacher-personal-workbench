@echo off
cd /d "%~dp0"
call npm run launch
if errorlevel 1 (
  echo.
  echo 启动未完成，请把上面的提示发给安装人员。
  pause
)
