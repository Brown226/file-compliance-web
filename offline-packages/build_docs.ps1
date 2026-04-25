$ErrorActionPreference = 'Continue'
$ProjectPath = 'e:\工作\file-compliance-web\offline-packages\DocGenerator\DocGenerator.csproj'
$WorkDir = 'e:\工作\file-compliance-web\offline-packages\DocGenerator'
$Dotnet = 'C:\Program Files\dotnet\dotnet.exe'

Write-Host "Building DocGenerator project..."
& $Dotnet build $ProjectPath -c Release
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Running DocGenerator..."
& $Dotnet run --project $ProjectPath -c Release
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host "Done!"
