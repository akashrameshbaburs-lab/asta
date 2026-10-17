' Launch Asta with no visible console window.
' Used by the "Asta" scheduled task at logon.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\akash\asta"
sh.Run "cmd /c node src\asta.js >> logs\asta-console.log 2>&1", 0, False
