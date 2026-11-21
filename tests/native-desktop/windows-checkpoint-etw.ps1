# 读取 Git 的 Windows 内核进程事件，只返回进程关系与退出码。
function Read-GitKernelEvents([string]$TraceFile) {
  $gitIds = [System.Collections.Generic.HashSet[uint32]]::new()
  $records = foreach ($record in (Get-WinEvent -Path $TraceFile -Oldest)) {
    if ($record.ProviderName -ne 'Microsoft-Windows-Kernel-Process' -or $record.Id -notin @(1, 2)) { continue }
    $xml = [xml]$record.ToXml()
    $data = @{}
    foreach ($field in $xml.Event.EventData.Data) {
      $data[$field.GetAttribute('Name')] = $field.InnerText
    }
    $processId = $data['ProcessID'] ?? $data['ProcessId']
    if ($null -eq $processId) { continue }
    $parentId = $data['ParentProcessID'] ?? $data['ParentProcessId'] ?? $data['ParentID']
    $image = $data['ImageName'] ?? $data['ImageFileName'] ?? $data['ProcessName']
    if ($image -match '(^|[\\/])git\.exe$') { [void]$gitIds.Add([uint32]$processId) }
    $exitStatus = $data['ExitCode'] ?? $data['ExitStatus']
    [pscustomobject]@{
      pid = [uint32]$processId
      parent = if ($null -ne $parentId) { [uint32]$parentId } else { 0 }
      started = $record.Id -eq 1
      exit = if ($record.Id -eq 2 -and $null -ne $exitStatus) { [long]$exitStatus } else { $null }
      at = ([DateTimeOffset]$record.TimeCreated).ToUnixTimeMilliseconds()
    }
  }
  $records | Where-Object { $gitIds.Contains($_.pid) }
}

function Write-GitKernelFailure($Events, $Failures) {
  foreach ($failure in $Failures) {
    $processIds = [System.Collections.Generic.HashSet[uint32]]::new()
    [void]$processIds.Add($failure.pid)
    if ($failure.nativePid -ne 0) { [void]$processIds.Add($failure.nativePid) }
    $window = @($Events | Where-Object { $_.at -ge ($failure.startMs - 100) -and $_.at -le ($failure.endMs + 500) })
    @($window | Where-Object { $_.started -and $_.parent -eq $failure.pid }) |
      ForEach-Object { [void]$processIds.Add($_.pid) }
    $related = @($window | Where-Object { $processIds.Contains($_.pid) })
    Write-Host ('PC164 kernel failure ' + (ConvertTo-Json -Compress -Depth 4 -InputObject @{
      pid = $failure.pid
      command = $failure.command
      outerExit = $failure.outerExit
      nativeTracePid = $failure.nativePid
      events = $related
    }))
  }
}
