' Big Fat Fish desktop pet - silent launcher (no console window).
' Keep this file ASCII-only: VBScript is parsed with the ANSI codepage,
' non-ASCII comments get mangled and break parsing.
Option Explicit

Dim fso, shell, base, app
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(WScript.ScriptFullName)
app = fso.BuildPath(base, "WhalePet.exe")

If Not fso.FileExists(app) Then
  MsgBox "WhalePet.exe not found:" & vbCrLf & app, 16, "Big Fat Fish pet"
  WScript.Quit 1
End If

shell.Run """" & app & """ --no-sandbox", 0, False
