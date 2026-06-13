#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ASTAP_ZIP_URL    = 'https://sourceforge.net/projects/astap-program/files/windows_installer/astap_command-line_version_Win_amd64.zip/download'
$D50_ZIP_URL      = 'https://sourceforge.net/projects/astap-program/files/star_databases/d50_star_database.zip/download'
# Lighter alternatives if disk space is a concern:
#   D20 (~400 MB): https://sourceforge.net/projects/astap-program/files/star_databases/d20_star_database.zip/download
#   D05 (~102 MB): https://sourceforge.net/projects/astap-program/files/star_databases/d05_star_database.zip/download

# --- Prompt for install directory ---
$InstallDir = Read-Host 'Enter the folder where ASTAP should be installed (e.g. C:\astap)'
$InstallDir = $InstallDir.Trim()

if (-not $InstallDir) {
    Write-Error 'No install directory provided. Aborting.'
    exit 1
}

if (-not (Test-Path $InstallDir -PathType Container)) {
    Write-Error "Directory does not exist: $InstallDir`nCreate it first, then re-run this script."
    exit 1
}

# Check write permission by attempting to create a temp file
$testFile = Join-Path $InstallDir '.write_test'
try {
    [System.IO.File]::WriteAllText($testFile, '')
    Remove-Item $testFile -Force
} catch {
    Write-Error "Directory is not writable: $InstallDir`nCheck permissions and try again."
    exit 1
}

Write-Host ""
Write-Host "Installing ASTAP to: $InstallDir"
Write-Host ""

# --- Download and extract ASTAP binary ---
$binaryPath = Join-Path $InstallDir 'astap_cli.exe'

if (Test-Path $binaryPath) {
    Write-Host "  astap_cli.exe already exists, skipping binary download."
} else {
    Write-Host "  Downloading ASTAP CLI binary..."
    $tmpBinary = Join-Path $env:TEMP 'astap_cli.zip'
    Invoke-WebRequest -Uri $ASTAP_ZIP_URL -OutFile $tmpBinary -UseBasicParsing
    Write-Host "  Extracting..."
    Expand-Archive -Path $tmpBinary -DestinationPath $InstallDir -Force
    Remove-Item $tmpBinary -Force
    if (-not (Test-Path $binaryPath)) {
        Write-Error "Extraction succeeded but astap_cli.exe was not found in $InstallDir.`nThe ZIP contents may have changed — check the SourceForge page."
        exit 1
    }
    Write-Host "  astap_cli.exe installed."
}

# --- Download and extract D50 star catalog ---
Write-Host ""
Write-Host "  Downloading D50 star catalog (~900 MB, ~5000 stars/deg²)..."
Write-Host "  This may take several minutes depending on your connection."
$tmpCatalog = Join-Path $env:TEMP 'd50.zip'
Invoke-WebRequest -Uri $D50_ZIP_URL -OutFile $tmpCatalog -UseBasicParsing
Write-Host "  Extracting catalog..."
Expand-Archive -Path $tmpCatalog -DestinationPath $InstallDir -Force
Remove-Item $tmpCatalog -Force
Write-Host "  D50 catalog installed."

Write-Host ""
Write-Host "Installation complete in: $InstallDir"
Write-Host ""
Write-Host "In the app Settings, set the ASTAP path to: $binaryPath"
