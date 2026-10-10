@echo off
rem Entry point for the Windows scheduled task (see scripts/install-task.ps1).
rem Appends each run's output to logs\scan.log.
cd /d "%~dp0.."
if not exist logs mkdir logs
echo. >> logs\scan.log
node src\main.js >> logs\scan.log 2>&1
