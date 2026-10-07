$content = Get-Content 'src\lib\newspapers.functions.ts' -Raw
$lines = $content -split "`r`n"
$newLines = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    $lineNum = $i + 1
    if ($lineNum -le 861 -or $lineNum -ge 2063) {
        $newLines += $lines[$i]
    }
}
$newLines -join "`r`n" | Set-Content 'src\lib\newspapers.functions.ts'