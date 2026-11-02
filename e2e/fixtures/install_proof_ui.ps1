# The installed program, opened on a fresh machine: does its interface appear?
#
#     powershell -NoProfile -File e2e/fixtures/install_proof_ui.ps1
#
# WebDriver does not start on a hosted runner ("DevToolsActivePort file doesn't
# exist", with or without an install before it), so the suites cannot run there.
# UI Automation needs no driver: it reads what the running program publishes to
# assistive technology, so finding the rail's buttons means the window opened,
# WebView2 loaded the page and the application rendered.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$auto = [System.Windows.Automation.AutomationElement]

$exe = "$env:LOCALAPPDATA\Tessera\tessera.exe"
Start-Process -FilePath $exe | Out-Null

$wanted = 'Tasks', 'Calendar', 'Mosaic', 'Notes', 'Goals', 'Settings'
$found = @()
for ($i = 0; $i -lt 60 -and $found.Count -lt $wanted.Count; $i++) {
    Start-Sleep -Seconds 1
    $proc = Get-Process tessera -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($null -eq $proc) { continue }
    $window = $auto::FromHandle($proc.MainWindowHandle)
    $all = $window.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
    $names = foreach ($element in $all) { $element.Current.Name }
    $found = $wanted | Where-Object { $names -contains $_ }
}

Stop-Process -Name tessera -Force -ErrorAction SilentlyContinue
Write-Host "the installed program published: $($found -join ', ')"
if ($found.Count -lt $wanted.Count) {
    throw "the interface did not appear: found $($found.Count) of $($wanted.Count) destinations"
}
