@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 半场有球雷达
if not exist node_modules (
  echo 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
start "" http://127.0.0.1:4173
call npm run dev
if errorlevel 1 pause
