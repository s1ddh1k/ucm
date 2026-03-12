$ErrorActionPreference = 'Continue'
$log = 'C:\Users\eugene\Documents\git\ucm\research\wsl_enable_steps.txt'
"START $(Get-Date -Format o)" | Out-File -FilePath $log -Encoding utf8

cmd /c dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
"DISM_WSL_EXIT=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8

cmd /c dism /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
"DISM_VMP_EXIT=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8

wsl --set-default-version 2
"WSL_SET_DEFAULT_EXIT=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8

wsl --install -d Ubuntu-24.04
"WSL_INSTALL_UBUNTU_EXIT=$LASTEXITCODE" | Out-File -FilePath $log -Append -Encoding utf8

"END $(Get-Date -Format o)" | Out-File -FilePath $log -Append -Encoding utf8
