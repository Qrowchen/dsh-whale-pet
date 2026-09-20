' Big Fat Fish desktop pet - silent launcher (no console window).
'
' IMPORTANT: keep this file ASCII-only. VBScript is read using the system
' ANSI codepage, so non-ASCII comments get mangled and break parsing
' (the same trap as Chinese text inside a .bat file).
'
' Double-click this file, or make a desktop shortcut to it.
' Chinese docs: see README.md
Option Explicit

Dim fso, shell, base, bat
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(WScript.ScriptFullName)
bat = fso.BuildPath(base, "run.bat")

If Not fso.FileExists(bat) Then
  MsgBox "run.bat not found:" & vbCrLf & bat, 16, "Big Fat Fish pet"
  WScript.Quit 1
End If

shell.Run """" & bat & """", 0, False
