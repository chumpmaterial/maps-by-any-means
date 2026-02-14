@echo off
setlocal

set SCRIPT_DIR=%~dp0
set REACT_DIR=%SCRIPT_DIR%..\react
set GO_DIR=%SCRIPT_DIR%go

echo Building React app...
cd /d "%REACT_DIR%"
call npm run build
if errorlevel 1 exit /b 1

echo Copying dist files...
if exist "%GO_DIR%\dist" rmdir /s /q "%GO_DIR%\dist"
xcopy /e /i /q "%REACT_DIR%\dist" "%GO_DIR%\dist"

echo Building executable...
cd /d "%GO_DIR%"
go build -ldflags="-s -w" -o "%SCRIPT_DIR%MBAM.exe" .
if errorlevel 1 exit /b 1

echo Done! Built %SCRIPT_DIR%MBAM.exe
