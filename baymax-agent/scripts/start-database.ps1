$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$databaseRoot = Join-Path $workspaceRoot '.spacetime'
$binary = Join-Path $workspaceRoot '.tools/spacetime/spacetimedb-standalone.exe'
if (-not (Test-Path -LiteralPath $binary)) { throw 'Run scripts/install-database.ps1 first.' }
node (Join-Path $PSScriptRoot 'create-database-keys.mjs')
& $binary start --listen-addr 127.0.0.1:3000 --data-dir (Join-Path $databaseRoot 'data') --jwt-pub-key-path (Join-Path $databaseRoot 'id_ecdsa.pub') --jwt-priv-key-path (Join-Path $databaseRoot 'id_ecdsa') --non-interactive --page_pool_max_size 268435456
