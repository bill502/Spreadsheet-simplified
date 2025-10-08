Param(
    [int]$Port = 8080,
    [string]$Address = "http://localhost",
    [string]$FilePath,
    [string]$DbPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Json {
    Param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)]$Object,
        [int]$StatusCode = 200
    )
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $json = ($Object | ConvertTo-Json -Depth 10)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.OutputStream.Flush()
}

function Write-Text {
    Param(
        [Parameter(Mandatory)]$Context,
        [Parameter(Mandatory)][string]$Text,
        [string]$ContentType = 'text/plain; charset=utf-8',
        [int]$StatusCode = 200
    )
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = $ContentType
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.OutputStream.Flush()
}

function Read-BodyJson {
    Param([Parameter(Mandatory)]$Request)
    if (-not $Request.HasEntityBody) { return @{} }
    $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
    try {
        $raw = $reader.ReadToEnd()
    }
    finally {
        $reader.Close()
    }
    if ([string]::IsNullOrWhiteSpace($raw)) { return @{} }
    return ($raw | ConvertFrom-Json)
}

function Get-ContentType {
    Param([string]$Path)
    switch -regex ($Path) {
        '\.html$' { return 'text/html; charset=utf-8' }
        '\.css$'  { return 'text/css; charset=utf-8' }
        '\.js$'   { return 'application/javascript; charset=utf-8' }
        '\.json$' { return 'application/json; charset=utf-8' }
        '\.png$'  { return 'image/png' }
        '\.jpg$'  { return 'image/jpeg' }
        '\.svg$'  { return 'image/svg+xml' }
        default    { return 'application/octet-stream' }
    }
}

# Excel/Workbook management
$global:Excel = $null
$global:Workbook = $null
$global:Worksheet = $null
$global:Headers = @()
$global:UsedRange = $null
$global:ExcelLock = New-Object object
$global:DbLock = New-Object object
$global:DbConn = $null

function Get-SpreadsheetPath {
    if ($FilePath) { return (Resolve-Path $FilePath).Path }
    $default = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath 'tbl_localities.xlsx'
    if (Test-Path $default) { return (Resolve-Path $default).Path }
    throw "Spreadsheet file not found. Provide -FilePath or place 'tbl_localities.xlsx' in project root."
}

function Open-Workbook {
    [System.Threading.Monitor]::Enter($global:ExcelLock)
    try {
        if ($null -ne $global:Workbook) { return }
        $path = Get-SpreadsheetPath
        $global:Excel = New-Object -ComObject Excel.Application
        $global:Excel.Visible = $false
        $global:Workbook = $global:Excel.Workbooks.Open($path)
        $global:Worksheet = $global:Workbook.Worksheets.Item(1)
        $global:UsedRange = $global:Worksheet.UsedRange
        $vals = $global:UsedRange.Value2
        if ($null -eq $vals) { throw "Workbook appears empty." }
        $rowCount = $vals.GetLength(0)
        $colCount = $vals.GetLength(1)
        $global:Headers = for ($c=1; $c -le $colCount; $c++) { [string]$vals.GetValue(1,$c) }
    }
    finally {
        [System.Threading.Monitor]::Exit($global:ExcelLock)
    }
}

function Close-Workbook {
    [System.Threading.Monitor]::Enter($global:ExcelLock)
    try {
        if ($global:Workbook -ne $null) { $global:Workbook.Close($true) }
        if ($global:Excel -ne $null) { $global:Excel.Quit() }
    }
    finally {
        $global:Worksheet = $null
        $global:Workbook = $null
        $global:Excel = $null
        [System.Threading.Monitor]::Exit($global:ExcelLock)
        [GC]::Collect()
        [GC]::WaitForPendingFinalizers()
    }
}

function Get-AllRows {
    [System.Threading.Monitor]::Enter($global:ExcelLock)
    try {
        $global:UsedRange = $global:Worksheet.UsedRange
        $vals = $global:UsedRange.Value2
        $rowCount = $vals.GetLength(0)
        $colCount = $vals.GetLength(1)
        $startRow = $global:UsedRange.Row
        $rows = @()
        for ($r=2; $r -le $rowCount; $r++) {
            $absRow = $startRow + $r - 1
            $row = [ordered]@{ rowNumber = $absRow }
            for ($c=1; $c -le $colCount; $c++) {
                $h = [string]$global:Headers[$c-1]
                if (-not [string]::IsNullOrEmpty($h)) {
                    $row[$h] = $vals.GetValue($r,$c)
                }
            }
            $rows += [pscustomobject]$row
        }
        return ,$rows
    }
    finally { [System.Threading.Monitor]::Exit($global:ExcelLock) }
}

function Get-RowByNumber {
    Param([int]$RowNumber)
    [System.Threading.Monitor]::Enter($global:ExcelLock)
    try {
        $global:UsedRange = $global:Worksheet.UsedRange
        $vals = $global:UsedRange.Value2
        $colCount = $vals.GetLength(1)
        $row = [ordered]@{ rowNumber = $RowNumber }
        for ($c=1; $c -le $colCount; $c++) {
            $h = [string]$global:Headers[$c-1]
            if (-not [string]::IsNullOrEmpty($h)) {
                $row[$h] = $vals.GetValue($RowNumber,$c)
            }
        }
        return [pscustomobject]$row
    }
    finally { [System.Threading.Monitor]::Exit($global:ExcelLock) }
}

function Ensure-CommentsColumn {
    [System.Threading.Monitor]::Enter($global:ExcelLock)
    try {
        $global:UsedRange = $global:Worksheet.UsedRange
        $vals = $global:UsedRange.Value2
        $colCount = $vals.GetLength(1)
        $commentsIndex = [Array]::IndexOf($global:Headers, 'Comments')
        if ($commentsIndex -lt 0) {
            $newCol = $colCount + 1
            $global:Worksheet.Cells.Item(1,$newCol) = 'Comments'
            $global:Workbook.Save()
            $global:UsedRange = $global:Worksheet.UsedRange
            $vals = $global:UsedRange.Value2
            $colCount = $vals.GetLength(1)
            $global:Headers = for ($c=1; $c -le $colCount; $c++) { [string]$vals.GetValue(1,$c) }
            $commentsIndex = [Array]::IndexOf($global:Headers, 'Comments')
        }
        return ($commentsIndex + 1) # convert to 1-based col index
    }
    finally { [System.Threading.Monitor]::Exit($global:ExcelLock) }
}

function Update-Row {
    Param(
        [int]$RowNumber,
        [hashtable]$Fields
    )
    [System.Threading.Monitor]::Enter($global:ExcelLock)
    try {
        $global:UsedRange = $global:Worksheet.UsedRange
        $colCount = $global:UsedRange.Columns.Count
        foreach ($key in $Fields.Keys) {
            $idx = [Array]::IndexOf($global:Headers, [string]$key)
            if ($idx -ge 0) {
                $col = $idx + 1
                $global:Worksheet.Cells.Item($RowNumber, $col) = $Fields[$key]
            }
        }
        $global:Workbook.Save()
    }
    finally { [System.Threading.Monitor]::Exit($global:ExcelLock) }
}

function Append-Comment {
    Param([int]$RowNumber, [string]$Comment)
    if ([string]::IsNullOrWhiteSpace($Comment)) { return }
    [System.Threading.Monitor]::Enter($global:ExcelLock)
    try {
        $col = Ensure-CommentsColumn
        $existing = $global:Worksheet.Cells.Item($RowNumber, $col).Text
        $timestamp = (Get-Date).ToString('yyyy-MM-dd HH:mm')
        $newVal = if ([string]::IsNullOrEmpty($existing)) { "[$timestamp] $Comment" } else { "$existing`n[$timestamp] $Comment" }
        $global:Worksheet.Cells.Item($RowNumber, $col) = $newVal
        $global:Workbook.Save()
    }
    finally { [System.Threading.Monitor]::Exit($global:ExcelLock) }
}

function Add-Row {
    Param([hashtable]$Fields)
    [System.Threading.Monitor]::Enter($global:ExcelLock)
    try {
        $global:UsedRange = $global:Worksheet.UsedRange
        $lastCell = $global:Worksheet.Cells.SpecialCells(11) # xlCellTypeLastCell
        $lastRow = $lastCell.Row
        $newRow = $lastRow + 1
        foreach ($key in $Fields.Keys) {
            $idx = [Array]::IndexOf($global:Headers, [string]$key)
            if ($idx -ge 0) {
                $col = $idx + 1
                $global:Worksheet.Cells.Item($newRow, $col) = $Fields[$key]
            }
        }
        $global:Workbook.Save()
        return $newRow
    }
    finally { [System.Threading.Monitor]::Exit($global:ExcelLock) }
}

function Handle-Api {
    Param($Context)
    $req = $Context.Request
    $path = $req.Url.AbsolutePath
    $method = $req.HttpMethod
    if ($path -eq '/api/health') { return (Write-Json -Context $Context -Object @{ ok = $true }) }
    if ($path -eq '/api/columns' -and $method -eq 'GET') {
        return (Write-Json -Context $Context -Object @{ columns = $global:Headers })
    }
    if ($path -eq '/api/row' -and $method -eq 'POST') {
        $body = Read-BodyJson -Request $req
        if ($null -eq $body) { $body = @{} }
        $fields = @{}
        foreach ($p in $body.PSObject.Properties) { if ($p.Name -ne 'rowNumber') { $fields[$p.Name] = $p.Value } }
        $newNum = Add-Row -Fields $fields
        $created = Get-RowByNumber -RowNumber $newNum
        return (Write-Json -Context $Context -Object $created -StatusCode 201)
    }
    if ($path -eq '/api/search' -and $method -eq 'GET') {
        $query = Parse-Query -Uri $req.Url
        $q = $query['q']
        $limitVal = 0; [void][int]::TryParse($query['limit'], [ref]$limitVal); $limit = if ($limitVal -gt 0) { $limitVal } else { 100 }
        $rows = Get-AllRows
        if (-not [string]::IsNullOrWhiteSpace($q)) {
            $qLower = $q.ToLowerInvariant()
            $rows = $rows | Where-Object {
                $match = $false
                foreach ($k in $_.psobject.Properties.Name) {
                    if ($k -eq 'rowNumber') { continue }
                    $v = [string]($_.$k)
                    if ($v -and $v.ToLowerInvariant().Contains($qLower)) { $match = $true; break }
                }
                $match
            }
        }
        $total = ($rows | Measure-Object).Count
        $rows = $rows | Select-Object -First $limit
        return (Write-Json -Context $Context -Object @{ total = $total; items = $rows })
    }
    if ($path -match '^/api/row/(\d+)$' -and $method -eq 'GET') {
        $rowNum = [int]$Matches[1]
        $row = Get-RowByNumber -RowNumber $rowNum
        return (Write-Json -Context $Context -Object $row)
    }
    if ($path -match '^/api/row/(\d+)$' -and $method -eq 'POST') {
        $rowNum = [int]$Matches[1]
        $body = Read-BodyJson -Request $req
        if (-not $body) { return (Write-Json -Context $Context -Object @{ error = 'Empty body' } -StatusCode 400) }
        $fields = @{}
        foreach ($p in $body.PSObject.Properties) { if ($p.Name -ne 'rowNumber') { $fields[$p.Name] = $p.Value } }
        Update-Row -RowNumber $rowNum -Fields $fields
        $updated = Get-RowByNumber -RowNumber $rowNum
        return (Write-Json -Context $Context -Object $updated)
    }
    if ($path -match '^/api/row/(\d+)/comment$' -and $method -eq 'POST') {
        $rowNum = [int]$Matches[1]
        $body = Read-BodyJson -Request $req
        $comment = [string]$body.comment
        if ([string]::IsNullOrWhiteSpace($comment)) { return (Write-Json -Context $Context -Object @{ error = 'Missing comment' } -StatusCode 400) }
        Append-Comment -RowNumber $rowNum -Comment $comment
        $updated = Get-RowByNumber -RowNumber $rowNum
        return (Write-Json -Context $Context -Object $updated)
    }
    return $false
}

function Parse-Query {
    Param([Parameter(Mandatory)] [uri]$Uri)
    $qs = $Uri.Query
    if ($qs.StartsWith('?')) { $qs = $qs.Substring(1) }
    $dict = @{}
    if ([string]::IsNullOrEmpty($qs)) { return $dict }
    foreach ($pair in $qs -split '&') {
        if ([string]::IsNullOrWhiteSpace($pair)) { continue }
        $kv = $pair -split '=', 2
        $k = [System.Uri]::UnescapeDataString($kv[0])
        $v = if ($kv.Length -gt 1) { [System.Uri]::UnescapeDataString($kv[1]) } else { '' }
        $dict[$k] = $v
    }
    return $dict
}

function Handle-Static {
    Param($Context)
    $req = $Context.Request
    $path = $req.Url.AbsolutePath
    $root = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath 'ui'
    $file = if ($path -eq '/' -or $path -eq '') { Join-Path $root 'index.html' } else { Join-Path $root ($path.TrimStart('/')) }
    if (-not (Test-Path $file)) { return $false }
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $ctype = Get-ContentType -Path $file
    $Context.Response.StatusCode = 200
    $Context.Response.ContentType = $ctype
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.OutputStream.Flush()
    return $true
}

function Start-Server {
    Open-Workbook
    $listener = New-Object System.Net.HttpListener
    $addr = $Address.TrimEnd('/')
    if ($addr -notmatch '^https?://') { $addr = "http://$addr" }
    $prefix = "${addr}:$Port/"
    $listener.Prefixes.Add($prefix)
    $listener.Start()
    Write-Host "Server listening at $prefix"
    try {
        while ($true) {
            $context = $listener.GetContext()
            try {
                $handled = $false
                if ($context.Request.Url.AbsolutePath.StartsWith('/api')) {
                    $handled = Handle-Api -Context $context
                    if (-not $handled) { Write-Json -Context $context -Object @{ error = 'Not found' } -StatusCode 404 }
                } else {
                    $handled = Handle-Static -Context $context
                    if (-not $handled) { Write-Text -Context $context -Text 'Not found' -StatusCode 404 }
                }
            }
            catch {
                $err = $_.Exception.Message
                try { Write-Json -Context $context -Object @{ error = $err } -StatusCode 500 } catch {}
            }
            finally { $context.Response.OutputStream.Close() }
        }
    }
    finally {
        $listener.Stop()
        Close-Workbook
    }
}

Start-Server
