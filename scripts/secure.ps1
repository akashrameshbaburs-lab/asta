# DPAPI-backed secret helper.
#
#   echo "plaintext" | powershell -File scripts\secure.ps1 -Encrypt
#   echo "<hex>"     | powershell -File scripts\secure.ps1 -Decrypt
#
# Uses the Windows Data Protection API scoped to the current user, so the
# encrypted blob can only be read by this Windows account on this machine.
param(
  [switch]$Encrypt,
  [switch]$Decrypt
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$raw = [Console]::In.ReadToEnd()

if ($Encrypt) {
  $plain = $raw.TrimEnd("`r", "`n")
  $sec = ConvertTo-SecureString -String $plain -AsPlainText -Force
  [Console]::Out.Write((ConvertFrom-SecureString $sec))
} elseif ($Decrypt) {
  $hex = $raw.Trim()
  if (-not $hex) { exit 1 }
  $sec = ConvertTo-SecureString -String $hex
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
  try {
    [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr))
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
} else {
  Write-Error "Specify -Encrypt or -Decrypt"
  exit 2
}
