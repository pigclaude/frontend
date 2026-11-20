# 在临时 Windows 运行器上验证草稿原件、用户级安装、首屏登录和默认浏览器入口。
$ErrorActionPreference = 'Stop'
$expected = '82c09245de24945fa9536727d4acfde93ab189290350e49a8030f1e904759674'
$installer = Join-Path $env:RUNNER_TEMP 'draft\PigClaude-0.0.1-x64.exe'
$sha = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
if ($sha -ne $expected) { throw 'Draft installer SHA-256 did not match' }
$profile = Join-Path $env:APPDATA 'PigClaude'
$installRoot = Join-Path $env:LOCALAPPDATA 'Programs\PigClaude'
if ((Test-Path $profile) -or (Test-Path $installRoot)) { throw 'Expected a clean Windows runner' }
foreach ($name in @('PIGCLAUDE_RUST_BASE_URL','PIGCLAUDE_AUTH_ORIGIN','PIGCLAUDE_WEBSITE_ORIGIN','PIGCLAUDE_USER_DATA','ELECTRON_RENDERER_URL')) {
    if ([Environment]::GetEnvironmentVariable($name)) { throw 'Unexpected desktop override' }
}
$install = Start-Process -FilePath $installer -ArgumentList ('/S /D=' + $installRoot) -Wait -PassThru
if ($install.ExitCode -ne 0) { throw 'NSIS failed' }
$app = Join-Path $installRoot 'PigClaude.exe'
if (-not (Test-Path $app)) { throw 'NSIS did not install PigClaude.exe' }
$bundle = Join-Path $installRoot 'resources\app.asar'
$binary = [IO.BinaryReader]::new([IO.File]::OpenRead($bundle))
try {
    $null = $binary.ReadUInt32()
    $headerSize = $binary.ReadUInt32()
    $header = $binary.ReadBytes($headerSize)
    $preamble = [Text.Encoding]::UTF8.GetString($header,8,[BitConverter]::ToInt32($header,4)) | ConvertFrom-Json
    $entry = $preamble.files.'package.json'
    $binary.BaseStream.Position = 8 + $headerSize + [long]$entry.offset
    $package = [Text.Encoding]::UTF8.GetString($binary.ReadBytes([int]$entry.size)) | ConvertFrom-Json
} finally {
    $binary.Close()
}
if ($package.version -ne '0.0.1' -or $package.pigclaudeEndpoints.authOrigin -ne 'https://www.pigclaude.com' -or $package.pigclaudeEndpoints.rustBaseUrl -ne 'https://api.pigclaude.com') { throw 'Unexpected packaged metadata' }
$status = [ordered]@{artifactSha256=$sha;version=$package.version;embeddedEndpoints=$package.pigclaudeEndpoints;perUserNsisInstall=$true;emptyProfileBeforeInstall=$true;endpointOverridesAbsent=$true;welcomeLoginButton=$false;defaultBrowserOpenedProductionAuthorize=$false}
$evidence = Join-Path $env:RUNNER_TEMP 'test16-proof'
New-Item -Type Directory -Force $evidence | Out-Null
function Save-Receipt {
    $status | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $evidence 'windows-unsigned-preflight.json')
}
Save-Receipt
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$started = Start-Process -FilePath $app -PassThru
$end = [DateTime]::UtcNow.AddSeconds(75)
$login = $null
do {
    $main = Get-Process -Name PigClaude -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $app -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($main) {
        $window = [Windows.Automation.AutomationElement]::FromHandle($main.MainWindowHandle)
        $kind = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty,[Windows.Automation.ControlType]::Button)
        $login = $window.FindAll([Windows.Automation.TreeScope]::Descendants,$kind) | Where-Object { $_.Current.Name -match '^(登录|Sign in|Log in)$' } | Select-Object -First 1
    }
    if (-not $login) { Start-Sleep -Milliseconds 400 }
} until ($login -or [DateTime]::UtcNow -ge $end)
if (-not $login) { throw 'First-launch login control not observed' }
$status.welcomeLoginButton = $true
Save-Receipt
$pattern = $login.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
([Windows.Automation.InvokePattern]$pattern).Invoke()
$end = [DateTime]::UtcNow.AddSeconds(55)
$browser = $null
do {
    $browser = Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('chrome.exe','msedge.exe','firefox.exe','iexplore.exe') -and $_.CommandLine -match 'https://www\.pigclaude\.com/(oauth2/authorize|identity/)' } | Select-Object -First 1
    if (-not $browser) { Start-Sleep -Milliseconds 500 }
} until ($browser -or [DateTime]::UtcNow -ge $end)
if (-not $browser) { throw 'Canonical authorization launch not seen in default browser process metadata' }
$status.defaultBrowserOpenedProductionAuthorize = $true
$status.browserProcess = $browser.Name
Save-Receipt
$status | ConvertTo-Json -Depth 5
