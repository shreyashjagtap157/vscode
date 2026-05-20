# ============================================================================
# VS Code Spectre Mitigation Build Setup Script (PowerShell)
# Installs all required dependencies for building VS Code with Spectre mitigations
# Target: D:\VSCodeBuildTools
# ============================================================================

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VS Code Spectre Build Setup (PowerShell)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$BuildRoot = "D:\VSCodeBuildTools"

Write-Host "Build root: $BuildRoot" -ForegroundColor Yellow
Write-Host ""

# Create build directory
if (-not (Test-Path $BuildRoot)) {
    Write-Host "Creating build directory..." -ForegroundColor Green
    New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
}

# ============================================================================
# 1. Visual Studio 2022 Build Tools Check
# ============================================================================
Write-Host "[1/7] Checking Visual Studio 2022..." -ForegroundColor Green

$vsPaths = @(
    "C:\Program Files\Microsoft Visual Studio\2022\Community",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise",
    "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools"
)

$vsFound = $false
$vsInstallPath = ""

foreach ($path in $vsPaths) {
    if (Test-Path $path) {
        $vsFound = $true
        $vsInstallPath = $path
        Write-Host "  Found Visual Studio 2022 at: $path" -ForegroundColor Green
        break
    }
}

if (-not $vsFound) {
    Write-Host "  Visual Studio 2022 NOT found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "  To install with Spectre mitigation support:" -ForegroundColor Yellow
    Write-Host "  1. Download: https://aka.ms/vs/17/release/vs_BuildTools.exe" -ForegroundColor Yellow
    Write-Host "  2. Select 'Desktop development with C++'" -ForegroundColor Yellow
    Write-Host "  3. Under Individual Components, ensure:" -ForegroundColor Yellow
    Write-Host "     - MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs" -ForegroundColor Yellow
    Write-Host "     - Windows 10/11 SDK" -ForegroundColor Yellow
    Write-Host "     - C++ CMake tools for Windows" -ForegroundColor Yellow
    Write-Host ""
}

# ============================================================================
# 2. Windows SDK Check
# ============================================================================
Write-Host "[2/7] Checking Windows SDK..." -ForegroundColor Green

$windowsSdkPath = "C:\Program Files (x86)\Windows Kits\10"
if (Test-Path $windowsSdkPath) {
    Write-Host "  Windows SDK found at: $windowsSdkPath" -ForegroundColor Green
} else {
    Write-Host "  Windows SDK NOT found." -ForegroundColor Red
    Write-Host "  Install via Visual Studio Installer or download separately." -ForegroundColor Yellow
}

# ============================================================================
# 3. Node.js 22.22.1 (for node22 branch)
# ============================================================================
Write-Host "[3/7] Setting up Node.js 22.22.1..." -ForegroundColor Green

$Node22Path = Join-Path $BuildRoot "nodejs22"
if (Test-Path (Join-Path $Node22Path "node.exe")) {
    Write-Host "  Node.js 22 already installed at: $Node22Path" -ForegroundColor Green
    & (Join-Path $Node22Path "node.exe") --version
} else {
    Write-Host "  Downloading Node.js 22.22.1..." -ForegroundColor Yellow
    
    $zipUrl = "https://nodejs.org/dist/v22.22.1/node-v22.22.1-win-x64.zip"
    $zipPath = Join-Path $BuildRoot "node-v22.22.1-win-x64.zip"
    $tempPath = Join-Path $BuildRoot "temp"
    
    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
        Write-Host "  Extracting..." -ForegroundColor Yellow
        
        if (Test-Path $tempPath) {
            Remove-Item $tempPath -Recurse -Force
        }
        New-Item -ItemType Directory -Path $tempPath -Force | Out-Null
        
        Expand-Archive -Path $zipPath -DestinationPath $tempPath -Force
        
        if (-not (Test-Path $Node22Path)) {
            New-Item -ItemType Directory -Path $Node22Path -Force | Out-Null
        }
        
        Move-Item -Path (Join-Path $tempPath "node-v22.22.1-win-x64\*") -Destination $Node22Path -Force
        
        Remove-Item $tempPath -Recurse -Force
        Remove-Item $zipPath -Force
        
        Write-Host "  Node.js 22.22.1 installed to: $Node22Path" -ForegroundColor Green
        & (Join-Path $Node22Path "node.exe") --version
    } catch {
        Write-Host "  Failed to download/extract Node.js: $_" -ForegroundColor Red
    }
}

# ============================================================================
# 4. Node.js 25.8.1 (for node25 branch)
# ============================================================================
Write-Host "[4/7] Setting up Node.js 25.8.1..." -ForegroundColor Green

$Node25Path = Join-Path $BuildRoot "nodejs25"
if (Test-Path (Join-Path $Node25Path "node.exe")) {
    Write-Host "  Node.js 25 already installed at: $Node25Path" -ForegroundColor Green
    & (Join-Path $Node25Path "node.exe") --version
} else {
    Write-Host "  Downloading Node.js 25.8.1..." -ForegroundColor Yellow
    
    $zipUrl = "https://nodejs.org/dist/v25.8.1/node-v25.8.1-win-x64.zip"
    $zipPath = Join-Path $BuildRoot "node-v25.8.1-win-x64.zip"
    $tempPath = Join-Path $BuildRoot "temp"
    
    try {
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
        Write-Host "  Extracting..." -ForegroundColor Yellow
        
        if (Test-Path $tempPath) {
            Remove-Item $tempPath -Recurse -Force
        }
        New-Item -ItemType Directory -Path $tempPath -Force | Out-Null
        
        Expand-Archive -Path $zipPath -DestinationPath $tempPath -Force
        
        if (-not (Test-Path $Node25Path)) {
            New-Item -ItemType Directory -Path $Node25Path -Force | Out-Null
        }
        
        Move-Item -Path (Join-Path $tempPath "node-v25.8.1-win-x64\*") -Destination $Node25Path -Force
        
        Remove-Item $tempPath -Recurse -Force
        Remove-Item $zipPath -Force
        
        Write-Host "  Node.js 25.8.1 installed to: $Node25Path" -ForegroundColor Green
        & (Join-Path $Node25Path "node.exe") --version
    } catch {
        Write-Host "  Failed to download/extract Node.js: $_" -ForegroundColor Red
    }
}

# ============================================================================
# 5. Rust Toolchain
# ============================================================================
Write-Host "[5/7] Checking Rust toolchain..." -ForegroundColor Green

try {
    $rustc = Get-Command rustc -ErrorAction Stop
    Write-Host "  Rust is installed:" -ForegroundColor Green
    rustc --version
} catch {
    Write-Host "  Rust NOT found. Installing..." -ForegroundColor Yellow
    
    $rustupPath = Join-Path $BuildRoot "rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $rustupPath -UseBasicParsing
    
    & $rustupPath -y --default-host x86_64-pc-windows-msvc --no-modify-path
    
    Remove-Item $rustupPath -Force
    
    Write-Host "  Rust installed. Add to PATH: $env:USERPROFILE\.cargo\bin" -ForegroundColor Green
}

# ============================================================================
# 6. Git Check
# ============================================================================
Write-Host "[6/7] Checking Git..." -ForegroundColor Green

try {
    $git = Get-Command git -ErrorAction Stop
    Write-Host "  Git is installed:" -ForegroundColor Green
    git --version
} catch {
    Write-Host "  Git NOT found. Download from: https://git-scm.com/download/win" -ForegroundColor Red
}

# ============================================================================
# 7. Python 3 Check
# ============================================================================
Write-Host "[7/7] Checking Python 3..." -ForegroundColor Green

try {
    $python = Get-Command python -ErrorAction Stop
    Write-Host "  Python is installed:" -ForegroundColor Green
    python --version
} catch {
    Write-Host "  Python NOT found." -ForegroundColor Red
    Write-Host "  Install via: winget install Python.Python.3.11" -ForegroundColor Yellow
}

# ============================================================================
# Create Environment Setup Scripts
# ============================================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Creating Environment Setup Scripts" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# PowerShell setup script
$psSetupScript = @"
# VS Code Build Environment Setup (PowerShell)
# Run this before building

`$ErrorActionPreference = "Continue"

Write-Host "Setting up VS Code build environment..." -ForegroundColor Green
Write-Host ""

# Find VS2022
`$vsPaths = @(
    "C:\Program Files\Microsoft Visual Studio\2022\Community",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise"
)

`$vsInstallPath = ""
foreach (`$path in `$vsPaths) {
    if (Test-Path `$path) {
        `$vsInstallPath = `$path
        break
    }
}

if (`$vsInstallPath) {
    Write-Host "Found VS2022 at: `$vsInstallPath" -ForegroundColor Green
    `$vcvarsPath = Join-Path `$vsInstallPath "VC\Auxiliary\Build\vcvars64.bat"
    if (Test-Path `$vcvarsPath) {
        cmd /c "`"`"$vcvarsPath`" && set" | ForEach-Object {
            if (`$_ -match "^(.*?)=(.*)$") {
                [Environment]::SetEnvironmentVariable(`$matches[1], `$matches[2], "Process")
            }
        }
    }
} else {
    Write-Host "WARNING: VS2022 not found. Native builds may fail." -ForegroundColor Yellow
}

# Set environment variables
`$env:vs2022_install = `$vsInstallPath

Write-Host ""
Write-Host "To use Node.js 22 (for node22 branch):" -ForegroundColor Cyan
Write-Host "  `$env:PATH = `"$Node22Path;`$env:PATH`"" -ForegroundColor Yellow
Write-Host ""
Write-Host "To use Node.js 25 (for node25 branch):" -ForegroundColor Cyan
Write-Host "  `$env:PATH = `"$Node25Path;`$env:PATH`"" -ForegroundColor Yellow
Write-Host ""
"@

$psSetupScript | Out-File -FilePath (Join-Path $BuildRoot "setup-env.ps1") -Encoding UTF8
Write-Host "Created: $(Join-Path $BuildRoot "setup-env.ps1")" -ForegroundColor Green

# Batch setup script
$batSetupScript = @"
@echo off
REM VS Code Build Environment Setup (Batch)
REM Run this before building

echo Setting up VS Code build environment...
echo.

REM Set VS2022 path (adjust if installed elsewhere)
set vs2022_install=C:\Program Files\Microsoft Visual Studio\2022\Community

REM Initialize VS Dev environment
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"

echo.
echo To use Node.js 22 (for node22 branch):
echo   set PATH=%BuildRoot%\nodejs22;%%PATH%%
echo.
echo To use Node.js 25 (for node25 branch):
echo   set PATH=%BuildRoot%\nodejs25;%%PATH%%
echo.
"@

$batSetupScript | Out-File -FilePath (Join-Path $BuildRoot "setup-env.bat") -Encoding ASCII
Write-Host "Created: $(Join-Path $BuildRoot "setup-env.bat")" -ForegroundColor Green

# ============================================================================
# Summary
# ============================================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Installed components:" -ForegroundColor Green
Write-Host "  Node.js 22.22.1: $Node22Path" -ForegroundColor Green
Write-Host "  Node.js 25.8.1: $Node25Path" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Install VS2022 with Spectre-mitigated libs (if not done)" -ForegroundColor Yellow
Write-Host "  2. For Node 22 branch:" -ForegroundColor Yellow
Write-Host "     `$env:PATH = `"$Node22Path;`$env:PATH`"" -ForegroundColor Yellow
Write-Host "     cd D:\Project\vscode" -ForegroundColor Yellow
Write-Host "     git checkout shreyashjagtap157/issue-316759-agent-council" -ForegroundColor Yellow
Write-Host "     npm install" -ForegroundColor Yellow
Write-Host "  3. For Node 25 branch:" -ForegroundColor Yellow
Write-Host "     `$env:PATH = `"$Node25Path;`$env:PATH`"" -ForegroundColor Yellow
Write-Host "     cd D:\Project\vscode" -ForegroundColor Yellow
Write-Host "     git checkout shreyashjagtap157/issue-316759-agent-council-node25" -ForegroundColor Yellow
Write-Host "     npm install" -ForegroundColor Yellow
Write-Host ""
Write-Host "Spectre mitigation build flags (used in CI):" -ForegroundColor Yellow
Write-Host "  CFLAGS=`"/guard:cf /Qspectre`"" -ForegroundColor Yellow
Write-Host ""
