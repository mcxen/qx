!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Installing the Qx Everything indexing service"
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -install-service'
  DetailPrint "Starting the Qx Everything background index"
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -startup -app-data -no-update-notification'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DetailPrint "Stopping the Qx Everything background index"
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -exit'
  DetailPrint "Removing the Qx Everything indexing service"
  nsExec::ExecToLog '"$INSTDIR\resources\search\everything.exe" -instance Qx -uninstall-service'
!macroend
