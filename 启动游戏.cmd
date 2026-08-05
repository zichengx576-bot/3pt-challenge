@echo off
chcp 65001 >nul
title 3PT Challenge Launcher
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-game.ps1"
if errorlevel 1 pause
