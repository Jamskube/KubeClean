@echo off
rem Starts KubeClean: a local server on 127.0.0.1 and an Edge window. Closes itself with the window.
cd /d "%~dp0"
start "KubeClean" /min node "%~dp0server.mjs"
