$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$binaryDirectory = Join-Path $workspaceRoot '.tools/spacetime'
if (-not (Test-Path -LiteralPath (Join-Path $binaryDirectory 'spacetimedb-cli.exe'))) {
    New-Item -ItemType Directory -Force $binaryDirectory | Out-Null
    $archive = Join-Path $workspaceRoot '.tools/spacetime.zip'
    Invoke-WebRequest 'https://github.com/clockworklabs/SpacetimeDB/releases/download/v2.14.1/spacetime-x86_64-pc-windows-msvc.zip' -OutFile $archive
    Expand-Archive -LiteralPath $archive -DestinationPath $binaryDirectory -Force
}
node (Join-Path $PSScriptRoot 'create-database-keys.mjs')
Write-Output 'Installed workspace-local SpacetimeDB 2.14.1 and local signing keys.'
