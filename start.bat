@echo off
REM Generation Prompt v1 - tu cai dependencies, build client, chay ban EXE (Windows)
setlocal
cd /d "%~dp0"

REM ---- 1. Cai dependencies neu thieu ----
if not exist "server\node_modules" (
  echo [server] Cai dependencies...
  cmd /c "cd server && npm install"
  if errorlevel 1 goto :fail
)
if not exist "desktop\node_modules" (
  echo [client] Cai dependencies...
  cmd /c "cd desktop && npm install"
  if errorlevel 1 goto :fail
)

REM ---- 2. Build giao dien (tao desktop\dist) neu chua co ----
if not exist "desktop\dist\index.html" (
  echo [client] Build giao dien...
  cmd /c "cd desktop && npm run build"
  if errorlevel 1 goto :fail
)

REM ---- 3. Khoi dong server backend ----
echo [server] Khoi dong tai http://localhost:4000 ...
start "Generation Prompt - Server" cmd /k "cd /d %~dp0server && npm start"

REM ---- 4. Cho server san sang roi mo app EXE (Electron production) ----
echo [client] Cho server san sang...
cmd /c "cd desktop && node_modules\.bin\wait-on tcp:4000"

echo [client] Mo ung dung...
REM Xoa ELECTRON_RUN_AS_NODE (neu co) de electron chay dung che do GUI.
start "Generation Prompt - App" cmd /c "set ELECTRON_RUN_AS_NODE=&& cd /d %~dp0desktop && npm start"

echo Da khoi dong server va ung dung EXE.
endlocal
exit /b 0

:fail
echo.
echo [LOI] npm install/build that bai. Kiem tra Node.js da cai chua va thu lai.
pause
endlocal
exit /b 1
