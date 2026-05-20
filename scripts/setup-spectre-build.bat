@echo off
REM ============================================================================
REM VS Code Spectre Mitigation Build Setup Script
REM Installs all required dependencies for building VS Code with Spectre mitigations
REM Target: D:\VSCodeBuildTools
REM ============================================================================

echo ========================================
echo VS Code Spectre Build Setup
echo ========================================
echo.

SET BUILD_ROOT=D:\VSCodeBuildTools
SET LOG_FILE=%BUILD_ROOT%\setup.log

echo Build root: %BUILD_ROOT%
echo Log file: %LOG_FILE%
echo.

REM Create build directory
if not exist "%BUILD_ROOT%" (
    echo Creating build directory...
    mkdir "%BUILD_ROOT%"
)

REM Check for Administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo WARNING: This script may require Administrator privileges for some installations.
    echo Please run as Administrator if you encounter permission errors.
    echo.
)

REM ============================================================================
REM 1. Visual Studio 2022 Build Tools (Required for Spectre-mitigated libraries)
REM ============================================================================
echo [1/6] Checking Visual Studio 2022...

REM Check if VS2022 is already installed
reg query "HKLM\SOFTWARE\Microsoft\VisualStudio\17.0" /v InstallDir >nul 2>&1
if %errorLevel% equ 0 (
    echo Visual Studio 2022 is already installed.
) else (
    echo Visual Studio 2022 NOT found.
    echo.
    echo To install Visual Studio 2022 Build Tools with Spectre mitigation support:
    echo 1. Download from: https://visualstudio.microsoft.com/downloads/
    echo 2. Select "Build Tools for Visual Studio 2022"
    echo 3. In the installer, select:
    echo    - "Desktop development with C++"
    echo    - Under Individual Components:
    echo      * "MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs (Latest)"
    echo      * "Windows 10 SDK" or "Windows 11 SDK"
    echo      * "C++ CMake tools for Windows"
    echo.
    echo Alternatively, download the Build Tools directly:
    echo https://aka.ms/vs/17/release/vs_BuildTools.exe
    echo.
    echo After installation, set the environment variable:
    echo set vs2022_install=C:\Program Files\Microsoft Visual Studio\2022\Community
    echo.
)

REM ============================================================================
REM 2. Windows SDK
REM ============================================================================
echo [2/6] Checking Windows SDK...

reg query "HKLM\SOFTWARE\Microsoft\Microsoft SDKs\Windows" /v CurrentInstallPath >nul 2>&1
if %errorLevel% equ 0 (
    echo Windows SDK is installed.
) else (
    echo Windows SDK NOT found.
    echo Download from: https://developer.microsoft.com/windows/downloads/windows-sdk/
    echo Or install via Visual Studio Installer.
    echo.
)

REM ============================================================================
REM 3. Node.js (for Node 22 branch)
REM ============================================================================
echo [3/6] Setting up Node.js 22.22.1...

if exist "%BUILD_ROOT%\nodejs22" (
    echo Node.js 22 already installed in %BUILD_ROOT%\nodejs22
) else (
    echo Downloading Node.js 22.22.1...
    mkdir "%BUILD_ROOT%\nodejs22"
    
    REM Download Node.js 22.22.1 for Windows x64
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.22.1/node-v22.22.1-win-x64.zip' -OutFile '%BUILD_ROOT%\node-v22.22.1-win-x64.zip'"
    
    echo Extracting...
    powershell -Command "Expand-Archive -Path '%BUILD_ROOT%\node-v22.22.1-win-x64.zip' -DestinationPath '%BUILD_ROOT%\temp' -Force"
    
    REM Move contents to nodejs22 folder
    powershell -Command "Move-Item -Path '%BUILD_ROOT%\temp\node-v22.22.1-win-x64\*' -Destination '%BUILD_ROOT%\nodejs22\' -Force"
    
    REM Cleanup
    rmdir /s /q "%BUILD_ROOT%\temp"
    del "%BUILD_ROOT%\node-v22.22.1-win-x64.zip"
    
    echo Node.js 22.22.1 installed to %BUILD_ROOT%\nodejs22
)

REM ============================================================================
REM 4. Rust Toolchain (Required for CLI build)
REM ============================================================================
echo [4/6] Checking Rust toolchain...

where rustc >nul 2>&1
if %errorLevel% equ 0 (
    echo Rust is already installed.
    rustc --version
) else (
    echo Rust NOT found. Installing to %BUILD_ROOT%\rust...
    
    REM Download rustup-init
    powershell -Command "Invoke-WebRequest -Uri 'https://win.rustup.rs/x86_64' -OutFile '%BUILD_ROOT%\rustup-init.exe'"
    
    echo Installing Rust...
    "%BUILD_ROOT%\rustup-init.exe" -y --default-host x86_64-pc-windows-msvc --no-modify-path
    
    del "%BUILD_ROOT%\rustup-init.exe"
    
    echo Rust installed. Add to PATH: %USERPROFILE%\.cargo\bin
)

REM ============================================================================
REM 5. Git
REM ============================================================================
echo [5/6] Checking Git...

where git >nul 2>&1
if %errorLevel% equ 0 (
    echo Git is already installed.
    git --version
) else (
    echo Git NOT found.
    echo Download from: https://git-scm.com/download/win
    echo.
)

REM ============================================================================
REM 6. Python 3 (Required for node-gyp)
REM ============================================================================
echo [6/6] Checking Python 3...

where python >nul 2>&1
if %errorLevel% equ 0 (
    echo Python is already installed.
    python --version
) else (
    echo Python NOT found.
    echo Download from: https://www.python.org/downloads/
    echo Or install via: winget install Python.Python.3.11
    echo.
)

REM ============================================================================
REM Setup Environment Variables
REM ============================================================================
echo.
echo ========================================
echo Environment Setup
echo ========================================
echo.

echo Add the following to your environment variables:
echo.
echo PATH additions:
echo   %BUILD_ROOT%\nodejs22
echo   %USERPROFILE%\.cargo\bin
echo.
echo Environment variables:
echo   vs2022_install=C:\Program Files\Microsoft Visual Studio\2022\Community
echo   VSCODE_SKIP_NODE_VERSION_CHECK=1  (if using different Node version)
echo.

REM Create a helper script to set up the environment for building
echo Creating setup-env.bat for build environment...

(
echo @echo off
echo REM VS Code Build Environment Setup
echo REM Run this before building
echo.
echo echo Setting up VS Code build environment...
echo.
echo REM Add Node.js 22 to PATH
echo set PATH=%BUILD_ROOT%\nodejs22;%%PATH%%
echo.
echo REM Add Rust to PATH
echo set PATH=%%USERPROFILE%%\.cargo\bin;%%PATH%%
echo.
echo REM Set VS2022 path (adjust if installed elsewhere^)
echo set vs2022_install=C:\Program Files\Microsoft Visual Studio\2022\Community
echo.
echo REM Initialize VS Dev environment
echo call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
echo.
echo echo Environment ready!
echo node --version
echo npm --version
echo rustc --version
) > "%BUILD_ROOT%\setup-env.bat"

echo Created %BUILD_ROOT%\setup-env.bat
echo.

REM ============================================================================
REM Verify Node.js installation
REM ============================================================================
if exist "%BUILD_ROOT%\nodejs22\node.exe" (
    echo Verifying Node.js installation...
    "%BUILD_ROOT%\nodejs22\node.exe" --version
    "%BUILD_ROOT%\nodejs22\npm.cmd" --version
)

echo.
echo ========================================
echo Setup Complete!
echo ========================================
echo.
echo Next steps:
echo 1. Install Visual Studio 2022 with C++ Spectre-mitigated libraries (if not done)
echo 2. Run: %BUILD_ROOT%\setup-env.bat
echo 3. Navigate to your VS Code repo
echo 4. Run: npm install
echo 5. Run: npm run compile
echo.
echo For Spectre mitigation build flags, the CI pipeline uses:
echo   CFLAGS="/guard:cf /Qspectre"
echo.
pause
