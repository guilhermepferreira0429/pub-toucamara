# Gera o APK da app do munícipe (e o da equipa) apontado para a produção.
# Saída: code\mobile\build\app\outputs\flutter-apk\ e uma cópia em scripts\windows\apk\.
# Log em logs\gerar-apk.log.
param([string]$Flavors = 'municipe,equipa')
$ErrorActionPreference = 'Stop'
$aqui = Split-Path -Parent $MyInvocation.MyCommand.Path
$mobile = Resolve-Path "$aqui\..\.."
New-Item -ItemType Directory -Force -Path "$aqui\logs", "$aqui\apk" | Out-Null
Start-Transcript -Path "$aqui\logs\gerar-apk.log" -Force | Out-Null
$env:Path = "$env:USERPROFILE\flutter\bin;$env:USERPROFILE\dev\flutter\bin;$env:Path"
$API = 'https://api.toucamara.descortina.pt'
$WEB = 'https://toucamara.descortina.pt'
try {
  # O Gradle 8.14 do projeto não corre com o Java 25 do Android Studio: usa-se um JDK 21 (Temurin).
  $jdk = Join-Path $env:USERPROFILE 'dev\jdk-21'
  if (-not (Test-Path "$jdk\bin\java.exe")) {
    Write-Host "=== a descarregar o JDK 21 (Temurin)" -ForegroundColor Cyan
    $ProgressPreference = 'SilentlyContinue'
    $zip = Join-Path $env:TEMP 'temurin21.zip'
    Invoke-WebRequest -UseBasicParsing 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse' -OutFile $zip
    $tmp = Join-Path $env:TEMP 'temurin21'
    if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
    Expand-Archive $zip -DestinationPath $tmp
    New-Item -ItemType Directory -Force -Path (Split-Path $jdk) | Out-Null
    Move-Item (Get-ChildItem $tmp -Directory | Select-Object -First 1).FullName $jdk
    Remove-Item $zip
  }
  $env:JAVA_HOME = $jdk
  flutter config --jdk-dir $jdk | Out-Host
  Set-Location $mobile
  # Daemons do Gradle de tentativas anteriores (com outro Java) prendem a cache no Windows.
  Get-CimInstance Win32_Process -Filter "Name='java.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'GradleDaemon' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $transf = Join-Path $env:USERPROFILE '.gradle\caches\8.14\transforms'
  if ($env:LIMPAR_CACHE -eq '1' -and (Test-Path $transf)) { Remove-Item -Recurse -Force $transf -ErrorAction SilentlyContinue }
  flutter pub get | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "flutter pub get falhou" }
  foreach ($f in $Flavors -split ',') {
    Write-Host ""; Write-Host "=== APK $f" -ForegroundColor Cyan
    $a = @('build', 'apk', '--release', '--flavor', $f, '-t', "lib/main_$f.dart",
      "--dart-define=API_URL=$API", "--dart-define=WEB_URL=$WEB", '--dart-define=MUNICIPIO=guimaraes')
    flutter @a | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "flutter build apk ($f) falhou" }
    Copy-Item "build\app\outputs\flutter-apk\app-$f-release.apk" "$aqui\apk\toucamara-$f.apk" -Force
    Write-Host "APK: $aqui\apk\toucamara-$f.apk"
  }
  Write-Host ""; Write-Host "APK_OK" -ForegroundColor Green
} catch {
  Write-Host ""; Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "APK_FALHOU"
} finally {
  Stop-Transcript | Out-Null
}
