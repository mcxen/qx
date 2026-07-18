!macro QX_STOP_EVERYTHING LABEL_PREFIX
  IfFileExists "$INSTDIR\resources\search\everything.exe" 0 ${LABEL_PREFIX}_done
  DetailPrint "Stopping the Qx Everything background index"
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -exit'
  Sleep 500
  DetailPrint "Removing the Qx Everything indexing service"
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -uninstall-service'
  ; Everything may return before its process and service release the executable.
  ; Waiting here prevents an upgrade from failing while NSIS overwrites the file.
  Sleep 1500
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
