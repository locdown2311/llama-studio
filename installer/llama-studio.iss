; Instalador do Llama Studio (Inno Setup 6.2 ou mais novo).
; O CI passa a versão e os links do llama.cpp (fixados na versão do momento):
;   ISCC /DAppVersion=2.9.3 /DLlamaTag=b7000 /DUrlVulkan=... /DUrlCuda=... /DUrlCudart=... /DUrlHip=... /DUrlCpu=... llama-studio.iss
; Instala por usuário (sem pedir administrador), em %LOCALAPPDATA%\Programs\Llama Studio,
; para que as atualizações de dentro do programa consigam trocar o executável.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef LlamaTag
  #define LlamaTag ""
#endif
#ifndef UrlVulkan
  #define UrlVulkan ""
#endif
#ifndef UrlCuda
  #define UrlCuda ""
#endif
#ifndef UrlCudart
  #define UrlCudart ""
#endif
#ifndef UrlHip
  #define UrlHip ""
#endif
#ifndef UrlCpu
  #define UrlCpu ""
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
Type: filesandordirs; Name: "{app}\llama-path"
Type: files; Name: "{app}\llama-studio.antigo.exe"
Type: files; Name: "{app}\llama-studio.novo.exe"

[Code]
const
  WebView2Key = 'Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  WebView2Url = 'https://go.microsoft.com/fwlink/p/?LinkId=2124703';
  E_VULKAN = 0; E_CUDA = 1; E_HIP = 2; E_CPU = 3; E_KEEP = 4;

var
  EnginePage: TInputOptionWizardPage;
  DownloadPage: TDownloadWizardPage;
  Gpus: String;
  NeedWebView2: Boolean;
  KeepChecked: Boolean;

function GpuNames: String;
var
  Locator, Service, Items, Item: Variant;
  I: Integer;
begin
  Result := '';
  try
    Locator := CreateOleObject('WbemScripting.SWbemLocator');
    Service := Locator.ConnectServer('.', 'root\CIMV2');
    Items := Service.ExecQuery('SELECT Name FROM Win32_VideoController');
    for I := 0 to Items.Count - 1 do
    begin
      Item := Items.ItemIndex(I);
      Result := Result + Item.Name + '; ';
    end;
  except
    Result := '';
  end;
end;

function HasWebView2: Boolean;
var
  V: String;
begin
  Result :=
    (RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\' + WebView2Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0')) or
    (RegQueryStringValue(HKLM, 'SOFTWARE\' + WebView2Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'Software\' + WebView2Key, 'pv', V) and (V <> '') and (V <> '0.0.0.0'));
end;

function EngineUrl(E: Integer): String;
begin
  case E of
    E_VULKAN: Result := '{#UrlVulkan}';
    E_CUDA: Result := '{#UrlCuda}';
    E_HIP: Result := '{#UrlHip}';
    E_CPU: Result := '{#UrlCpu}';
  else
    Result := '';
  end;
end;

function HasEngine: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\llama-cpp\llama-server.exe'));
end;

// procura na hora o pacote HIP/ROCm mais novo das releases do llama.cpp (quando o CI não achou um)
function FindHipUrl: String;
var
  Code: Integer;
  Out, Ps1: String;
  Lines: TArrayOfString;
begin
  Result := '';
  Out := ExpandConstant('{tmp}\hip-url.txt');
  Ps1 := '$r = Invoke-RestMethod -UseBasicParsing -Headers @{''User-Agent''=''llama-studio-setup''} ''https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=40''; ' +
         '$a = $r | ForEach-Object { $_.assets } | Where-Object { $_.name -match ''-bin-win-(hip|rocm).*x64\.zip$'' } | Select-Object -First 1; ' +
         'if ($a) { [IO.File]::WriteAllText(''' + Out + ''', $a.browser_download_url) }';
  if Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'), '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' + Ps1 + '"', '', SW_HIDE, ewWaitUntilTerminated, Code)
     and LoadStringsFromFile(Out, Lines) and (GetArrayLength(Lines) > 0) then
    Result := Trim(Lines[0]);
end;

function OnDownloadProgress(const Url, FileName: String; const Progress, ProgressMax: Int64): Boolean;
begin
  Result := True;
end;

procedure InitializeWizard;
var
  G, Info: String;
  Def: Integer;
begin
  Gpus := GpuNames;
  G := Lowercase(Gpus);
  if Pos('nvidia', G) > 0 then Def := E_CUDA
  else if (Pos('radeon', G) > 0) or (Pos('amd', G) > 0) or (Pos('intel', G) > 0) or (Pos('arc', G) > 0) then Def := E_VULKAN
  else Def := E_CPU;
  if Gpus = '' then Info := 'Não consegui identificar a placa de vídeo.'
  else Info := 'Placa(s) encontrada(s): ' + Gpus;

  EnginePage := CreateInputOptionPage(wpSelectTasks,
    'Motor do llama.cpp',
    'Qual versão do llama-server instalar?',
    'O llama.cpp ({#LlamaTag}) é baixado do GitHub oficial (ggml-org/llama.cpp) durante a instalação. ' + Info + #13#10 +
    'Em dúvida, use Vulkan: funciona em placas AMD, NVIDIA e Intel.',
    True, False);
  EnginePage.Add('Vulkan (recomendado): AMD, NVIDIA e Intel');
  EnginePage.Add('CUDA: placas NVIDIA, em geral o mais rápido nelas (download maior)');
  EnginePage.Add('HIP/ROCm: placas AMD Radeon compatíveis com ROCm');
  EnginePage.Add('Só CPU: sem usar a placa de vídeo');
  EnginePage.Add('Não baixar agora (manter o que já está instalado ou configurar depois)');
  if '{#UrlCuda}' = '' then EnginePage.CheckListBox.ItemEnabled[E_CUDA] := False;
  EnginePage.SelectedValueIndex := Def;

  DownloadPage := CreateDownloadPage(SetupMessage(msgWizardPreparing), 'Baixando o llama.cpp e o que mais for preciso...', @OnDownloadProgress);
  DownloadPage.ShowBaseNameInsteadOfUrl := True;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  // numa reinstalação, sugere manter o motor que já está lá ({app} só existe a partir daqui)
  if (CurPageID = EnginePage.ID) and not KeepChecked then
  begin
    KeepChecked := True;
    if HasEngine then EnginePage.SelectedValueIndex := E_KEEP;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  E, N: Integer;
  Url: String;
begin
  Result := True;
  if CurPageID <> wpReady then Exit;
  E := EnginePage.SelectedValueIndex;
  NeedWebView2 := not HasWebView2;
  DownloadPage.Clear;
  N := 0;
  Url := EngineUrl(E);
  if (E = E_HIP) and (Url = '') then
  begin
    Url := FindHipUrl;
    if Url = '' then
    begin
      SuppressibleMsgBox('O llama.cpp não tem um pacote HIP/ROCm para Windows nas versões recentes.' + #13#10 +
        'Escolha Vulkan (funciona nas placas AMD) ou volte depois.', mbInformation, MB_OK, IDOK);
      Result := False;
      Exit;
    end;
  end;
  if (E <> E_KEEP) and (Url <> '') then
  begin
    DownloadPage.Add(Url, 'llama-engine.zip', ''); N := N + 1;
    if (E = E_CUDA) and ('{#UrlCudart}' <> '') then
    begin
      DownloadPage.Add('{#UrlCudart}', 'llama-cudart.zip', ''); N := N + 1;
    end;
  end;
  if NeedWebView2 then
  begin
    DownloadPage.Add(WebView2Url, 'MicrosoftEdgeWebview2Setup.exe', ''); N := N + 1;
  end;
  if N = 0 then Exit;
  DownloadPage.Show;
  try
    try
      DownloadPage.Download;
    except
      if DownloadPage.AbortedByUser then
        Log('Download cancelado.')
      else
        SuppressibleMsgBox('Não consegui baixar: ' + AddPeriod(GetExceptionMessage) + #13#10 +
          'Confira a internet e tente de novo, ou escolha "Não baixar agora".', mbCriticalError, MB_OK, IDOK);
      Result := False;
    end;
  finally
    DownloadPage.Hide;
  end;
end;

function Ps(const Script: String): Boolean;
var
  Code: Integer;
begin
  Result := Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' + Script + '"',
    '', SW_HIDE, ewWaitUntilTerminated, Code) and (Code = 0);
  if not Result then Log('PowerShell falhou (' + IntToStr(Code) + '): ' + Script);
end;

function Q(const S: String): String;
var
  T: String;
begin
  T := S;
  StringChangeEx(T, '''', '''''', True);
  StringChangeEx(T, '"', '\"', True);
  Result := '''' + T + '''';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  E, Code: Integer;
  Dir, Cfg, Extra: String;
begin
  if CurStep <> ssPostInstall then Exit;
  E := EnginePage.SelectedValueIndex;
  Dir := ExpandConstant('{app}\llama-cpp');

  if NeedWebView2 and FileExists(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe')) then
  begin
    WizardForm.StatusLabel.Caption := 'Instalando o Microsoft Edge WebView2...';
    Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'), '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, Code);
  end;

  if (E <> E_KEEP) and FileExists(ExpandConstant('{tmp}\llama-engine.zip')) then
  begin
    WizardForm.StatusLabel.Caption := 'Extraindo o llama.cpp...';
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM llama-server.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
    DelTree(Dir, True, True, True);
    ForceDirectories(Dir);
    if not Ps('Expand-Archive -LiteralPath ' + Q(ExpandConstant('{tmp}\llama-engine.zip')) + ' -DestinationPath ' + Q(Dir) + ' -Force') then
      SuppressibleMsgBox('Não consegui extrair o llama.cpp. Dá para escolher outro depois em Servidor > Configuração.', mbError, MB_OK, IDOK);
    if FileExists(ExpandConstant('{tmp}\llama-cudart.zip')) then
      Ps('Expand-Archive -LiteralPath ' + Q(ExpandConstant('{tmp}\llama-cudart.zip')) + ' -DestinationPath ' + Q(Dir) + ' -Force');
    // alguns pacotes vêm com uma pasta dentro: traz o conteúdo para cima
    if not FileExists(Dir + '\llama-server.exe') then
      Ps('$s = Get-ChildItem -LiteralPath ' + Q(Dir) + ' -Recurse -Filter llama-server.exe | Select-Object -First 1; ' +
         'if ($s) { Get-ChildItem -LiteralPath $s.DirectoryName | Move-Item -Destination ' + Q(Dir) + ' -Force }');
  end;

  // configuração do llama-server (llama-gui.json): cria se não existir; se existir, só aponta para o motor novo
  Cfg := ExpandConstant('{app}\llama-gui.json');
  if E = E_CPU then Extra := '--jinja -fa auto --cache-reuse 256' else Extra := '-ngl 99 -fa on --jinja --cache-reuse 256';
  if not FileExists(Cfg) then
    Ps('@{ ServerExe = ' + Q(Dir + '\llama-server.exe') + '; Model = ''''; BindHost = ''127.0.0.1''; Port = 1235; Context = 32768; ' +
       'CpuMoe = 0; Threads = 0; HipDevices = ''''; ExtraArgs = ' + Q(Extra) + '; AutoStart = $false } | ConvertTo-Json | ForEach-Object { [IO.File]::WriteAllText(' + Q(Cfg) + ', $_) }')
  else if E <> E_KEEP then
    Ps('$j = Get-Content -Raw -LiteralPath ' + Q(Cfg) + ' | ConvertFrom-Json; $j.ServerExe = ' + Q(Dir + '\llama-server.exe') + '; ' +
       '[IO.File]::WriteAllText(' + Q(Cfg) + ', ($j | ConvertTo-Json))');
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep <> usPostUninstall then Exit;
  if not DirExists(ExpandConstant('{app}')) then Exit;
  if SuppressibleMsgBox('Apagar também as conversas, configurações e modelos baixados (pasta ' + ExpandConstant('{app}') + ')?' + #13#10 +
       'Escolha Não para manter e reaproveitar numa próxima instalação.', mbConfirmation, MB_YESNO or MB_DEFBUTTON2, IDNO) = IDYES then
    DelTree(ExpandConstant('{app}'), True, True, True);
end;
