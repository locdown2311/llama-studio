; Instalador do Llama Studio (Inno Setup 6.2 ou mais novo).
; O CI passa a versão: ISCC /DAppVersion=2.12.0 llama-studio.iss
; O motor (llama.cpp ou ik_llama.cpp) não vem no instalador: o programa guia a instalação
; na primeira abertura, e dá para trocar depois em Servidor > Motor.
; Instala por usuário (sem pedir administrador), em %LOCALAPPDATA%\Programs\Llama Studio,
; para que as atualizações de dentro do programa consigam trocar o executável.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist"
#endif

#define AppName "Llama Studio"
#define AppExe "llama-studio.exe"

[Setup]
AppId={{6B0C2B7E-3F1D-4C55-9A0E-7A3D51A2C0F4}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=locdown2311
AppPublisherURL=https://github.com/locdown2311/llama-studio
AppSupportURL=https://github.com/locdown2311/llama-studio/issues
AppUpdatesURL=https://github.com/locdown2311/llama-studio/releases
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#SourceDir}
OutputBaseFilename=llama-studio-setup-{#AppVersion}
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
WizardStyle=modern
WizardSizePercent=110
Compression=lzma2/ultra64
SolidCompression=yes
CloseApplications=force
RestartApplications=no
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
VersionInfoDescription=Instalador do {#AppName}
ChangesEnvironment=no
SetupLogging=yes
; pergunta o idioma no início (pré-seleciona o do Windows); a escolha vai para idioma.ini e o studio abre nele
ShowLanguageDialog=yes
LanguageDetectionMethod=uilanguage

[Languages]
Name: "ptbr"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
ptbr.Desktop=Criar um atalho na área de trabalho
ptbr.Startup=Abrir o Llama Studio quando o Windows iniciar (na bandeja)
ptbr.Launch=Abrir o Llama Studio agora
en.Desktop=Create a desktop shortcut
en.Startup=Start Llama Studio with Windows (in the tray)
en.Launch=Open Llama Studio now

[Tasks]
Name: "desktopicon"; Description: "{cm:Desktop}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "startup"; Description: "{cm:Startup}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "llama-path\index.html"; DestDir: "{app}\llama-path"; Flags: ignoreversion
Source: "..\LICENSE"; DestDir: "{app}"; DestName: "LICENSE.txt"; Flags: ignoreversion

[INI]
Filename: "{app}\idioma.ini"; Section: "studio"; Key: "lang"; String: "{language}"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "{#AppName}"; ValueData: """{app}\{#AppExe}"" --bandeja"; Flags: uninsdeletevalue; Tasks: startup

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:Launch}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /IM {#AppExe}"; Flags: runhidden; RunOnceId: "KillStudio"
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM llama-server.exe"; Flags: runhidden; RunOnceId: "KillLlama"

[UninstallDelete]
Type: filesandordirs; Name: "{app}\llama-cpp"
Type: filesandordirs; Name: "{app}\engines"
Type: filesandordirs; Name: "{app}\llama-path"
Type: files; Name: "{app}\llama-studio.antigo.exe"
Type: files; Name: "{app}\llama-studio.novo.exe"
Type: files; Name: "{app}\idioma.ini"

[Code]
const
  WebView2Key = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Url = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';

var
  DownloadPage: TDownloadWizardPage;
  NeedWebView2: Boolean;

function HasWebView2: Boolean;
var
  V: String;
begin
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\' + WebView2Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM, 'SOFTWARE\' + WebView2Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'Software\' + WebView2Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0'));
end;

function OnDownloadProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  Result := True;
end;

procedure InitializeWizard;
begin
  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), 'Baixando o Microsoft Edge WebView2...', @OnDownloadProgress);
  DownloadPage.ShowBaseNameInsteadOfUrl := True;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID <> wpReady then Exit;
  NeedWebView2 := not HasWebView2;
  if not NeedWebView2 then Exit;
  DownloadPage.Clear;
  DownloadPage.Add(WebView2Url, 'MicrosoftEdgeWebview2Setup.exe', '');
  DownloadPage.Show;
  try
    try
      DownloadPage.Download;
    except
      if not DownloadPage.AbortedByUser then
        SuppressibleMsgBox('Não consegui baixar o WebView2: ' + AddPeriod(GetExceptionMessage) + #13#10 +
          'O Llama Studio vai abrir no navegador até ele ser instalado.', mbError, MB_OK, IDOK);
      NeedWebView2 := False;
    end;
  finally
    DownloadPage.Hide;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Cfg: String;
begin
  if CurStep <> ssPostInstall then Exit;
  if NeedWebView2 and FileExists(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe')) then
  begin
    WizardForm.StatusLabel.Caption := 'Instalando o Microsoft Edge WebView2...';
    Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code);
  end;
  // marca esta pasta como a do llama (o motor e os modelos ficam aqui dentro)
  Cfg := ExpandConstant('{app}\llama-gui.json');
  if not FileExists(Cfg) then
    SaveStringToFile(Cfg, '{ "ServerExe": "", "Model": "", "BindHost": "127.0.0.1", "Port": 1235, "Context": 32768, "CpuMoe": 0, "Threads": 0, ' +
      '"HipDevices": "", "ExtraArgs": "-ngl 99 -fa on --jinja --cache-reuse 256", "AutoStart": false }', False);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep <> usPostUninstall then Exit;
  if not DirExists(ExpandConstant('{app}')) then Exit;
  if SuppressibleMsgBox('Apagar também as conversas, configurações, motores e modelos baixados (pasta ' + ExpandConstant('{app}') + ')?' + #13#10 +
       'Escolha Não para manter e reaproveitar numa próxima instalação.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES then
    DelTree(ExpandConstant('{app}'), True, True, True);
end;
