@echo off
rem Double-click this file to play. It installs what is missing on the first
rem run, starts the dev server and opens the browser.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :no_node

if not exist "node_modules" (
  echo Installing dependencies. This happens once and takes a minute.
  echo.
  call npm install
  if errorlevel 1 goto :install_failed
  echo.
)

echo Starting the game. The browser opens by itself.
echo Press Ctrl+C or close this window to stop the server.
echo.
call npm start
goto :end

:no_node
echo Node.js was not found.
echo.
echo Install it from https://nodejs.org (LTS), then open this file again.
echo If you have just installed it, close this window and reopen it so that
echo Windows picks up the new PATH.
goto :end

:install_failed
echo.
echo npm install failed. The output above says why.

:end
echo.
pause
