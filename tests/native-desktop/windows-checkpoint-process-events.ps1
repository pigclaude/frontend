# 在 Windows 原生验收中把逐命令 Trace2 和 Git 进程起止事件配对，避免输出命令行与路径。
param(
  [Parameter(Mandatory = $true)][ValidateSet('launcher', 'native')][string]$Entry,
  [ValidateRange(1, 12)][int]$Rounds = 8
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$selectedGit = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source
$gitCore = & git --exec-path
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$gitRoot = Split-Path -Parent (Split-Path -Parent $gitCore)
$nativeGit = Join-Path $gitRoot 'bin\git.exe'
if (-not (Test-Path -LiteralPath $nativeGit -PathType Leaf)) { throw 'Native Git executable missing' }
$sameEntry = (Get-FileHash -LiteralPath $selectedGit).Hash -eq (Get-FileHash -LiteralPath $nativeGit).Hash
Write-Host "PC164 git entrance $Entry defaultEqualsNative=$sameEntry"
if ($Entry -eq 'native') { $env:PIGCLAUDE_CI_DIAG_164_NATIVE_GIT = $nativeGit }

$startId = 'pc164-git-start'
$stopId = 'pc164-git-stop'
$subscribed = $false

function Get-GitEvents {
  foreach ($source in @($startId, $stopId)) {
    foreach ($item in @(Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue)) {
      $eventData = $item.SourceEventArgs.NewEvent
      [pscustomobject]@{
        pid = [uint32]$eventData.ProcessID
        parent = [uint32]$eventData.ParentProcessID
        started = $source -eq $startId
        exit = if ($source -eq $stopId) { [uint32]$eventData.ExitStatus } else { $null }
      }
      Remove-Event -EventIdentifier $item.EventIdentifier
    }
  }
}

try {
  try {
    Register-CimIndicationEvent -Query "SELECT * FROM Win32_ProcessStartTrace WHERE ProcessName = 'git.exe'" -SourceIdentifier $startId | Out-Null
    Register-CimIndicationEvent -Query "SELECT * FROM Win32_ProcessStopTrace WHERE ProcessName = 'git.exe'" -SourceIdentifier $stopId | Out-Null
    $subscribed = $true
  } catch {
    Write-Host 'PC164 process event observer could not subscribe'
  }
  if ($subscribed) {
    $stdout = Join-Path $env:RUNNER_TEMP 'pc164-prime.stdout'
    $stderr = Join-Path $env:RUNNER_TEMP 'pc164-prime.stderr'
    $process = Start-Process -FilePath $selectedGit -ArgumentList @('rev-parse', '--verify', 'refs/heads/pc164-absent') -Wait -PassThru -NoNewWindow -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    Start-Sleep -Milliseconds 500
    $events = @(Get-GitEvents)
    $known = @($events | Where-Object { $_.pid -eq $process.Id -and -not $_.started })
    $observed = $known.Count -gt 0 -and $known[0].exit -eq $process.ExitCode
    Write-Host "PC164 process event control exit=$($process.ExitCode) matched=$observed recorded=$($events.Count)"
    Remove-Item -LiteralPath $stdout, $stderr -Force
  }
  for ($iteration = 1; $iteration -le $Rounds; $iteration++) {
    Write-Host "PC164 attempt $iteration"
    $trace = New-Item -ItemType Directory -Path (Join-Path $env:RUNNER_TEMP "pc164-$iteration")
    $log = Join-Path $env:RUNNER_TEMP "pc164-$iteration.log"
    $env:PIGCLAUDE_CI_DIAG_164_TRACE_DIR = $trace.FullName
    try {
      node tests/native-desktop/acceptance.mjs "test-results/native-desktop/$iteration" 2>&1 | Tee-Object -FilePath $log
      $testExit = $LASTEXITCODE
      node tests/native-desktop/checkpoint-git-diagnostics.mjs $trace.FullName
      $traceExit = $LASTEXITCODE
      if ($subscribed) {
        $events = @(Get-GitEvents)
        Write-Host "PC164 process events recorded=$($events.Count)"
        $lines = Get-Content -LiteralPath $log
        foreach ($line in $lines) {
          if ($line -notmatch 'Workbench IPC failed checkpoint-[a-z-]+ git ([a-z-]+) code=(-?\w+) signal=\w+ pid=(\d+)') { continue }
          $command = $Matches[1]
          $wrapperExit = $Matches[2]
          $failedProcessId = [uint32]$Matches[3]
          $records = @($events | Where-Object { $_.pid -eq $failedProcessId -or $_.parent -eq $failedProcessId })
          Write-Host ('PC164 process failure ' + (ConvertTo-Json -Compress -Depth 4 -InputObject @{
            command = $command
            pid = $failedProcessId
            wrapperExit = $wrapperExit
            events = $records
          }))
        }
      }
    } finally {
      Remove-Item Env:PIGCLAUDE_CI_DIAG_164_TRACE_DIR
      Remove-Item -LiteralPath $trace.FullName, $log -Force -Recurse -ErrorAction SilentlyContinue
    }
    if ($testExit -ne 0) { exit $testExit }
    if ($traceExit -ne 0) { exit $traceExit }
  }
} finally {
  foreach ($source in @($startId, $stopId)) {
    Unregister-Event -SourceIdentifier $source -ErrorAction SilentlyContinue
    Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue | Remove-Event -ErrorAction SilentlyContinue
  }
}
