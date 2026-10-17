$ErrorActionPreference = "Stop"
$root = "C:\Users\akash\asta"
$log = "$root\logs\extract.log"
function Log($m) { $t = Get-Date -Format "HH:mm:ss"; "$t $m" | Tee-Object -FilePath $log -Append }

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Extract($zip, $dest) {
  if (-not (Test-Path $zip)) { Log "SKIP missing $zip"; return }
  if (Test-Path $dest) { Log "SKIP exists $dest"; return }
  Log "EXTRACT $zip"
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest)
  Log "DONE $dest"
}

# Whisper: CUDA build preferred, CPU kept as a fallback.
Extract "$root\bin\whisper-cuda.zip" "$root\bin\whisper-cuda"
Extract "$root\bin\whisper-cpu.zip"  "$root\bin\whisper-cpu"
# Piper archive has a top-level "piper" folder, so extract into bin\.
Extract "$root\bin\piper.zip"        "$root\bin"

Log "EXTRACTION FINISHED"
