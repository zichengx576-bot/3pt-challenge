@echo off
chcp 65001 >nul
title 3PT Challenge Stopper
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-game.ps1"
if errorlevel 1 pause
