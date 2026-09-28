param([switch]$SkipInstall)

$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..'))

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Install and start Docker Desktop first.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22 first.' }
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Install npm with Node.js 22 first.' }
if ((node --version) -notmatch '^v22\.') { throw 'SPR requires Node.js 22.' }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop first.' }

$envFile = Join-Path (Get-Location) '.env.local'
if (-not (Test-Path $envFile)) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $password = [Convert]::ToHexString($bytes).ToLowerInvariant()
  @"
SPR_LOCAL_DB_PASSWORD=$password
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
"@ | Set-Content -Path $envFile -Encoding utf8
  Write-Host 'Created .env.local. Fill the Supabase URL and keys from your existing SPR configuration, then run this script again.'
  exit 0
}

$settings = @{}
Get-Content $envFile | ForEach-Object {
  if ($_ -match '^([A-Z][A-Z0-9_]*)=(.*)$') { $settings[$Matches[1]] = $Matches[2].Trim('"') }
}
foreach ($name in @('SPR_LOCAL_DB_PASSWORD', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY')) {
  if (-not $settings[$name]) { throw "Set $name in .env.local first. The existing Supabase project keeps login working." }
}
if ($settings['SPR_LOCAL_DB_PASSWORD'] -notmatch '^[a-f0-9]{64}$') { throw 'SPR_LOCAL_DB_PASSWORD must be the generated 64-character hex value.' }

docker compose --env-file .env.local -f compose.local.yml up -d --wait
if ($LASTEXITCODE -ne 0) { throw 'Local Postgres or Redis did not become healthy.' }

$env:NODE_ENV = 'development'
$env:PORT = '3000'
$env:APP_URL = 'http://localhost:3000'
$env:APP_ALLOWED_ORIGINS = 'http://localhost:3000'
$env:ENFORCE_HTTPS = 'false'
$env:SQL_SSL = 'false'
$env:REDIS_URL = 'redis://127.0.0.1:6379'
$env:DATABASE_URL = "postgresql://spr:$($settings['SPR_LOCAL_DB_PASSWORD'])@127.0.0.1:5432/spr"
foreach ($name in @('VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY')) {
  if ($settings[$name]) { [Environment]::SetEnvironmentVariable($name, $settings[$name], 'Process') }
}

if (-not $SkipInstall) { npm ci; if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' } }
npm run migrate
if ($LASTEXITCODE -ne 0) { throw 'Database migration failed. No app was started.' }
Write-Host 'SPR local database is ready. Opening http://localhost:3000'
npm run dev
