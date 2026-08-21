; Custom NSIS hook для Sazcord-инсталлятора.
; Подключается через `nsis.include` в desktop/package.json.
;
; Цель: какую бы папку юзер ни выбрал в визарде, файлы должны лечь
; в подпапку Sazcord. Пример:
;   юзер ввёл  C:\Apps           → реальная установка в  C:\Apps\Sazcord
;   юзер ввёл  D:\Games\Sazcord  → реальная установка в  D:\Games\Sazcord
;
; Делается через MUI_PAGE_CUSTOMFUNCTION_LEAVE — это callback страницы
; "выбор директории", который дёргается при клике "Далее".

!include "FileFunc.nsh"
!include "LogicLib.nsh"

!macro customHeader
  ; LEAVE-callback для MUI_PAGE_DIRECTORY должен быть определён ДО
  ; вставки самой страницы. customHeader вызывается в начале шаблона,
  ; а MUI_PAGE_DIRECTORY — позже, поэтому порядок корректный.
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE SazcordEnsureSubdir
!macroend

Function SazcordEnsureSubdir
  Push $0

  ; 1) Срезаем хвостовой backslash, если юзер ввёл "C:\Apps\".
  StrCpy $0 "$INSTDIR" 1 -1
  ${If} $0 == "\"
    StrCpy $INSTDIR "$INSTDIR" -1
  ${EndIf}

  ; 2) Если последняя часть пути уже Sazcord (case-insensitive в NSIS
  ;    LogicLib через ==/!=) — оставляем как есть. Иначе дописываем.
  ${GetFileName} "$INSTDIR" $0
  ${If} $0 != "Sazcord"
    StrCpy $INSTDIR "$INSTDIR\Sazcord"
  ${EndIf}

  Pop $0
FunctionEnd
