@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo O sistema ainda nao foi instalado.
  echo Execute primeiro o arquivo instalar.bat.
  pause
  exit /b 1
)
call .venv\Scripts\activate
streamlit run app.py
