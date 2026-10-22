# Instala o Flutter (stable) e prepara o Android SDK num PC Windows, para gerar os APK.
#  - Flutter em %USERPROFILE%\dev\flutter (git clone do stable), juntado ao PATH do utilizador.
#  - Android SDK em %LOCALAPPDATA%\Android\Sdk (o do Android Studio): cmdline-tools, platform-tools e licenças.
#  - Java: o JBR que vem com o Android Studio.
# Log em logs\instalar-flutter.log (ao lado deste script). Pode correr-se de novo: salta o que já está feito.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path "$aqui\logs" | Out-Null
Start-Transcript -Path "$aqui\logs\instalar-flutter.log" -Force | Out-Null
function Passo($t) { Write-Host ""; Write-Host "=== $t" -ForegroundColor Cyan }
try {
  # --- Flutter
  # Se já houver um Flutter (ex.: %USERPROFILE%\flutter), usa-se e atualiza-se.
  $flutterDir = @((Join-Path $env:USERPROFILE 'flutter'), (Join-Path $env:USERPROFILE 'dev\flutter')) |
    Where-Object { Test-Path "$_\bin\flutter.bat" } | Select-Object -First 1
  if (-not $flutterDir) { $flutterDir = Join-Path $env:USERPROFILE 'dev\flutter' }
  Passo "Flutter em $flutterDir"
  if (Test-Path "$flutterDir\bin\flutter.bat") {
    & "$flutterDir\bin\flutter.bat" --version | Out-Host
    if (Test-Path "$flutterDir\.git") {
      & "$flutterDir\bin\flutter.bat" channel stable | Out-Host
      & "$flutterDir\bin\flutter.bat" upgrade --force | Out-Host
    } else { Write-Host "AVISO: não é um clone git; não consigo atualizar com flutter upgrade" }
  }
  if (-not (Test-Path "$flutterDir\bin\flutter.bat")) {
    New-Item -ItemType Directory -Force -Path (Split-Path $flutterDir) | Out-Null
    git clone --depth 1 -b stable https://github.com/flutter/flutter.git $flutterDir
    if ($LASTEXITCODE -ne 0) { throw "git clone do Flutter falhou" }
  }
  $bin = "$flutterDir\bin"
  $pathUser = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (($pathUser -split ';') -notcontains $bin) {
    [Environment]::SetEnvironmentVariable('Path', ($(if ($pathUser) { "$pathUser;" } else { '' }) + $bin), 'User')
    Write-Host "juntado ao PATH do utilizador"
  }
  $env:Path = "$bin;$env:Path"

  # --- Java (JBR do Android Studio)
  Passo "Java do Android Studio"
  $studios = @("$env:ProgramFiles\Android\Android Studio", "$env:LOCALAPPDATA\Programs\Android Studio") +
    (Get-ChildItem "$env:ProgramFiles\Android" -Directory -ErrorAction SilentlyContinue | ForEach-Object FullName)
  $studio = $studios | Where-Object { $_ -and (Test-Path "$_\jbr\bin\java.exe") } | Select-Object -First 1
  if (-not $studio) { throw "Não encontrei o Android Studio (com jbr). Instale-o primeiro e volte a correr este script." }
  $env:JAVA_HOME = "$studio\jbr"
  $env:Path = "$env:JAVA_HOME\bin;$env:Path"
  Write-Host "Android Studio: $studio"

  # --- Android SDK
  $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
  Passo "Android SDK em $sdk"
  New-Item -ItemType Directory -Force -Path $sdk | Out-Null
  [Environment]::SetEnvironmentVariable('ANDROID_HOME', $sdk, 'User')
  $env:ANDROID_HOME = $sdk
  $sdkmanager = "$sdk\cmdline-tools\latest\bin\sdkmanager.bat"
  if (-not (Test-Path $sdkmanager)) {
    $pagina = (Invoke-WebRequest -UseBasicParsing 'https://developer.android.com/studio').Content
    $m = [regex]::Match($pagina, 'commandlinetools-win-\d+_latest\.zip')
    $zipNome = if ($m.Success) { $m.Value } else { 'commandlinetools-win-13114758_latest.zip' }
    Write-Host "a descarregar $zipNome"
    $zip = Join-Path $env:TEMP $zipNome
    Invoke-WebRequest -UseBasicParsing "https://dl.google.com/android/repository/$zipNome" -OutFile $zip
    $tmp = Join-Path $env:TEMP 'cmdline-tools-extr'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive $zip -DestinationPath $tmp
    New-Item -ItemType Directory -Force -Path "$sdk\cmdline-tools" | Out-Null
    if (Test-Path "$sdk\cmdline-tools\latest") { Remove-Item -Recurse -Force "$sdk\cmdline-tools\latest" }
    Move-Item "$tmp\cmdline-tools" "$sdk\cmdline-tools\latest"
    Remove-Item $zip
  } else { Write-Host "cmdline-tools já existem" }
  Passo "licenças e pacotes base"
  $sim = (1..40 | ForEach-Object { 'y' }) -join "`n"
  $sim | & $sdkmanager --licenses | Out-Host
  & $sdkmanager --install "platform-tools" "platforms;android-36" "build-tools;36.0.0" | Out-Host

  Passo "Flutter: configurar e verificar"
  flutter config --no-analytics | Out-Host
  flutter config --android-sdk $sdk | Out-Host
  flutter config --jdk-dir $env:JAVA_HOME | Out-Host
  $sim | flutter doctor --android-licenses | Out-Host
  flutter doctor -v | Out-Host
  Write-Host ""; Write-Host "INSTALACAO_OK" -ForegroundColor Green
} catch {
  Write-Host ""; Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "INSTALACAO_FALHOU"
} finally {
  Stop-Transcript | Out-Null
}
