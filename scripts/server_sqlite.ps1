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
$global:Sessions = @{}
$global:SessionLock = New-Object object

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
    # Users table (for auth)
    Exec-NonQuery -Sql "CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT, role TEXT)" -Params @{}
    # Seed default admin if none
    $uCount = Exec-Scalar -Sql "SELECT COUNT(*) FROM users" -Params @{}
    if ([int]$uCount -eq 0) { Exec-NonQuery -Sql "INSERT INTO users(username,password,role) VALUES('admin','admin','admin')" -Params @{} | Out-Null }
    # Audit table for changes
    Exec-NonQuery -Sql @"
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY,
  ts TEXT,
  user TEXT,
  action TEXT,
  rowNumber INTEGER,
  details TEXT,
  before TEXT,
  after TEXT
)
"@ -Params @{}
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

# --- Auth helpers ---
function New-Session { Param([string]$User,[string]$Role)
    [System.Threading.Monitor]::Enter($global:SessionLock)
    try {
        $sid = [guid]::NewGuid().ToString('n'); $global:Sessions[$sid] = @{ user=$User; role=$Role; created=(Get-Date) }
        return $sid
    }
    finally { [System.Threading.Monitor]::Exit($global:SessionLock) }
}
function Get-UserFromRequest { Param($Request)
    $cookie = $Request.Cookies['sid']; if ($cookie -and $cookie.Value) { $sid=$cookie.Value; $sess=$global:Sessions[$sid]; if($sess){ return $sess } }
    return $null
}
function Role-GE { Param([string]$have,[string]$need)
    $ord=@{ viewer=0; editor=1; admin=2 }
    return (($ord[$have] ?? -1) -ge ($ord[$need] ?? 99))
}
function Require-Role { Param($Context,[string]$minRole)
    $sess = Get-UserFromRequest -Request $Context.Request
    if (-not $sess) { if ($minRole -eq 'viewer') { return @{ user=$null; role='viewer' } } else { Write-Json -Context $Context -Object @{ error='Unauthorized' } -StatusCode 401; return $null } }
    if (-not (Role-GE -have $sess.role -need $minRole)) { Write-Json -Context $Context -Object @{ error='Forbidden' } -StatusCode 403; return $null }
    return $sess
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
    if ($path -eq '/api/login' -and $method -eq 'POST') {
        $body = Read-BodyJson -Request $req; $u=([string]$body.username).Trim(); $p=([string]$body.password).Trim()
        if ([string]::IsNullOrWhiteSpace($u) -or [string]::IsNullOrWhiteSpace($p)) { return (Write-Json -Context $Context -Object @{ error='Missing credentials' } -StatusCode 400) }
        # Ensure users table and seed admin/admin if empty
        Exec-NonQuery -Sql "CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT, role TEXT)" -Params @{} | Out-Null
        $uCount = Exec-Scalar -Sql "SELECT COUNT(*) FROM users" -Params @{}
        if ([int]$uCount -eq 0) { Exec-NonQuery -Sql "INSERT INTO users(username,password,role) VALUES('admin','admin','admin')" -Params @{} | Out-Null }
        $row = Exec-Query -Sql "SELECT username, password, role FROM users WHERE username=@u" -Params @{ u=$u } | Select-Object -First 1
        if (-not $row) {
            if ($u -eq 'admin' -and $p -eq 'admin') { Exec-NonQuery -Sql "INSERT OR REPLACE INTO users(username,password,role) VALUES('admin','admin','admin')" -Params @{} | Out-Null; $row = @{ username='admin'; password='admin'; role='admin' } }
        }
        if (-not $row -or ([string]$row.password) -ne $p) { return (Write-Json -Context $Context -Object @{ error='Invalid credentials' } -StatusCode 401) }
        $sid = New-Session -User $row.username -Role $row.role
        $cookie = New-Object System.Net.Cookie('sid',$sid); $cookie.Path='/'; $cookie.HttpOnly = $true; $Context.Response.Cookies.Add($cookie)
        return (Write-Json -Context $Context -Object @{ user=$row.username; role=$row.role })
    }
    if ($path -eq '/api/logout' -and $method -eq 'POST') {
        $cookie = $Context.Request.Cookies['sid']; if ($cookie) { $global:Sessions.Remove($cookie.Value) | Out-Null }
        return (Write-Json -Context $Context -Object @{ ok=$true })
    }
    if ($path -eq '/api/me' -and $method -eq 'GET') {
        $sess = Get-UserFromRequest -Request $req; return (Write-Json -Context $Context -Object @{ user=$sess.user; role=($sess.role ?? 'viewer') })
    }
    if ($path -eq '/api/columns' -and $method -eq 'GET') { return (Write-Json -Context $Context -Object @{ columns = $global:Headers }) }
    if ($path -eq '/api/reports' -and $method -eq 'GET') {
        $sess = Require-Role -Context $Context -minRole 'editor'; if (-not $sess) { return $true }
        $q = Parse-Query -Uri $req.Url
        $limit = [int]($q['limit'] ?? 200)
        $conds = @()
        $params = @{}
        # Called/Visited date filters (YYYY-MM-DD)
        if ($q['calledFrom']) { $conds += "[CallDate] >= @cf"; $params['cf'] = [string]$q['calledFrom'] }
        if ($q['calledTo']) { $conds += "[CallDate] <= @ct"; $params['ct'] = [string]$q['calledTo'] }
        if ($q['visitedFrom']) { $conds += "[VisitDate] >= @vf"; $params['vf'] = [string]$q['visitedFrom'] }
        if ($q['visitedTo']) { $conds += "[VisitDate] <= @vt"; $params['vt'] = [string]$q['visitedTo'] }
        # Location filters (match any available column)
        function Add-Like {
            Param([string]$value,[string[]]$candidates,[string]$paramKey)
            if ([string]::IsNullOrWhiteSpace($value)) { return }
            $names = @()
            foreach($c in $candidates){ if ($global:Headers -contains $c) { $names += '['+($c.Replace(']',']]'))+'] LIKE @'+$paramKey } }
            if ($names.Count -gt 0) { $script:conds += '('+($names -join ' OR ')+')'; $script:params[$paramKey] = '%'+$value+'%' }
        }
        Add-Like -value ([string]$q['uc']) -candidates @('UC','Uc') -paramKey 'uc'
        Add-Like -value ([string]$q['pp']) -candidates @('PP','Pp') -paramKey 'pp'
        Add-Like -value ([string]$q['locality']) -candidates @('Locality','LocalityName') -paramKey 'loc'
        # Modified by user/time filters (via audit)
        $auditConds = @('action = ''update''')
        if ($q['byUser']) { $auditConds += 'user = @au'; $params['au'] = [string]$q['byUser'] }
        if ($q['session'] -eq 'current' -and $sess) {
            if (-not $q['byUser']) { $auditConds += 'user = @au'; $params['au'] = [string]$sess.user }
            $fromIso = ($sess.created.ToString('s'))
            $auditConds += 'ts >= @mf'; $params['mf'] = $fromIso
        } elseif ($q['modifiedFrom']) { $auditConds += 'ts >= @mf'; $params['mf'] = [string]$q['modifiedFrom'] }
        if ($q['modifiedTo']) { $auditConds += 'ts <= @mt'; $params['mt'] = [string]$q['modifiedTo'] }
        if ($auditConds.Count -gt 1) {
            $conds += '(rowNumber IN (SELECT rowNumber FROM audit WHERE '+(($auditConds -join ' AND '))+'))'
        } elseif ($q['byUser'] -or $q['modifiedFrom'] -or $q['modifiedTo']) {
            # Only one condition set (still restrict by audit)
            $conds += '(rowNumber IN (SELECT rowNumber FROM audit WHERE '+(($auditConds -join ' AND '))+'))'
        }
        $sql = 'SELECT * FROM people'
        if ($conds.Count -gt 0) { $sql += ' WHERE ' + ($conds -join ' AND ') }
        $sql += ' ORDER BY rowNumber DESC LIMIT @l'
        $params['l'] = $limit
        $items = Exec-Query -Sql $sql -Params $params
        $total = ($items | Measure-Object).Count
        return (Write-Json -Context $Context -Object @{ total=$total; items=$items })
    }
    # Admin: list users
    if ((@('/api/admin/users','/api/admin/users/') -contains $path) -and $method -eq 'GET') {
        $sess = Require-Role -Context $Context -minRole 'admin'; if (-not $sess) { return $true }
        $users = Exec-Query -Sql "SELECT username, role FROM users ORDER BY username" -Params @{}
        return (Write-Json -Context $Context -Object @{ users = $users })
    }
    if ($path -eq '/api/row' -and $method -eq 'POST') {
        $sess = Require-Role -Context $Context -minRole 'editor'; if (-not $sess) { return $true }
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
        $query = Parse-Query -Uri $req.Url; $q=$query['q']; $lim = [int]($query['limit'] ?? 100); $by = [string]$query['by']
        if ([string]::IsNullOrWhiteSpace($q)) {
            $items = Exec-Query -Sql "SELECT * FROM people ORDER BY rowNumber LIMIT @l" -Params @{ l=$lim }
            $total = (Exec-Query -Sql "SELECT COUNT(*) AS c FROM people")[0].c
            return (Write-Json -Context $Context -Object @{ total=$total; items=$items })
        } else {
            $likeCols = @()
            switch ($by) {
                'uc' { $likeCols = @('UC','Uc') }
                'pp' { $likeCols = @('PP','Pp') }
                'locality' { $likeCols = @('Locality','LocalityName') }
                default { $likeCols = @($global:Headers | Where-Object { $_ -and $_ -ne 'rowNumber' }) }
            }
            # ensure columns exist in headers
            $likeCols = @($likeCols | Where-Object { $global:Headers -contains $_ })
            if ($likeCols.Count -eq 0) { $likeCols = @($global:Headers | Where-Object { $_ -and $_ -ne 'rowNumber' }) }
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
        $sess = Require-Role -Context $Context -minRole 'editor'; if (-not $sess) { return $true }
        $n=[int]$Matches[1]; $body=Read-BodyJson -Request $req; if(-not $body){ return (Write-Json -Context $Context -Object @{ error='Empty body' } -StatusCode 400) }
        $fields=@{}; foreach($p in $body.PSObject.Properties){ if($p.Name -ne 'rowNumber'){ $fields[$p.Name]=$p.Value } }
        # Audit: capture before and after
        $before = Get-RowByNumber -RowNumber $n | ConvertTo-Json -Depth 2
        Update-Row -RowNumber $n -Fields $fields
        $after = Get-RowByNumber -RowNumber $n | ConvertTo-Json -Depth 2
        Exec-NonQuery -Sql "INSERT INTO audit(ts,user,action,rowNumber,details,before,after) VALUES(@ts,@u,'update',@n,@d,@b,@a)" -Params @{ ts=(Get-Date).ToString('s'); u=($sess.user ?? ''); n=$n; d=($fields.Keys -join ','); b=$before; a=$after } | Out-Null
        return (Write-Json -Context $Context -Object (Get-RowByNumber -RowNumber $n))
    }
    if ($path -match '^/api/row/(\d+)/comment$' -and $method -eq 'POST') {
        $sess = Require-Role -Context $Context -minRole 'editor'; if (-not $sess) { return $true }
        $n=[int]$Matches[1]; $body=Read-BodyJson -Request $req; $c=[string]$body.comment; if([string]::IsNullOrWhiteSpace($c)){ return (Write-Json -Context $Context -Object @{ error='Missing comment' } -StatusCode 400) }
        Append-Comment -RowNumber $n -Comment ((($sess.user ?? '') -ne '') ? ("$($sess.user): $c") : $c)
        Exec-NonQuery -Sql "INSERT INTO audit(ts,user,action,rowNumber,details) VALUES(@ts,@u,'comment',@n,@d)" -Params @{ ts=(Get-Date).ToString('s'); u=($sess.user ?? ''); n=$n; d=$c } | Out-Null
        return (Write-Json -Context $Context -Object (Get-RowByNumber -RowNumber $n))
    }
    # Admin endpoints
    if ((@('/api/admin/user','/api/admin/user/') -contains $path) -and $method -eq 'POST') {
        $sess = Require-Role -Context $Context -minRole 'admin'; if (-not $sess) { return $true }
        $body = Read-BodyJson -Request $req; $u=[string]$body.username; $p=$body.password; $r=[string]$body.role; $old=[string]$body.oldUsername
        if ([string]::IsNullOrWhiteSpace($u) -or [string]::IsNullOrWhiteSpace($r)) { return (Write-Json -Context $Context -Object @{ error='Missing username/role' } -StatusCode 400) }
        $target = ([string]::IsNullOrWhiteSpace($old)) ? $u : $old
        $exists = [int](Exec-Scalar -Sql "SELECT COUNT(*) FROM users WHERE username=@u" -Params @{ u=$target })
        if ($exists -gt 0) {
            $rename = ($u -ne $target)
            if ($rename) {
                $taken = [int](Exec-Scalar -Sql "SELECT COUNT(*) FROM users WHERE username=@nu" -Params @{ nu=$u })
                if ($taken -gt 0) { return (Write-Json -Context $Context -Object @{ error='Username already exists' } -StatusCode 409) }
                if ($null -ne $p -and -not [string]::IsNullOrWhiteSpace([string]$p)) {
                    Exec-NonQuery -Sql "UPDATE users SET username=@nu, password=@p, role=@r WHERE username=@ou" -Params @{ nu=$u; p=[string]$p; r=$r; ou=$target } | Out-Null
                } else {
                    Exec-NonQuery -Sql "UPDATE users SET username=@nu, role=@r WHERE username=@ou" -Params @{ nu=$u; r=$r; ou=$target } | Out-Null
                }
            } else {
                if ($null -ne $p -and -not [string]::IsNullOrWhiteSpace([string]$p)) {
                    Exec-NonQuery -Sql "UPDATE users SET password=@p, role=@r WHERE username=@u" -Params @{ u=$u; p=[string]$p; r=$r } | Out-Null
                } else {
                    Exec-NonQuery -Sql "UPDATE users SET role=@r WHERE username=@u" -Params @{ u=$u; r=$r } | Out-Null
                }
            }
        } else {
            if ([string]::IsNullOrWhiteSpace([string]$p)) { return (Write-Json -Context $Context -Object @{ error='Missing password for new user' } -StatusCode 400) }
            Exec-NonQuery -Sql "INSERT INTO users(username,password,role) VALUES(@u,@p,@r)" -Params @{ u=$u; p=[string]$p; r=$r } | Out-Null
        }
        return (Write-Json -Context $Context -Object @{ ok=$true })
    }
    if ($path -match '^/api/admin/user/([^/]+)/?$' -and $method -eq 'DELETE') {
        $sess = Require-Role -Context $Context -minRole 'admin'; if (-not $sess) { return $true }
        $uname = [System.Uri]::UnescapeDataString($Matches[1])
        $row = (Exec-Query -Sql "SELECT role FROM users WHERE username=@u" -Params @{ u=$uname }) | Select-Object -First 1
        if (-not $row) { return (Write-Json -Context $Context -Object @{ error='Not found' } -StatusCode 404) }
        $adminCount = [int](Exec-Scalar -Sql "SELECT COUNT(*) FROM users WHERE role='admin'" -Params @{})
        if (($row.role -eq 'admin') -and $adminCount -le 1) { return (Write-Json -Context $Context -Object @{ error='Cannot delete the last admin' } -StatusCode 400) }
        Exec-NonQuery -Sql "DELETE FROM users WHERE username=@u" -Params @{ u=$uname } | Out-Null
        return (Write-Json -Context $Context -Object @{ ok=$true })
    }
    if ($path -eq '/api/admin/revert' -and $method -eq 'POST') {
        $sess = Require-Role -Context $Context -minRole 'admin'; if (-not $sess) { return $true }
        $body = Read-BodyJson -Request $req; $from=[string]$body.from; $to=[string]$body.to
        if ([string]::IsNullOrWhiteSpace($from) -or [string]::IsNullOrWhiteSpace($to)) { return (Write-Json -Context $Context -Object @{ error='from/to required (ISO)' } -StatusCode 400) }
        $logs = Exec-Query -Sql "SELECT * FROM audit WHERE ts BETWEEN @f AND @t ORDER BY id DESC" -Params @{ f=$from; t=$to }
        foreach($log in $logs){ if ($log.before) { try { $before = ($log.before | ConvertFrom-Json); $rowNum = [int]$log.rowNumber; $fields=@{}; foreach($p in $before.PSObject.Properties){ if($p.Name -ne 'rowNumber'){ $fields[$p.Name]=$p.Value } }; Update-Row -RowNumber $rowNum -Fields $fields } catch {} } }
        return (Write-Json -Context $Context -Object @{ reverted = ($logs | Measure-Object).Count })
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
    # Light static caching for performance
    $Context.Response.Headers['Cache-Control'] = 'public, max-age=300'
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

