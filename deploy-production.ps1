#Requires -Version 5.1
<#
.SYNOPSIS
  Full production deployment for Backup Intelligence — auto-detects environment and writes .env

.DESCRIPTION
  - Verifies Docker / Docker Compose
  - Auto-detects host URL (machine IP, hostname, or override via DEPLOY_HOST)
  - Generates JWT_SECRET, ENCRYPTION_KEY, POSTGRES_PASSWORD if missing
  - Preserves ANTHROPIC_API_KEY / OPENAI_API_KEY from existing .env or process environment
  - Builds images, runs migrations, starts all services, waits for health

.EXAMPLE
  .\deploy-production.ps1

.EXAMPLE
  $env:DEPLOY_HOST = "https://backup.company.com"; .\deploy-production.ps1
  $env:ANTHROPIC_API_KEY = "sk-ant-..."; .\deploy-production.ps1
#>

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "    [OK] $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
    Write-Host "    [WARN] $Message" -ForegroundColor Yellow
}

function Write-Err([string]$Message) {
    Write-Host "    [ERROR] $Message" -ForegroundColor Red
}

function Get-RandomHex([int]$Bytes = 32) {
    $buf = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    return ([BitConverter]::ToString($buf) -replace "-", "").ToLower()
}

function Get-FernetKey {
    try {
        $py = Get-Command python -ErrorAction SilentlyContinue
        if ($py) {
            $key = & python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())" 2>$null
            if ($key -and $key.Length -ge 40) { return $key.Trim() }
        }
    } catch { }
    # URL-safe base64 32-byte key (Fernet-compatible when hashed in app if needed)
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-EnvValueFromFile([string]$Name, [string]$FilePath) {
    if (-not (Test-Path $FilePath)) { return $null }
    foreach ($line in Get-Content $FilePath -ErrorAction SilentlyContinue) {
        if ($line -match "^\s*$Name\s*=\s*(.*)$") {
            $val = $Matches[1].Trim().Trim('"').Trim("'")
            if ($val) { return $val }
        }
    }
    return $null
}

function Is-PlaceholderSecret([string]$Value) {
    if (-not $Value) { return $true }
    $placeholders = @(
        "change-this",
        "change_this",
        "your-",
        "min-32-chars",
        "another-long-random"
    )
    foreach ($p in $placeholders) {
        if ($Value.ToLower().Contains($p)) { return $true }
    }
    return $false
}

function Get-DeployHostUrl {
    # 1) Explicit override
    if ($env:DEPLOY_HOST) {
        $h = $env:DEPLOY_HOST.Trim().TrimEnd('/')
        if ($h -notmatch '^https?://') { $h = "http://$h" }
        return $h
    }

    # 2) Existing .env FRONTEND_URL if not localhost-only production hint
    $existing = Get-EnvValueFromFile "FRONTEND_URL" (Join-Path $ProjectRoot ".env")
    if ($existing -and $existing -notmatch '^https?://localhost') {
        return $existing.Trim().TrimEnd('/')
    }

    # 3) Detect primary non-loopback IPv4
    $ip = $null
    try {
        $addrs = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
            Where-Object { $_.AddressFamily -eq 'InterNetwork' -and $_.ToString() -notlike '127.*' -and $_.ToString() -notlike '169.254.*' } |
            Select-Object -First 1
        if ($addrs) { $ip = $addrs.ToString() }
    } catch { }

    if ($ip) {
        return "http://$ip"
    }

    # 4) Hostname
    $hostname = $env:COMPUTERNAME
    if ($hostname) {
        return "http://$hostname"
    }

    return "http://localhost"
}

function Test-DockerReady {
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if (-not $docker) {
        throw "Docker is not installed or not in PATH. Install Docker Desktop: https://docs.docker.com/desktop/"
    }
    & docker version *> $null
    if ($LASTEXITCODE -ne 0) {
        throw "Docker daemon is not running. Start Docker Desktop and retry."
    }

    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
        & docker-compose version *> $null
        if ($LASTEXITCODE -ne 0) {
            throw "Docker Compose v2 is required (docker compose)."
        }
        $script:ComposeCmd = @("docker-compose")
    } else {
        $script:ComposeCmd = @("docker", "compose")
    }
    Write-Ok "Docker and Compose are available"
}

function Invoke-Compose {
    param([string[]]$Args)
    & @ComposeCmd @Args
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed: $($ComposeCmd -join ' ') $($Args -join ' ')"
    }
}

function Wait-PostgresHealthy {
    param([int]$MaxSeconds = 120)
    Write-Step "Waiting for PostgreSQL to become healthy..."
    $elapsed = 0
    while ($elapsed -lt $MaxSeconds) {
        $status = & docker inspect --format '{{.State.Health.Status}}' bi-postgres 2>$null
        if ($status -eq "healthy") {
            Write-Ok "PostgreSQL is healthy"
            return
        }
        Start-Sleep -Seconds 3
        $elapsed += 3
        Write-Host "    ... waiting ($elapsed s)" -ForegroundColor DarkGray
    }
    throw "PostgreSQL did not become healthy within ${MaxSeconds}s. Check: docker compose logs postgres"
}

function Wait-ApiHealthy {
    param([int]$MaxSeconds = 180)
    Write-Step "Waiting for API health check..."
    $elapsed = 0
    while ($elapsed -lt $MaxSeconds) {
        try {
            $r = Invoke-WebRequest -Uri "http://localhost/api/health" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
            if ($r.StatusCode -eq 200) {
                Write-Ok "API is healthy"
                return
            }
        } catch { }
        Start-Sleep -Seconds 5
        $elapsed += 5
        Write-Host "    ... waiting ($elapsed s)" -ForegroundColor DarkGray
    }
    Write-Warn "API health check timed out — nginx may still be starting. Check: docker compose logs api nginx"
}

function Write-EnvFile {
    param([hashtable]$Vars)

    $lines = @(
        "# Auto-generated by deploy-production.ps1 on $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')",
        "# Re-run deploy-production.ps1 to refresh auto-detected values (secrets are preserved if already set).",
        ""
    )

    $order = @(
        "DATABASE_URL", "JWT_SECRET", "ENCRYPTION_KEY",
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY",
        "REDIS_URL", "CELERY_BROKER_URL", "CELERY_RESULT_BACKEND",
        "BACKUP_STORAGE_PATH", "FRONTEND_URL", "API_URL", "CORS_ORIGINS",
        "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB",
        "SMTP_HOST", "SMTP_PORT", "SMTP_FROM", "SESSION_COOKIE_SECURE"
    )

    foreach ($key in $order) {
        if ($Vars.ContainsKey($key)) {
            $v = $Vars[$key]
            if ($null -eq $v) { $v = "" }
            $lines += "$key=$v"
        }
    }

    # AI provider hint (comment)
    $aiProvider = "none"
    if ($Vars["ANTHROPIC_API_KEY"]) { $aiProvider = "anthropic" }
    elseif ($Vars["OPENAI_API_KEY"]) { $aiProvider = "openai" }
    $lines += ""
    $lines += "# AI_PROVIDER_DETECTED=$aiProvider"

    $envPath = Join-Path $ProjectRoot ".env"
    $lines | Set-Content -Path $envPath -Encoding UTF8
    Write-Ok "Wrote $envPath"
}

# ─────────────────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║     Backup Intelligence — Production Deployment             ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green

Write-Step "Checking prerequisites"
Test-DockerReady

$envFile = Join-Path $ProjectRoot ".env"
$envExample = Join-Path $ProjectRoot ".env.example"

# Load existing values (preserve user secrets & AI keys)
$existing = @{}
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            $existing[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
        }
    }
    Write-Ok "Loaded existing .env ($( $existing.Count ) variables)"
}

Write-Step "Auto-detecting environment"

$deployHost = Get-DeployHostUrl
$apiUrl = "$deployHost/api"
$corsOrigins = "$deployHost,http://localhost,http://127.0.0.1"
if ($deployHost -match '^https://') {
    $sessionSecure = "true"
} else {
    $sessionSecure = "false"
}

Write-Ok "Deploy host: $deployHost"
Write-Ok "API URL:     $apiUrl"
Write-Ok "CORS:        $corsOrigins"

# Postgres credentials
$pgUser = if ($existing["POSTGRES_USER"]) { $existing["POSTGRES_USER"] } else { "backupintel" }
$pgDb = if ($existing["POSTGRES_DB"]) { $existing["POSTGRES_DB"] } else { "backup_intelligence" }
$pgPass = $existing["POSTGRES_PASSWORD"]
if (Is-PlaceholderSecret $pgPass) { $pgPass = $null }
if (-not $pgPass) { $pgPass = Get-RandomHex 24; Write-Ok "Generated POSTGRES_PASSWORD" }
else { Write-Ok "Using existing POSTGRES_PASSWORD" }

# Required secrets
$jwtSecret = $existing["JWT_SECRET"]
if (Is-PlaceholderSecret $jwtSecret) { $jwtSecret = $null }
if (-not $jwtSecret) { $jwtSecret = Get-RandomHex 32; Write-Ok "Generated JWT_SECRET" }
else { Write-Ok "Using existing JWT_SECRET" }

$encKey = $existing["ENCRYPTION_KEY"]
if (Is-PlaceholderSecret $encKey) { $encKey = $null }
if (-not $encKey) { $encKey = Get-FernetKey; Write-Ok "Generated ENCRYPTION_KEY" }
else { Write-Ok "Using existing ENCRYPTION_KEY" }

# AI keys: process env > existing .env > .env.example > empty
$anthropicKey = $env:ANTHROPIC_API_KEY
if (-not $anthropicKey) { $anthropicKey = $existing["ANTHROPIC_API_KEY"] }
if (-not $anthropicKey) { $anthropicKey = Get-EnvValueFromFile "ANTHROPIC_API_KEY" $envExample }

$openaiKey = $env:OPENAI_API_KEY
if (-not $openaiKey) { $openaiKey = $existing["OPENAI_API_KEY"] }
if (-not $openaiKey) { $openaiKey = Get-EnvValueFromFile "OPENAI_API_KEY" $envExample }

if ($anthropicKey) { Write-Ok "AI provider: Anthropic (ANTHROPIC_API_KEY detected)" }
elseif ($openaiKey) { Write-Ok "AI provider: OpenAI (OPENAI_API_KEY detected)" }
else { Write-Warn "No AI API key detected — heuristic AI mode will be used" }

$databaseUrl = "postgresql://${pgUser}:${pgPass}@postgres:5432/${pgDb}"

$allVars = @{
    DATABASE_URL           = $databaseUrl
    JWT_SECRET             = $jwtSecret
    ENCRYPTION_KEY         = $encKey
    ANTHROPIC_API_KEY      = $anthropicKey
    OPENAI_API_KEY         = $openaiKey
    REDIS_URL              = "redis://redis:6379/0"
    CELERY_BROKER_URL      = "redis://redis:6379/1"
    CELERY_RESULT_BACKEND  = "redis://redis:6379/2"
    BACKUP_STORAGE_PATH    = "/data/backups"
    FRONTEND_URL           = $deployHost
    API_URL                = $apiUrl
    CORS_ORIGINS           = $corsOrigins
    POSTGRES_USER          = $pgUser
    POSTGRES_PASSWORD      = $pgPass
    POSTGRES_DB            = $pgDb
    SMTP_HOST              = if ($existing["SMTP_HOST"]) { $existing["SMTP_HOST"] } else { "localhost" }
    SMTP_PORT              = if ($existing["SMTP_PORT"]) { $existing["SMTP_PORT"] } else { "25" }
    SMTP_FROM              = if ($existing["SMTP_FROM"]) { $existing["SMTP_FROM"] } else { "noreply@backup-intelligence.local" }
    SESSION_COOKIE_SECURE  = $sessionSecure
}

Write-Step "Writing environment file"
Write-EnvFile -Vars $allVars

Write-Step "Building Docker images (this may take several minutes)"
Invoke-Compose @("build", "--no-cache", "api", "frontend")
Invoke-Compose @("build", "--parallel")

Write-Step "Starting PostgreSQL and Redis"
Invoke-Compose @("up", "-d", "postgres", "redis")
Wait-PostgresHealthy

Write-Step "Running database migrations"
Invoke-Compose @("--profile", "migrate", "run", "--rm", "migrate")
Write-Ok "Migrations complete"

Write-Step "Starting all production services"
Invoke-Compose @("up", "-d", "--remove-orphans")
Write-Ok "Services started"

Wait-ApiHealthy

Write-Step "Deployment status"
Invoke-Compose @("ps")

Write-Host ""
Write-Host "╔══════════════════════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║              DEPLOYMENT COMPLETE                             ║" -ForegroundColor Green
Write-Host "╚══════════════════════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  Web UI:        $deployHost" -ForegroundColor White
Write-Host "  Sign up:       $deployHost/signup" -ForegroundColor White
Write-Host "  API Docs:      $deployHost/api/docs" -ForegroundColor White
Write-Host "  Health:        $deployHost/api/health" -ForegroundColor White
Write-Host "  Prometheus:    http://localhost:9090" -ForegroundColor White
Write-Host ""
Write-Host "  AI Provider:   $(if ($anthropicKey) { 'Anthropic' } elseif ($openaiKey) { 'OpenAI' } else { 'Heuristic (no API key)' })" -ForegroundColor White
Write-Host ""
Write-Host "  Useful commands:" -ForegroundColor DarkGray
Write-Host "    docker compose logs -f" -ForegroundColor DarkGray
Write-Host "    docker compose ps" -ForegroundColor DarkGray
Write-Host "    docker compose restart api worker" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Secrets saved in .env — back up this file securely." -ForegroundColor Yellow
Write-Host ""
