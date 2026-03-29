@echo off
echo.
echo ===================================
echo   ENVIANDO MUDANCAS PARA O GITHUB
echo ===================================
echo.

set /p msg="Descricao da mudanca: "

git add .
git commit -m "%msg%"
git push

echo.
echo ===================================
echo   PRONTO! Site atualizando... 
echo   Aguarde ~1 minuto no Vercel.
echo ===================================
echo.
pause
