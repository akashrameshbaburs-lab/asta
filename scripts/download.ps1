$ErrorActionPreference = "Stop"
$root = "C:\Users\akash\asta"
New-Item -ItemType Directory -Force -Path "$root\logs" | Out-Null
$log = "$root\logs\download.log"
function Log($m) { $t = Get-Date -Format "HH:mm:ss"; "$t $m" | Tee-Object -FilePath $log -Append }

$items = @(
  @{ name = "whisper-cuda"; url = "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-win-cuda-12.4.0-x64.zip"; out = "$root\bin\whisper-cuda.zip" },
  @{ name = "whisper-cpu";  url = "https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip";              out = "$root\bin\whisper-cpu.zip" },
  @{ name = "whisper-model"; url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin";                    out = "$root\models\ggml-small.en.bin" },
  @{ name = "piper";        url = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";         out = "$root\bin\piper.zip" },
  @{ name = "piper-voice-onnx"; url = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx";      out = "$root\models\piper\en_US-amy-medium.onnx" },
  @{ name = "piper-voice-json"; url = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json"; out = "$root\models\piper\en_US-amy-medium.onnx.json" }
)

foreach ($i in $items) {
  $dir = Split-Path $i.out -Parent
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  if ((Test-Path $i.out) -and ((Get-Item $i.out).Length -gt 0)) { Log "SKIP (exists) $($i.name)"; continue }
  Log "START $($i.name)"
  & curl.exe -sS -L --fail --retry 3 --retry-delay 2 -o "$($i.out).part" $i.url
  if ($LASTEXITCODE -ne 0) { Log "FAIL $($i.name) exit=$LASTEXITCODE"; continue }
  Move-Item -Force "$($i.out).part" $i.out
  Log "DONE $($i.name) $([math]::Round((Get-Item $i.out).Length/1MB,1))MB"
}
Log "ALL DOWNLOADS FINISHED"
