$ErrorActionPreference = 'Stop'
$tcp = New-Object System.Net.Sockets.TcpClient
try { $tcp.Connect('127.0.0.1',8787); exit 0 } catch {} finally { $tcp.Dispose() }
$node = (Get-Command node.exe).Source
$logs = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'server.log') -RedirectStandardError (Join-Path $logs 'server-error.log')
