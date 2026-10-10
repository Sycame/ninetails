<#
.SYNOPSIS
  Renames the whole project (text, folders and files) from "ninetails" to a new name. Windows / PowerShell 5.1+.

.DESCRIPTION
  Does everything RENAME-PROJECT.md lists for the repository itself:
    1. optional backup copy of the project (without node_modules)
    2. replaces the name inside every text file (4 forms, see below)
    3. deletes generated folders that contain the old name (dist, .angular next to angular.json)
    4. renames folders and files whose NAME contains the old name (deepest first)
    5. checks for leftovers and, if Go is installed, builds and vets the API
    6. optionally renames the root folder itself (-RenameRoot)

  The four forms replaced (case-sensitive), shown for the default old name "ninetails" and new name "foo-bar":
    ninetails-app title form   NinetailsApp  -> FooBarApp
    environment prefix         NINETAILS     -> FOO_BAR       (so NINETAILS_AUTH -> FOO_BAR_AUTH)
    lowercase name             ninetails     -> foo-bar       (folders, go module, npm name, paths, storage keys)
    display name               Ninetails     -> Foo Bar

  This script, rename-project.sh and RENAME-PROJECT.md are not edited (they describe the old name).
  Things outside this folder (server, GitLab, DNS) are not touched: see RENAME-PROJECT.md section 7.

.PARAMETER NewName
  New lowercase name: letters, digits and single hyphens, starting with a letter. Example: foo-bar

.PARAMETER DisplayName
  Name shown to people. Default: the new name in Title Case ("Foo Bar"). Letters, digits, spaces, '.' and '-' only.

.PARAMETER EnvName
  Environment variable prefix without the trailing underscore. Default: new name upper-cased, '-' -> '_' (FOO_BAR).

.PARAMETER OldName / OldDisplayName / OldEnvName
  Only needed when the project was renamed before. Defaults describe "ninetails".

.PARAMETER DryRun
  Show everything that would change; change nothing.

.PARAMETER Yes
  Do not ask for confirmation.

.PARAMETER NoBackup
  Skip the backup copy (it is made next to the project folder, named <folder>-backup-<timestamp>).

.PARAMETER RenameRoot
  Also rename the project's root folder (the one containing this script) when its name contains the old name.
  Windows cannot rename a folder that a terminal or editor is inside, so run the script from the PARENT folder
  (for example:  cd ..;  .\ninetails\rename-project.ps1 foo-bar -RenameRoot) and close editors that have the
  project open. If it still fails, the script says so and the rest of the rename is already complete.

.EXAMPLE
  .\rename-project.ps1 foo-bar -DryRun
  .\rename-project.ps1 foo-bar -DisplayName "Foo Bar" -RenameRoot
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)][string]$NewName,
    [string]$DisplayName,
    [string]$EnvName,
    [string]$OldName = 'ninetails',
    [string]$OldDisplayName,
    [string]$OldEnvName,
    [switch]$DryRun,
    [switch]$Yes,
    [switch]$NoBackup,
    [switch]$RenameRoot
)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- names ------
function ConvertTo-Words([string]$slug) {
    ($slug -split '-' | ForEach-Object { $_.Substring(0, 1).ToUpper() + $_.Substring(1) })
}
function ConvertTo-Display([string]$slug) { (ConvertTo-Words $slug) -join ' ' }
function ConvertTo-Pascal([string]$slug) { (ConvertTo-Words $slug) -join '' }
function ConvertTo-EnvName([string]$slug) { $slug.ToUpper().Replace('-', '_') }

if (-not $DisplayName)    { $DisplayName = ConvertTo-Display $NewName }
if (-not $EnvName)        { $EnvName = ConvertTo-EnvName $NewName }
if (-not $OldDisplayName) { $OldDisplayName = ConvertTo-Display $OldName }
if (-not $OldEnvName)     { $OldEnvName = ConvertTo-EnvName $OldName }
$NewTitle = (ConvertTo-Pascal $NewName) + 'App'
$OldTitle = (ConvertTo-Pascal $OldName) + 'App'

if ($NewName -cnotmatch '^[a-z][a-z0-9]*(-[a-z0-9]+)*$') { throw "NewName '$NewName' must be lowercase letters, digits and single hyphens, starting with a letter." }
if ($DisplayName -cnotmatch '^[A-Za-z0-9][A-Za-z0-9 .-]*$') { throw "DisplayName '$DisplayName' may only contain letters, digits, spaces, '.' and '-'." }
if ($EnvName -cnotmatch '^[A-Z][A-Z0-9_]*$') { throw "EnvName '$EnvName' must be upper case letters, digits and underscores." }
if ($NewName -ceq $OldName) { throw 'The new name is the same as the old name.' }

# Replacement table, applied in this order to each file (longest / most specific first).
$pairs = @(
    @($OldTitle, $NewTitle),
    @($OldEnvName, $EnvName),
    @($OldName, $NewName),
    @($OldDisplayName, $DisplayName)
)
# A new value that contains an old token would be rewritten again by a later pass.
foreach ($p in $pairs) {
    foreach ($q in $pairs) {
        if ($p[1].Contains($q[0])) { throw "New value '$($p[1])' contains the old text '$($q[0])'. Choose a different name." }
    }
}

# --------------------------------------------------------------- settings ----
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkipDirs = @('node_modules', '.git', 'dist', '.angular')
$SelfFiles = @('rename-project.ps1', 'rename-project.sh', 'RENAME-PROJECT.md')   # top level only
$BinaryExt = @('.ico', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.ttf', '.eot', '.otf',
               '.zip', '.gz', '.tar', '.exe', '.dll', '.pdf', '.mp4', '.wasm')
$Utf8 = New-Object System.Text.UTF8Encoding($false)

Write-Host ''
Write-Host "Project folder : $Root"
Write-Host 'Replacements   :'
foreach ($p in $pairs) { Write-Host ("  {0,-22} -> {1}" -f $p[0], $p[1]) }
if ($DryRun) { Write-Host 'DRY RUN: nothing will be changed.' -ForegroundColor Yellow }

# ------------------------------------------------------------------ walk -----
# Own walker so node_modules and friends are never entered (they hold tens of thousands of files).
$files = New-Object System.Collections.Generic.List[object]
$items = New-Object System.Collections.Generic.List[object]      # files and folders, for name renames
$generated = New-Object System.Collections.Generic.List[string]  # dist / .angular beside angular.json
$stack = New-Object System.Collections.Generic.Stack[string]
$stack.Push($Root)
while ($stack.Count -gt 0) {
    $dir = $stack.Pop()
    $hasAngular = Test-Path -LiteralPath (Join-Path $dir 'angular.json')
    foreach ($e in Get-ChildItem -LiteralPath $dir -Force) {
        if ($e.PSIsContainer) {
            if ($e.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
            if ($SkipDirs -contains $e.Name) {
                if ($hasAngular -and ($e.Name -eq 'dist' -or $e.Name -eq '.angular')) { $generated.Add($e.FullName) }
                continue
            }
            $stack.Push($e.FullName)
            $items.Add($e)
        } else {
            $isSelf = ($dir -eq $Root) -and ($SelfFiles -contains $e.Name)
            if (-not $isSelf) { $files.Add($e); $items.Add($e) }
        }
    }
}

# ------------------------------------------------------- content plan --------
function Test-Binary([System.IO.FileInfo]$f, [byte[]]$bytes) {
    if ($BinaryExt -contains $f.Extension.ToLower()) { return $true }
    return ([Array]::IndexOf($bytes, [byte]0) -ge 0)
}

$contentPlan = New-Object System.Collections.Generic.List[object]
foreach ($f in $files) {
    $bytes = [IO.File]::ReadAllBytes($f.FullName)
    if ($bytes.Length -eq 0 -or (Test-Binary $f $bytes)) { continue }
    $off = 0
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $off = 3 }
    $text = $Utf8.GetString($bytes, $off, $bytes.Length - $off)
    if ($text.IndexOf($OldName, [StringComparison]::OrdinalIgnoreCase) -lt 0) { continue }
    $count = 0
    foreach ($p in $pairs) { $count += [regex]::Matches($text, [regex]::Escape($p[0])).Count }
    if ($count -gt 0) {
        $contentPlan.Add([pscustomobject]@{ File = $f; Text = $text; Bom = ($off -eq 3); Count = $count })
    }
}

# ------------------------------------------------------- name plan -----------
$renamePlan = @($items | Where-Object { $_.Name.Contains($OldName) } |
    Sort-Object { ($_.FullName.Split('\')).Count } -Descending)

$rootRename = $null
if ($RenameRoot) {
    $leaf = Split-Path -Leaf $Root
    if ($leaf.Contains($OldName)) { $rootRename = $leaf.Replace($OldName, $NewName) }
    else { Write-Host "Root folder '$leaf' does not contain '$OldName'; -RenameRoot ignored." -ForegroundColor Yellow }
}

# ---------------------------------------------------------------- report -----
function Rel([string]$path) { if ($path.Length -gt $Root.Length) { $path.Substring($Root.Length + 1) } else { '.' } }

Write-Host ''
Write-Host "Text files to edit: $($contentPlan.Count)"
foreach ($c in $contentPlan) { Write-Host ("  {0,4} x  {1}" -f $c.Count, (Rel $c.File.FullName)) }
Write-Host ''
Write-Host "Generated folders to delete (rebuilt later): $($generated.Count)"
foreach ($g in $generated) { Write-Host "  $(Rel $g)" }
Write-Host ''
Write-Host "Folders and files to rename: $($renamePlan.Count)$(if ($rootRename) { ' + the root folder' })"
foreach ($r in $renamePlan) { Write-Host ("  {0}  ->  {1}" -f (Rel $r.FullName), $r.Name.Replace($OldName, $NewName)) }
if ($rootRename) { Write-Host ("  [root] {0}  ->  {1}" -f (Split-Path -Leaf $Root), $rootRename) }

if ($DryRun) { Write-Host ''; Write-Host 'Dry run finished. Nothing was changed.' -ForegroundColor Yellow; return }

if (-not $Yes) {
    Write-Host ''
    $answer = Read-Host 'Type "yes" to make these changes'
    if ($answer -ne 'yes') { Write-Host 'Cancelled. Nothing was changed.'; return }
}

# ---------------------------------------------------------------- backup -----
if (-not $NoBackup) {
    $parent = Split-Path -Parent $Root
    $backup = Join-Path $parent ("{0}-backup-{1}" -f (Split-Path -Leaf $Root), (Get-Date -Format 'yyyyMMdd-HHmmss'))
    Write-Host ''
    Write-Host "Backing up to $backup ..."
    & robocopy $Root $backup /E /XD node_modules .angular dist .git /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Backup failed (robocopy exit code $LASTEXITCODE). Nothing was changed." }
}

# --------------------------------------------------------------- content -----
Write-Host ''
Write-Host 'Editing text files ...'
foreach ($c in $contentPlan) {
    $new = $c.Text
    foreach ($p in $pairs) { $new = $new.Replace($p[0], $p[1]) }
    $body = $Utf8.GetBytes($new)
    if ($c.Bom) { $body = [byte[]](0xEF, 0xBB, 0xBF) + $body }
    [IO.File]::WriteAllBytes($c.File.FullName, $body)
}
Write-Host "  edited $($contentPlan.Count) files"

# ------------------------------------------------------------- generated -----
foreach ($g in $generated) {
    Remove-Item -LiteralPath $g -Recurse -Force
    Write-Host "  deleted $(Rel $g)"
}

# ----------------------------------------------------------------- names -----
Write-Host 'Renaming folders and files (deepest first) ...'
foreach ($r in $renamePlan) {
    $newLeaf = $r.Name.Replace($OldName, $NewName)
    $parentDir = Split-Path -Parent $r.FullName
    $target = Join-Path $parentDir $newLeaf
    if (Test-Path -LiteralPath $target) { throw "Cannot rename '$($r.FullName)': '$target' already exists." }
    Rename-Item -LiteralPath $r.FullName -NewName $newLeaf
    Write-Host ("  {0}  ->  {1}" -f (Rel $r.FullName), $newLeaf)
}

# ------------------------------------------------------------- leftovers -----
Write-Host ''
Write-Host 'Checking for leftovers (case-insensitive) ...'
$left = 0
$stack.Clear(); $stack.Push($Root)
while ($stack.Count -gt 0) {
    $dir = $stack.Pop()
    foreach ($e in Get-ChildItem -LiteralPath $dir -Force) {
        if ($e.PSIsContainer) {
            if (($e.Attributes -band [IO.FileAttributes]::ReparsePoint) -or ($SkipDirs -contains $e.Name)) { continue }
            if ($e.Name.IndexOf($OldName, [StringComparison]::OrdinalIgnoreCase) -ge 0) { Write-Host "  name: $(Rel $e.FullName)"; $left++ }
            $stack.Push($e.FullName)
        } else {
            if (($dir -eq $Root) -and ($SelfFiles -contains $e.Name)) { continue }
            if ($e.Name.IndexOf($OldName, [StringComparison]::OrdinalIgnoreCase) -ge 0) { Write-Host "  name: $(Rel $e.FullName)"; $left++ }
            $bytes = [IO.File]::ReadAllBytes($e.FullName)
            if ($bytes.Length -eq 0 -or (Test-Binary $e $bytes)) { continue }
            $t = $Utf8.GetString($bytes)
            if ($t.IndexOf($OldName, [StringComparison]::OrdinalIgnoreCase) -ge 0) { Write-Host "  text: $(Rel $e.FullName)"; $left++ }
        }
    }
}
if ($left -eq 0) { Write-Host '  none found' -ForegroundColor Green } else { Write-Host "  $left leftover(s): check them by hand (other capitalisations of the old name?)" -ForegroundColor Yellow }

# -------------------------------------------------------------- go check -----
if (Get-Command go -ErrorAction SilentlyContinue) {
    foreach ($d in Get-ChildItem -LiteralPath $Root -Directory -Force) {
        if (-not (Test-Path -LiteralPath (Join-Path $d.FullName 'go.mod'))) { continue }
        Write-Host ''
        Write-Host "Go check in $($d.Name) ..."
        Push-Location $d.FullName
        $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
        try {
            $out = & go build ./... 2>&1 | Out-String;  $b = $LASTEXITCODE
            $out2 = & go vet ./... 2>&1 | Out-String;   $v = $LASTEXITCODE
            $fmt = & gofmt -l . 2>&1 | Out-String
        } finally { $ErrorActionPreference = $prev; Pop-Location }
        if ($b -eq 0 -and $v -eq 0 -and -not $fmt.Trim()) { Write-Host '  go build, go vet and gofmt are clean' -ForegroundColor Green }
        else { Write-Host "  PROBLEM:`n$out$out2$fmt" -ForegroundColor Red }
    }
} else {
    Write-Host ''
    Write-Host 'Go is not installed here; skipped the API build check (run go build ./... and go vet ./... yourself).'
}

# ------------------------------------------------------------ root folder ----
if ($rootRename) {
    $parent = Split-Path -Parent $Root
    Set-Location $parent
    try {
        Rename-Item -LiteralPath $Root -NewName $rootRename
        Write-Host ''
        Write-Host "Renamed the root folder to $(Join-Path $parent $rootRename)" -ForegroundColor Green
        $Root = Join-Path $parent $rootRename
    } catch {
        Write-Host "Could not rename the root folder (is it open in an editor or terminal?): $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Close what has it open, then rename '$Root' to '$rootRename' by hand."
    }
}

Write-Host ''
Write-Host 'Done. Next:'
Write-Host "  1. cd to the app folder, run: npm install   (confirms package-lock.json), then npm run build"
Write-Host '  2. Start the API and the app and look at the page title, header and footer.'
Write-Host '  3. Things outside this folder are NOT changed: server paths and service names, the settings file'
Write-Host "     (every $OldEnvName`_ variable must become $EnvName`_), the GitLab Application name, DNS."
Write-Host '     See RENAME-PROJECT.md section 7.'
Write-Host "  Backup (if made): next to the project folder, named '*-backup-*'. Delete it when you are happy."
