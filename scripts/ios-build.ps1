# FlomoEnhanced iOS - sync / build / screenshot helper (PM use)
#
# Usage (from repo root):
#   powershell -File scripts\ios-build.ps1                # sync apps/ios to the Mac
#   powershell -File scripts\ios-build.ps1 -Build         # sync + build for simulator
#   powershell -File scripts\ios-build.ps1 -Build -Run    # sync + build + install + launch
#   powershell -File scripts\ios-build.ps1 -Shot          # screenshot back into .tmp-shots/
#   powershell -File scripts\ios-build.ps1 -Test                          # run UI acceptance tests
#   powershell -File scripts\ios-build.ps1 -Test -Only test02MainTabs      # single case
#
# Requires: Windows built-in tar/scp/ssh; Mac SSH alias "macbook-wifi".

param(
    [switch]$Build,
    [switch]$Run,
    [switch]$Shot,
    [switch]$Test,
    [string]$Only = "",
    [string]$Device = "iPhone Duo",
    [string]$BundleID = "dev.flomoenhanced.ios"
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$tgz = Join-Path $env:TEMP "ios-sync.tgz"
$mac = "macbook-wifi"
$remoteRoot = "~/FlomoIos"
$derived = "/tmp/flomo-dd"

Write-Host "-> packing apps/ios ..."
tar -czf $tgz -C $repo apps/ios

Write-Host "-> upload + extract to ${mac}:${remoteRoot} ..."
scp -q $tgz "${mac}:/tmp/ios-sync.tgz"
ssh $mac "rm -rf $remoteRoot/apps && mkdir -p $remoteRoot && tar -xzf /tmp/ios-sync.tgz -C $remoteRoot"
Write-Host "OK synced"

if ($Build -or $Run -or $Test) {
    Write-Host "-> xcodebuild build ($Device) ..."
    $log = ssh $mac "cd $remoteRoot/apps/ios && xcodebuild -project FlomoEnhanced.xcodeproj -scheme FlomoEnhanced -configuration Debug -destination 'platform=iOS Simulator,name=$Device' -derivedDataPath $derived CODE_SIGNING_ALLOWED=NO build 2>&1"
    $errors = $log | Select-String -Pattern "error:" | ForEach-Object { $_.Line.Trim() } | Sort-Object -Unique
    if ($errors.Count -gt 0) {
        Write-Host "FAILED - compile errors:"
        $errors | Select-Object -First 40 | ForEach-Object { Write-Host "   $_" }
        exit 1
    }
    if (($log | Select-String -Pattern "BUILD SUCCEEDED").Count -gt 0) {
        Write-Host "OK build succeeded"
    } else {
        Write-Host "WARN no BUILD SUCCEEDED marker; tail:"
        $log | Select-Object -Last 25 | ForEach-Object { Write-Host "   $_" }
        exit 1
    }
}

if ($Run) {
    $app = "$derived/Build/Products/Debug-iphonesimulator/FlomoEnhanced.app"
    Write-Host "-> boot simulator, install, launch ..."
    ssh $mac "xcrun simctl boot '$Device' 2>/dev/null; open -a Simulator; xcrun simctl bootstatus '$Device' -b >/dev/null 2>&1; xcrun simctl install '$Device' '$app'; xcrun simctl launch '$Device' $BundleID"
    Write-Host "OK installed and launched"
}

if ($Test) {
    Write-Host "-> running UI acceptance tests ..."
    $outDir = Join-Path $repo ".tmp-shots"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $bundle = "/tmp/flomo-uitest.xcresult"
    $onlyArg = ""
    if ($Only) {
        $onlyArg = "-only-testing:FlomoEnhancedUITests/AcceptanceUITests/$Only"
        Write-Host "   only: $Only"
    }
    $log = ssh $mac "cd $remoteRoot/apps/ios && rm -rf $bundle && xcodebuild test -project FlomoEnhanced.xcodeproj -scheme FlomoEnhanced -configuration Debug -destination 'platform=iOS Simulator,name=$Device' -derivedDataPath $derived $onlyArg -resultBundlePath $bundle 2>&1"
    $log | Select-Object -Last 20 | ForEach-Object { Write-Host "   $_" }
    Write-Host "-> result summary:"
    $summary = ssh $mac "xcrun xcresulttool get test-results summary --path $bundle 2>&1"
    $summary | Select-String -Pattern '"(failureText|testIdentifierString|failedTests|passedTests|result)"' | ForEach-Object { Write-Host "   $($_.Line.Trim())" }
    ssh $mac "rm -rf /tmp/flomo-shots && xcrun xcresulttool export attachments --path $bundle --output-path /tmp/flomo-shots 2>&1 | tail -3"
    Remove-Item -Recurse -Force (Join-Path $outDir "*") -ErrorAction SilentlyContinue
    scp -q -r "${mac}:/tmp/flomo-shots/." $outDir
    Write-Host "OK test run finished; attachments under .tmp-shots/"
}

if ($Shot) {
    $outDir = Join-Path $repo ".tmp-shots"
    New-Item -ItemType Directory -Force -Path $outDir | Out-Null
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $remote = "/tmp/flomo-shot-$stamp.png"
    ssh $mac "xcrun simctl io '$Device' screenshot '$remote'"
    scp -q "${mac}:$remote" (Join-Path $outDir "shot-$stamp.png")
    Write-Host "OK screenshot saved: .tmp-shots/shot-$stamp.png"
}
