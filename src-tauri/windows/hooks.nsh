!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Installing the Qx Everything indexing service"
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -install-service'
  ; Qx starts its Everything instance asynchronously on first launch. Starting
  ; the persistent process through nsExec would make NSIS wait for it to exit.
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping the Qx Everything background index"
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -exit'
  DetailPrint "Removing the Qx Everything indexing service"
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -uninstall-service'
!macroend
