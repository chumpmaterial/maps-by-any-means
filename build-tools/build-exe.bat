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

echo Embedding icon...
copy "%REACT_DIR%\public\favicon.ico" "%GO_DIR%\favicon.ico"
go install github.com/akavel/rsrc@latest
cd /d "%GO_DIR%"
rsrc -ico favicon.ico -o rsrc.syso
if errorlevel 1 exit /b 1
del favicon.ico

echo Building executable...
go build -ldflags="-s -w" -o "%SCRIPT_DIR%MBAM.exe" .
if errorlevel 1 exit /b 1
del rsrc.syso

echo Done! Built %SCRIPT_DIR%MBAM.exe
