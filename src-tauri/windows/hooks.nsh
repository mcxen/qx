!macro QX_STOP_EVERYTHING LABEL_PREFIX
  IfFileExists "$INSTDIR\resources\search\everything.exe" 0 ${LABEL_PREFIX}_done
  Push $R8
  Push $R9
  DetailPrint "Qx includes a private Everything instance for file search. Windows can keep its executable locked briefly while the service stops."
  DetailPrint "Stopping the Qx Everything background index"
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -exit'
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -stop-service'
  DetailPrint "Removing the Qx Everything indexing service"
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -uninstall-service'
  ; Everything's commands return before the service necessarily releases its
  ; executable. Probe write access for up to 65 seconds instead of relying on a
  ; short fixed sleep; voidtools notes service removal can take about a minute.
  StrCpy $R8 0
${LABEL_PREFIX}_wait_for_release:
  ClearErrors
  FileOpen $R9 "$INSTDIR\resources\search\everything.exe" a
  IfErrors ${LABEL_PREFIX}_still_locked ${LABEL_PREFIX}_released
${LABEL_PREFIX}_released:
  FileClose $R9
  DetailPrint "Qx Everything executable released after $R8 second(s)"
  Goto ${LABEL_PREFIX}_cleanup
${LABEL_PREFIX}_still_locked:
  IntOp $R8 $R8 + 1
  IntCmp $R8 65 ${LABEL_PREFIX}_timeout 0 ${LABEL_PREFIX}_timeout
  DetailPrint "Waiting for the Qx Everything service to release its executable ($R8/65 seconds)"
  Sleep 1000
  Goto ${LABEL_PREFIX}_wait_for_release
${LABEL_PREFIX}_timeout:
  Pop $R9
  Pop $R8
  MessageBox MB_OK|MB_ICONEXCLAMATION "Qx file search is still shutting down, so Windows is keeping resources\search\everything.exe in use. The installer waited 65 seconds and stopped before replacing files. Please fully quit Qx and run the installer again. Your separate Everything installation was not stopped." /SD IDOK
  Abort
${LABEL_PREFIX}_cleanup:
  Pop $R9
  Pop $R8
${LABEL_PREFIX}_done:
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro QX_STOP_EVERYTHING qx_preinstall
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Installing the Qx Everything indexing service"
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -install-service'
  ; Qx starts its Everything instance asynchronously on first launch. Starting
  ; the persistent process through nsExec would make NSIS wait for it to exit.
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro QX_STOP_EVERYTHING qx_preuninstall
!macroend
