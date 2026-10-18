' Launches run-scan.cmd with no visible window at all. cmd.exe itself always
' flashes a console window for a moment when started directly by Task
' Scheduler, even with /min or hidden PowerShell - routing through wscript.exe
' like this is the one way that actually suppresses it completely.
Dim shell, fso, scriptDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Window style 0 = hidden. Wait for completion (True) so Task Scheduler's
' run duration/result and "don't start a new instance" overlap check stay
' accurate, instead of reporting success the instant this script launches.
shell.Run """" & scriptDir & "\run-scan.cmd""", 0, True
