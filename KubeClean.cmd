@echo off
rem Builds the Rust core and the UI, then opens KubeClean.
cd /d "%~dp0app"
call npm start
