; KnuDoc AI NSIS installer hooks (tauri.conf.json > bundle.windows.nsis.installerHooks).
; Keep this file ASCII only: NSIS reads an !include file without a BOM in the build machine's ANSI code page.
;
; The app adds its Explorer right-click menu itself (Settings, or "knudoc-ai.exe --shell-menu install"):
; one key per extension, HKCU\Software\Classes\SystemFileAssociations\<ext>\shell\KnuDoc, plus the folder menu
; HKCU\Software\Classes\Directory\shell\KnuDoc and Directory\Background\shell\KnuDoc (src-tauri/src/shell.rs,
; a unit test there checks this list against EXTS and FOLDER_KEYS). A real uninstall removes exactly those keys so no dead menu
; stays behind. They are kept when the uninstaller only clears the way for a newer version into the same folder:
;   $UpdateMode = 1     run with /UPDATE (updater)
;   $EXEDIR = $INSTDIR  run in place with _?= by a newer installer ("uninstall before installing", the default
;                       choice for a manual upgrade); a normal uninstall first copies itself to %TEMP%.

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
  ${AndIf} $EXEDIR != $INSTDIR
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.hwp\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.hwpx\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.hml\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.hwpml\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.docx\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.xls\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.xlsx\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pptx\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.png\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpg\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.jpeg\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.webp\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\Directory\shell\KnuDoc"
    DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\KnuDoc"
  ${EndIf}
!macroend
