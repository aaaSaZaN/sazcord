<#
.SYNOPSIS
  Билдит Windows NSIS-инсталлятор и заливает артефакты на update-сервер.

.DESCRIPTION
  Один скрипт = один релиз. Делает:
    1. npm --workspace desktop run build:win:nsis
    2. Берёт из desktop/dist:
         - Sazcord Setup X.Y.Z.exe
         - Sazcord Setup X.Y.Z.exe.blockmap
         - latest.yml
    3. Через scp/rsync кладёт всё это на сервер в указанную папку.

  После этого все запущенные десктоп-клиенты Sazcord в течение 6 часов
  (или сразу при перезапуске) автоматически подтянут обновление.

.PARAMETER RemoteHost
  DNS-имя или IP сервера. По умолчанию sazcord.example.com (или $env:SAZCORD_RELEASE_HOST).

.PARAMETER RemoteUser
  SSH-пользователь на сервере с правом записи в RemoteDir.
  По умолчанию sazcord-publish (рекомендуется завести отдельного юзера —
  см. deploy/UPDATES.md).

.PARAMETER RemoteDir
  Абсолютный путь на сервере, который раздаётся nginx-ом по /updates/.
  ВАЖНО: если SSH-доступ релизера ограничен через ChrootDirectory
  /var/www (как в deploy/UPDATES.md), то внутри chroot путь будет
  /sazcord-updates, а НЕ /var/www/sazcord-updates — sftp-сессия видит
  /var/www как свой root. Поэтому дефолт = /sazcord-updates.
  Если chroot НЕ настроен — переопредели на /var/www/sazcord-updates.

.PARAMETER SshKey
  Путь к приватному SSH-ключу. Если не задан — используется ключ из
  ~/.ssh/id_ed25519 или id_rsa (стандартный поиск ssh-агента).

.PARAMETER SkipBuild
  Не билдить, использовать уже готовые артефакты в desktop/dist (для
  повторной заливки, если первый scp упал на сети).

.EXAMPLE
  cd C:\Users\<you>\Desktop\Sazcord\desktop
  .\scripts\release.ps1

.EXAMPLE
  # Если ключ лежит не в дефолтном месте:
  .\scripts\release.ps1 -SshKey "C:\Users\<you>\.ssh\sazcord_publish"

.NOTES
  Требования:
    - OpenSSH Client установлен в Windows (есть из коробки на Win10+).
      Проверь:  Get-Command scp
    - SSH-ключ добавлен в authorized_keys на сервере для RemoteUser.
    - В RemoteDir есть права на запись для RemoteUser.
#>

param(
  [string]$RemoteHost = $(if ($env:SAZCORD_RELEASE_HOST) { $env:SAZCORD_RELEASE_HOST } else { "sazcord.example.com" }),
  [string]$RemoteUser = "sazcord-publish",
  [string]$RemoteDir = "/sazcord-updates",
  [string]$SshKey = "",
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) {
  Write-Host ""
  Write-Host "==> $msg" -ForegroundColor Cyan
}

# --- 1) Билд ---------------------------------------------------------
$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$DesktopDir = Resolve-Path (Join-Path $ScriptRoot "..")
$RepoRoot = Resolve-Path (Join-Path $DesktopDir "..")
$DistDir = Join-Path $DesktopDir "dist"

if (-not $SkipBuild) {
  Write-Step "Сборка NSIS-инсталлятора"
  Push-Location $RepoRoot
  try {
    npm --workspace desktop run build:win:nsis
    if ($LASTEXITCODE -ne 0) { throw "build failed (exit $LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
}

# --- 2) Поиск артефактов --------------------------------------------
Write-Step "Поиск артефактов в $DistDir"

$installer = Get-ChildItem $DistDir -Filter "Sazcord Setup *.exe" -File |
  Where-Object { $_.Name -notmatch "\.blockmap$" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

$blockmap = Get-ChildItem $DistDir -Filter "Sazcord Setup *.exe.blockmap" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

$latestYml = Join-Path $DistDir "latest.yml"

if (-not $installer) { throw "Не найден Sazcord Setup *.exe в $DistDir" }
if (-not (Test-Path $latestYml)) { throw "Не найден latest.yml в $DistDir" }
if (-not $blockmap) {
  # Без blockmap delta-апдейты не сработают — это не fatal, но предупредим.
  Write-Warning "Не найден .blockmap файл — delta-апдейты не будут работать."
}

$artifacts = @($installer.FullName, $latestYml)
if ($blockmap) { $artifacts += $blockmap.FullName }

Write-Host "Будут залиты:"
foreach ($a in $artifacts) {
  $size = (Get-Item $a).Length
  $sizeMb = [math]::Round($size / 1MB, 1)
  Write-Host "  - $($a -replace [regex]::Escape($DistDir + '\'), '')  ($sizeMb MB)"
}

# --- 3) Заливка через scp -------------------------------------------
Write-Step "Загрузка на $RemoteUser@$RemoteHost`:$RemoteDir/"

$sshArgs = @()
if ($SshKey) {
  if (-not (Test-Path $SshKey)) { throw "SSH-ключ не найден: $SshKey" }
  $sshArgs += @("-i", $SshKey)
  # IdentitiesOnly=yes — критично: без этого OpenSSH сначала пытается
  # ВСЕ ключи из ~/.ssh/ (id_ed25519, id_rsa, sazcord-publish, …),
  # и если хоть один из них зашифрован passphrase'ом — scp зависает
  # на запросе passphrase ДО того, как добраться до нашего -i. С
  # этой опцией используется только переданный ключ — никаких чужих.
  $sshArgs += @("-o", "IdentitiesOnly=yes")
}
# Не падать на «Are you sure you want to continue?» при первой коннект-сессии.
# StrictHostKeyChecking=accept-new добавляет ключ хоста в known_hosts, но
# отвергает изменённый.
$sshArgs += @("-o", "StrictHostKeyChecking=accept-new")

$dest = "${RemoteUser}@${RemoteHost}:${RemoteDir}/"

# scp умеет принимать несколько источников за один вызов — экономим
# оверхед на установку SSH-сессии для каждого файла.
& scp @sshArgs $artifacts $dest
if ($LASTEXITCODE -ne 0) {
  throw "scp завершился с кодом $LASTEXITCODE"
}

Write-Step "Готово"
Write-Host "Проверь: https://$RemoteHost/updates/latest.yml" -ForegroundColor Green
Write-Host "Версия в latest.yml:"
$ymlContent = Get-Content $latestYml -Raw
($ymlContent -split "`n" | Select-Object -First 3) | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
