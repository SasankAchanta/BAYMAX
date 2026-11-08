$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$databaseRoot = Join-Path $workspaceRoot '.spacetime'
$binary = Join-Path $workspaceRoot '.tools/spacetime/spacetimedb-cli.exe'
$ownerFile = Join-Path $databaseRoot 'owner.json'
if (Test-Path -LiteralPath $ownerFile) { $databaseOwner = Get-Content -LiteralPath $ownerFile -Raw | ConvertFrom-Json } else {
    $databaseOwner = Invoke-RestMethod -Method Post 'http://127.0.0.1:3000/v1/identity'
    $databaseOwner | ConvertTo-Json | Set-Content -LiteralPath $ownerFile
}
& $binary --root-dir $databaseRoot login --token $databaseOwner.token | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Local identity setup failed.' }
& $binary --root-dir $databaseRoot publish --server http://127.0.0.1:3000 --module-path (Join-Path $workspaceRoot 'baymax-agent/spacetimedb') --yes=skip-login baymax-care
if ($LASTEXITCODE -ne 0) { throw 'Database publish failed.' }
$envFile = Join-Path $workspaceRoot 'baymax-agent/backend/.env'
$content = if (Test-Path -LiteralPath $envFile) { Get-Content -LiteralPath $envFile -Raw } else { '' }
$settings = @{ SPACETIMEDB_URL='http://127.0.0.1:3000'; SPACETIMEDB_DATABASE='baymax-care'; SPACETIMEDB_TOKEN=$databaseOwner.token }
foreach ($key in $settings.Keys) {
    $line = $key + '=' + $settings[$key]
    if ($content -match ('(?m)^' + $key + '=')) { $content = [regex]::Replace($content, ('(?m)^' + $key + '=.*$'), $line) } else { $content += "`n" + $line }
}
[System.IO.File]::WriteAllText($envFile, $content, [System.Text.UTF8Encoding]::new($false))
Write-Output 'Private local Care Kit database ready. Backend .env updated; restart FastAPI.'
