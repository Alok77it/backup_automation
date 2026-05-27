param(
    [Parameter(Mandatory = $true)]
    [string]$Namespace,

    [string]$Tag = "latest"
)

$ErrorActionPreference = "Stop"

function Invoke-Docker {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "docker $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
}

$images = @(
    @{ Name = "backup-automation-backend"; Context = "backend"; Args = @() },
    @{ Name = "backup-automation-frontend"; Context = "frontend"; Args = @("--build-arg", "DISABLE_WELCOME=true", "--build-arg", "NEXT_PUBLIC_DISABLE_WELCOME=true") },
    @{ Name = "backup-automation-nginx"; Context = "nginx"; Args = @() },
    @{ Name = "backup-automation-prometheus"; Context = "prometheus"; Args = @() }
)

foreach ($image in $images) {
    $fullName = "$Namespace/$($image.Name):$Tag"
    Write-Host "Building $fullName"
    $buildArgs = @("build") + $image.Args + @("-t", $fullName, $image.Context)
    Invoke-Docker -Arguments $buildArgs
}

foreach ($image in $images) {
    $fullName = "$Namespace/$($image.Name):$Tag"
    Write-Host "Pushing $fullName"
    Invoke-Docker -Arguments @("push", $fullName)
}

Write-Host ""
Write-Host "Published images:"
foreach ($image in $images) {
    Write-Host "https://hub.docker.com/r/$Namespace/$($image.Name)"
}
