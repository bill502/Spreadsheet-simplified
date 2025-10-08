Param(
    [int]$Port = 8080,
    [string]$Address = "http://localhost",
    [string]$ExcelPath,
    [string]$DbPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Json {
    Param($Context,$Object,[int]$StatusCode=200)
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $json = ($Object | ConvertTo-Json -Depth 10)
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes,0,$bytes.Length)
    $Context.Response.OutputStream.Flush()
}

function Write-Text {
    Param($Context,[string]$Text,[int]$StatusCode=200)
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = 'text/plain; charset=utf-8'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes,0,$bytes.Length)
    $Context.Response.OutputStream.Flush()
}

$global:DbConn = $null
$global:Headers = @()

function Ensure-SqliteAssembly {
    $base = Join-Path $PSScriptRoot '..'
    $lib = Join-Path $base 'lib/sqlite'
    $dll = Join-Path $lib 'System.Data.SQLite.dll'
    New-Item -ItemType Directory -Force -Path $lib | Out-Null
    if (-not (Test-Path $dll)) {
        $ver = '1.0.118'
        $pkgManaged = Join-Path $lib 'System.Data.SQLite.nupkg'
        $pkgCore = Join-Path $lib 'System.Data.SQLite.Core.nupkg'
        Invoke-WebRequest -UseBasicParsing -Uri ("https://www.nuget.org/api/v2/package/System.Data.SQLite/$ver") -OutFile $pkgManaged
        Invoke-WebRequest -UseBasicParsing -Uri ("https://www.nuget.org/api/v2/package/System.Data.SQLite.Core/$ver") -OutFile $pkgCore
        $tmp = Join-Path $lib 'pkg'; if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
        $tmp2 = Join-Path $lib 'pkg_core'; if (Test-Path $tmp2) { Remove-Item -Recurse -Force $tmp2 }
        Expand-Archive -Path $pkgManaged -DestinationPath $tmp
        Expand-Archive -Path $pkgCore -DestinationPath $tmp2
        $managed = Get-ChildItem -Recurse -Path $tmp -Filter 'System.Data.SQLite.dll' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '\\lib\\' } | Select-Object -First 1 -ExpandProperty FullName
        if (-not $managed) { throw 'Could not locate System.Data.SQLite.dll (managed provider) in NuGet package.' }
        Copy-Item $managed $dll -Force
        $native = Get-ChildItem -Recurse -Path $tmp2 -Filter 'SQLite.Interop.dll' -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match 'runtimes\\win' } | Select-Object -First 1 -ExpandProperty FullName
        if ($native) { Copy-Item $native (Join-Path $lib 'SQLite.Interop.dll') -Force }
    }
    $env:PATH = (Join-Path $PSScriptRoot '..\lib\sqlite') + [System.IO.Path]::PathSeparator + $env:PATH
    Add-Type -Path $dll -ErrorAction SilentlyContinue | Out-Null
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

function Get-DbPath {
    if ($DbPath) { return (Resolve-Path $DbPath).Path }
    $default = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath 'data/app.db'
    $dir = Split-Path $default -Parent
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    return $default
}

function Open-Db {
    Ensure-SqliteAssembly
    if ($global:DbConn) { return }
    $path = Get-DbPath
    $cs = "Data Source=$path;Cache=Shared;Journal Mode=WAL;Synchronous=NORMAL;"
    $global:DbConn = New-Object System.Data.SQLite.SQLiteConnection($cs)
    $global:DbConn.Open()
    Init-Db
}

function Close-Db { if ($global:DbConn) { $global:DbConn.Close(); $global:DbConn.Dispose(); $global:DbConn=$null } }

function Exec-NonQuery { Param([string]$Sql,[hashtable]$Params)
    $cmd = $global:DbConn.CreateCommand(); $cmd.CommandText=$Sql
    if ($Params){ foreach($k in $Params.Keys){ $p=$cmd.CreateParameter(); $p.ParameterName='@'+$k; $p.Value=$Params[$k]; [void]$cmd.Parameters.Add($p) } }
    return $cmd.ExecuteNonQuery()
}

function Exec-Query { Param([string]$Sql,[hashtable]$Params)
    $cmd = $global:DbConn.CreateCommand(); $cmd.CommandText=$Sql
    if ($Params){ foreach($k in $Params.Keys){ $p=$cmd.CreateParameter(); $p.ParameterName='@'+$k; $p.Value=$Params[$k]; [void]$cmd.Parameters.Add($p) } }
    $r=$cmd.ExecuteReader(); $out=@(); while($r.Read()){ $row=[ordered]@{}; for($i=0;$i -lt $r.FieldCount;$i++){ $row[$r.GetName($i)]=$r.GetValue($i) }; $out+=[pscustomobject]$row }; $r.Close(); return ,$out
}

function Exec-Scalar { Param([string]$Sql,[hashtable]$Params)
    $cmd = $global:DbConn.CreateCommand(); $cmd.CommandText=$Sql
    if ($Params){ foreach($k in $Params.Keys){ $p=$cmd.CreateParameter(); $p.ParameterName='@'+$k; $p.Value=$Params[$k]; [void]$cmd.Parameters.Add($p) } }
    return $cmd.ExecuteScalar()
}

function Table-Exists { Param([string]$Name) return ((Exec-Query -Sql "SELECT name FROM sqlite_master WHERE type='table' AND name=@n" -Params @{ n=$Name }).Count -gt 0) }

function Init-Db {
    if (-not (Table-Exists -Name 'people')) {
        if ($ExcelPath -and (Test-Path $ExcelPath)) { Import-FromExcel -Path $ExcelPath }
        else {
            Exec-NonQuery -Sql @"
CREATE TABLE people (
  rowNumber INTEGER PRIMARY KEY,
  [new ID] TEXT, [ID] TEXT, [LAWYERNAME] TEXT, [PHONE] TEXT,
  [ADDRESS] TEXT, [AddressLength] TEXT, [Status] TEXT,
  [LocalityName] TEXT, [Alias] TEXT, [HighlightedAddress] TEXT,
  [PP] TEXT, [UC] TEXT, [Comments] TEXT,
  [Called] INTEGER, [CallDate] TEXT, [Visited] INTEGER, [VisitDate] TEXT,
  [ConfirmedVoter] INTEGER, [LawyerForum] TEXT,
  [CreatedBy] TEXT, [CreatedAt] TEXT, [UpdatedBy] TEXT, [UpdatedAt] TEXT,
  [CalledBy] TEXT, [VisitedBy] TEXT,
  [LawyerName] TEXT, [Phone] TEXT, [Locality] TEXT
);
"@
        }
    }
    $global:Headers = (Exec-Query -Sql "PRAGMA table_info(people);").name
}

function Import-FromExcel { Param([string]$Path)
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $wb = $excel.Workbooks.Open((Resolve-Path $Path).Path)
    $ws = $wb.Worksheets.Item(1)
    $rng = $ws.UsedRange
    $vals = $rng.Value2
    if ($null -eq $vals) { throw "Workbook appears empty." }
    $rowCount = $vals.GetLength(0)
    $colCount = $vals.GetLength(1)
    $headers = for ($c=1; $c -le $colCount; $c++) { [string]$vals.GetValue(1,$c) }
    $colsSql = @('rowNumber INTEGER PRIMARY KEY')
    foreach($h in $headers){ if([string]::IsNullOrWhiteSpace($h)){ continue }; $safe = $h.Replace(']',']]'); $colsSql += "[$safe] TEXT" }
    $create = "CREATE TABLE people (" + ($colsSql -join ', ') + ")"; Exec-NonQuery -Sql $create
    for ($r=2; $r -le $rowCount; $r++) {
        $absRow = $rng.Row + $r - 1
        $names = @('rowNumber') + (@($headers | Where-Object { $_ -and $_.Length -gt 0 }))
        $ph = @('@rowNumber') + (@($headers | Where-Object { $_ -and $_.Length -gt 0 } | ForEach-Object { '@' + ($_ -replace '[^A-Za-z0-9_]','_') }))
        $sql = "INSERT INTO people (" + (($names | ForEach-Object { '['+($_ -replace ']' ,']]')+']'}) -join ',') + ") VALUES (" + ($ph -join ',') + ")"
        $p = @{ rowNumber = $absRow }
        for($c=1;$c -le $colCount;$c++){
            $name = [string]$headers[$c-1]; if([string]::IsNullOrWhiteSpace($name)){ continue }
            $key = ($name -replace '[^A-Za-z0-9_]','_')
            $p[$key] = $vals.GetValue($r,$c)
        }
        Exec-NonQuery -Sql $sql -Params $p
    }
    $wb.Close($false); $excel.Quit()
}

function Get-RowByNumber { Param([int]$RowNumber) $r = Exec-Query -Sql "SELECT * FROM people WHERE rowNumber=@n" -Params @{ n=$RowNumber }; if($r.Count){ return $r[0] } else { return @{ rowNumber=$RowNumber } } }
function Normalize-FieldValue {
    Param([string]$Name,[object]$Value)
    if ($null -eq $Value) { return $null }
    switch -regex ($Name) {
        '^(Called|Visited|ConfirmedVoter)$' {
            if ($Value -is [bool]) { return ([int]$Value) }
            $s = [string]$Value; $s = $s.ToLower().Trim();
            return ( @('1','true','yes','y','on') -contains $s ) ? 1 : 0
        }
        default { return $Value }
    }
}

function Update-Row { Param([int]$RowNumber,[hashtable]$Fields)
    if (-not $Fields -or $Fields.Keys.Count -eq 0) { return }
    # Ensure columns exist
    foreach($k in $Fields.Keys){ if ($global:Headers -notcontains $k) { $safe=$k.Replace(']',']]'); Exec-NonQuery -Sql ("ALTER TABLE people ADD COLUMN ["+$safe+"] TEXT") | Out-Null; $global:Headers += $k } }
    # Build UPDATE
    $sets=@(); $params=@{ n=$RowNumber }
    foreach($k in $Fields.Keys){
        $safe = $k.Replace(']',']]')
        $pn='p_'+([Math]::Abs($k.GetHashCode()));
        $sets+="[${safe}]=@${pn}"
        $params[$pn] = (Normalize-FieldValue -Name $k -Value $Fields[$k])
    }
    $rows = Exec-NonQuery -Sql ("UPDATE people SET "+($sets -join ', ')+" WHERE rowNumber=@n") -Params $params
    if ($rows -eq 0) {
        # If no row updated, insert a new one with provided fields
        $all = @('rowNumber') + @($Fields.Keys)
        $cols = ($all | ForEach-Object { '['+($_.Replace(']',']]'))+']' }) -join ','
        $ph = @('@rn') + (@($Fields.Keys | ForEach-Object { '@i_'+([Math]::Abs($_.GetHashCode())) }))
        $sql = "INSERT INTO people ($cols) VALUES (" + ($ph -join ',') + ")"
        $p2 = @{ rn = $RowNumber }
        foreach($k in $Fields.Keys){ $p2['i_'+([Math]::Abs($k.GetHashCode()))] = (Normalize-FieldValue -Name $k -Value $Fields[$k]) }
        Exec-NonQuery -Sql $sql -Params $p2 | Out-Null
    }
}
function Append-Comment { Param([int]$RowNumber,[string]$Comment)
    if ([string]::IsNullOrWhiteSpace($Comment)) { return }
    $row = Get-RowByNumber -RowNumber $RowNumber
    $existing = [string]$row.Comments
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm')
    $val = if ([string]::IsNullOrEmpty($existing)) { "[$ts] $Comment" } else { "$existing`n[$ts] $Comment" }
    Update-Row -RowNumber $RowNumber -Fields @{ Comments = $val }
}

function Parse-Query { Param([uri]$Uri)
    $qs = $Uri.Query; if ($qs.StartsWith('?')) { $qs=$qs.Substring(1) }
    $d=@{}; if ([string]::IsNullOrEmpty($qs)) { return $d }
    foreach($pair in $qs -split '&'){ if([string]::IsNullOrWhiteSpace($pair)){continue}; $kv=$pair -split '=',2; $k=[System.Uri]::UnescapeDataString($kv[0]); $v= if($kv.Length -gt 1){ [System.Uri]::UnescapeDataString($kv[1]) } else { '' }; $d[$k]=$v }
    return $d
}

function Handle-Api { Param($Context)
    $req=$Context.Request; $path=$req.Url.AbsolutePath; $method=$req.HttpMethod
    if ($path -eq '/api/health') { return (Write-Json -Context $Context -Object @{ ok = $true }) }
    if ($path -eq '/api/columns' -and $method -eq 'GET') { return (Write-Json -Context $Context -Object @{ columns = $global:Headers }) }
    if ($path -eq '/api/row' -and $method -eq 'POST') {
        $body = Read-BodyJson -Request $req; if ($null -eq $body) { $body=@{} }
        $fields=@{}; foreach($p in $body.PSObject.Properties){ if($p.Name -ne 'rowNumber'){ $fields[$p.Name]=$p.Value } }
        $max=(Exec-Query -Sql "SELECT IFNULL(MAX(rowNumber),0) AS m FROM people")[0].m; $new=[int]$max+1; $fields['rowNumber']=$new
        foreach($k in $fields.Keys){ if ($global:Headers -notcontains $k) { $safe=$k.Replace(']',']]'); Exec-NonQuery -Sql ("ALTER TABLE people ADD COLUMN ["+$safe+"] TEXT"); $global:Headers += $k } }
        $cols = ($fields.Keys | ForEach-Object { '['+($_ -replace ']' ,']]')+']' }) -join ','
        $ph = ($fields.Keys | ForEach-Object { '@'+($_ -replace '[^A-Za-z0-9_]','_') }) -join ','
        $sql = "INSERT INTO people ($cols) VALUES ($ph)"; $params=@{}; foreach($k in $fields.Keys){ $params[($k -replace '[^A-Za-z0-9_]','_')]=$fields[$k] }
        Exec-NonQuery -Sql $sql -Params $params
        $created = Get-RowByNumber -RowNumber $new; return (Write-Json -Context $Context -Object $created -StatusCode 201)
    }
    if ($path -eq '/api/search' -and $method -eq 'GET') {
        $query = Parse-Query -Uri $req.Url; $q=$query['q']; $lim = [int]($query['limit'] ?? 100)
        if ([string]::IsNullOrWhiteSpace($q)) {
            $items = Exec-Query -Sql "SELECT * FROM people ORDER BY rowNumber LIMIT @l" -Params @{ l=$lim }
            $total = (Exec-Query -Sql "SELECT COUNT(*) AS c FROM people")[0].c
            return (Write-Json -Context $Context -Object @{ total=$total; items=$items })
        } else {
            $likeCols = @($global:Headers | Where-Object { $_ -and $_ -ne 'rowNumber' })
            $conds = @(); foreach($c in $likeCols){ $conds += "[${c}] LIKE @pat" }
            $sql = "SELECT * FROM people WHERE " + ($conds -join ' OR ') + " ORDER BY rowNumber LIMIT @l"
            $items = Exec-Query -Sql $sql -Params @{ pat = '%'+$q+'%'; l=$lim }
            $cnt = "SELECT COUNT(*) AS c FROM people WHERE " + ($conds -join ' OR ')
            $total = (Exec-Query -Sql $cnt -Params @{ pat = '%'+$q+'%' })[0].c
            return (Write-Json -Context $Context -Object @{ total=$total; items=$items })
        }
    }
    if ($path -match '^/api/row/(\d+)$' -and $method -eq 'GET') { $n=[int]$Matches[1]; return (Write-Json -Context $Context -Object (Get-RowByNumber -RowNumber $n)) }
    if ($path -match '^/api/row/(\d+)$' -and $method -eq 'POST') {
        $n=[int]$Matches[1]; $body=Read-BodyJson -Request $req; if(-not $body){ return (Write-Json -Context $Context -Object @{ error='Empty body' } -StatusCode 400) }
        $fields=@{}; foreach($p in $body.PSObject.Properties){ if($p.Name -ne 'rowNumber'){ $fields[$p.Name]=$p.Value } }
        Update-Row -RowNumber $n -Fields $fields; return (Write-Json -Context $Context -Object (Get-RowByNumber -RowNumber $n))
    }
    if ($path -match '^/api/row/(\d+)/comment$' -and $method -eq 'POST') {
        $n=[int]$Matches[1]; $body=Read-BodyJson -Request $req; $c=[string]$body.comment; if([string]::IsNullOrWhiteSpace($c)){ return (Write-Json -Context $Context -Object @{ error='Missing comment' } -StatusCode 400) }
        Append-Comment -RowNumber $n -Comment $c; return (Write-Json -Context $Context -Object (Get-RowByNumber -RowNumber $n))
    }
    return $false
}

function Handle-Static { Param($Context)
    $req=$Context.Request; $path=$req.Url.AbsolutePath
    $root = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath 'ui'
    $file = if ($path -eq '/' -or $path -eq '') { Join-Path $root 'index.html' } else { Join-Path $root ($path.TrimStart('/')) }
    if (-not (Test-Path $file)) { return $false }
    $bytes = [System.IO.File]::ReadAllBytes($file)
    $ctype = switch -regex ($file) {
        '\.html$' {'text/html; charset=utf-8'} '\.css$' {'text/css; charset=utf-8'} '\.js$' {'application/javascript; charset=utf-8'} default {'application/octet-stream'} }
    $Context.Response.StatusCode=200; $Context.Response.ContentType=$ctype; $Context.Response.ContentLength64=$bytes.Length
    $Context.Response.OutputStream.Write($bytes,0,$bytes.Length); $Context.Response.OutputStream.Flush(); return $true
}

function Start-Server {
    Open-Db
    $listener = New-Object System.Net.HttpListener
    $addr=$Address.TrimEnd('/'); if ($addr -notmatch '^https?://'){ $addr = "http://$addr" }
    $prefix = "${addr}:$Port/"; $listener.Prefixes.Add($prefix); $listener.Start(); Write-Host "Server listening at $prefix"
    try {
        while($true){ $context=$listener.GetContext(); try { $handled=$false; if ($context.Request.Url.AbsolutePath.StartsWith('/api')){ $handled=Handle-Api -Context $context; if(-not $handled){ Write-Json -Context $context -Object @{ error='Not found' } -StatusCode 404 } } else { $handled=Handle-Static -Context $context; if(-not $handled){ Write-Text -Context $context -Text 'Not found' -StatusCode 404 } } } catch { try { Write-Json -Context $context -Object @{ error = $_.Exception.Message } -StatusCode 500 } catch {} } finally { $context.Response.OutputStream.Close() } }
    } finally { $listener.Stop(); Close-Db }
}

Start-Server

