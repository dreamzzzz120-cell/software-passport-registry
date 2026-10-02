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
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $password = ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
  $contents = @"
SPR_LOCAL_DB_PASSWORD=$password
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SPR_INITIAL_OWNER_EMAIL=
"@
  [System.IO.File]::WriteAllText($envFile, $contents, (New-Object System.Text.UTF8Encoding($false)))
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
$ownerCount = docker compose --env-file .env.local -f compose.local.yml exec -T postgres psql -U spr -d spr -Atqc "SELECT count(*) FROM users WHERE role = 'Owner'"
if ($LASTEXITCODE -ne 0) { throw 'Could not check the Owner record.' }
if (($ownerCount | Out-String).Trim() -eq '0') {
  if (-not $settings['SUPABASE_SERVICE_ROLE_KEY'] -or -not $settings['SPR_INITIAL_OWNER_EMAIL']) {
    throw 'Fresh database needs SUPABASE_SERVICE_ROLE_KEY and SPR_INITIAL_OWNER_EMAIL in .env.local to create the first Owner.'
  }
  $env:SPR_INITIAL_OWNER_EMAIL = $settings['SPR_INITIAL_OWNER_EMAIL']
  $bootstrapBytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bootstrapBytes)
  $rng.Dispose()
  $env:SPR_OWNER_BOOTSTRAP_SECRET = ([BitConverter]::ToString($bootstrapBytes) -replace '-', '').ToLowerInvariant()
  $hasher = [System.Security.Cryptography.SHA256]::Create()
  $hashBytes = $hasher.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($env:SPR_OWNER_BOOTSTRAP_SECRET))
  $hasher.Dispose()
  $env:SPR_OWNER_BOOTSTRAP_SECRET_SHA256 = ([BitConverter]::ToString($hashBytes) -replace '-', '').ToLowerInvariant()
  npx tsx scripts/bootstrap-initial-owner.ts
  if ($LASTEXITCODE -ne 0) { throw 'Owner bootstrap failed. Verify the Supabase user exists and has a confirmed email.' }
  Remove-Item Env:SPR_OWNER_BOOTSTRAP_SECRET, Env:SPR_OWNER_BOOTSTRAP_SECRET_SHA256 -ErrorAction SilentlyContinue
}
Write-Host 'SPR local database is ready. Opening http://localhost:3000'
npm run dev
