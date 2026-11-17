# Один постоянный процесс: музыка, управление плеером, громкость. Читает команды из stdin, отвечает одной строкой.
param([string]$Mode = 'music')
[Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public class K { [DllImport("user32.dll")] public static extern void keybd_event(byte v, byte s, int f, int e);
  public static void Tap(byte v) { keybd_event(v, 0, 1, 0); keybd_event(v, 0, 3, 0); } }
'@
if ($Mode -eq 'fast') { try {
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int f(); int g(); int h(); int i(); int SetMasterVolumeLevelScalar(float lv, Guid c); int j(); int GetMasterVolumeLevelScalar(out float lv); int k(); int l(); int m(); int n(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool b, Guid c); int GetMute(out bool b); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, out IAudioEndpointVolume v); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-49B9-9B17-AB0CAFE8D3C4")] class MMDeviceEnumeratorComObject { }
public class Audio {
  static IAudioEndpointVolume V() { var e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator; IMMDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d)); var id = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v; Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, IntPtr.Zero, out v)); return v; }
  public static int Get() { float x; V().GetMasterVolumeLevelScalar(out x); return (int)Math.Round(x * 100); }
  public static void Set(int p) { V().SetMasterVolumeLevelScalar(p / 100f, Guid.Empty); }
  public static int Muted() { bool m; V().GetMute(out m); return m ? 1 : 0; }
  public static void Mute(int m) { V().SetMute(m == 1, Guid.Empty); }
}
'@
} catch {} }
$com = $null -ne ('Audio' -as [type])
if ($com) { try { [Audio]::Get() | Out-Null } catch { $com = $false } }

if ($Mode -eq 'music') {
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($t, $type) { $m = $asTask.MakeGenericMethod($type); $n = $m.Invoke($null, @($t)); if ($n.Wait(4000)) { $n.Result } }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

function Sess {
  $pick = $null
  foreach ($x in $mgr.GetSessions()) { if ($x.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') { $pick = $x; break } }
  if (-not $pick) { $pick = $mgr.GetCurrentSession() }
  $pick
}
$script:ck = ''; $script:tries = 0; $script:artOk = $false; $script:lastArtTry = [DateTime]::MinValue
function Music {
  $s = Sess
  if (-not $s) { return 'null' }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $o = @{ title = $p.Title; artist = $p.Artist; status = $s.GetPlaybackInfo().PlaybackStatus.ToString(); app = $s.SourceAppUserModelId }
  $key = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
  if ($key -ne $script:ck) { $script:ck = $key; $script:tries = 0; $script:artOk = $false; $o.art = '' }
  # обложка (особенно в браузерах) появляется с задержкой: пока играет — пробуем каждые 2.5 сек
  if (-not $script:artOk -and (($o.status -eq 'Playing') -or $script:tries -lt 4) -and (([DateTime]::UtcNow - $script:lastArtTry).TotalMilliseconds -ge 2500)) {
    $script:lastArtTry = [DateTime]::UtcNow; $script:tries++
    try {
      if ($p.Thumbnail) {
        $str = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead([Windows.Storage.Streams.IInputStream]$str)
        $ms = New-Object IO.MemoryStream
        $net.CopyTo($ms)
        if ($ms.Length -gt 0) { $o.art = [Convert]::ToBase64String($ms.ToArray()); $script:artOk = $true }
      }
    } catch {}
  }
  return ($o | ConvertTo-Json -Compress)
}
# --- Wi-Fi / Bluetooth через Radio API (без прав администратора) ---
[Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Radios.RadioAccessStatus, Windows.System.Devices, ContentType=WindowsRuntime] | Out-Null
[Windows.Devices.Radios.RadioState, Windows.System.Devices, ContentType=WindowsRuntime] | Out-Null
try { Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null } catch {}
function RadioList { Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]]) }
function RadioGet([string]$kind) {
  try { foreach ($x in (RadioList)) { if ($x.Kind.ToString() -eq $kind) { if ($x.State.ToString() -eq 'On') { return 1 } else { return 0 } } } } catch {}
  return -1
}
function RadioSet([string]$kind, [int]$on) {
  foreach ($x in (RadioList)) { if ($x.Kind.ToString() -eq $kind) { Await ($x.SetStateAsync($(if ($on -eq 1) { 'On' } else { 'Off' }))) ([Windows.Devices.Radios.RadioAccessStatus]) | Out-Null } }
}
}
$est = 50; $mst = 0
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
while ($null -ne ($l = [Console]::In.ReadLine())) {
  $p = $l.Trim().Split(' '); $out = 'OK'
  try {
    switch ($p[0]) {
      'music' { $r = @(Music); $out = $r[-1] }
      'ctl' {
        $s = Sess
        if ($s) {
          switch ($p[1]) {
            'toggle' { $s.TryTogglePlayPauseAsync() | Out-Null }
            'next' { $s.TrySkipNextAsync() | Out-Null }
            'prev' { $s.TrySkipPreviousAsync() | Out-Null }
          }
        } else { $kk = @{ toggle = 179; next = 176; prev = 177 }[$p[1]]; if ($kk) { [K]::Tap([byte]$kk) } }
      }
      'net' {
        $rx = [long]0; $tx = [long]0
        foreach ($n in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
          if ($n.OperationalStatus -eq 'Up' -and $n.NetworkInterfaceType -ne 'Loopback' -and $n.NetworkInterfaceType -ne 'Tunnel') { $s = $n.GetIPv4Statistics(); $rx += $s.BytesReceived; $tx += $s.BytesSent }
        }
        $out = "N $rx $tx"
      }
      'radio' {
        if ($p[1] -eq 'wifi' -and $p[2]) { RadioSet 'WiFi' ([int]$p[2]) }
        elseif ($p[1] -eq 'bt' -and $p[2]) { RadioSet 'Bluetooth' ([int]$p[2]) }
        $out = "R $(RadioGet 'WiFi') $(RadioGet 'Bluetooth')"
      }
      'br' {
        try {
          if ($p[1] -eq 'set') { Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{ Timeout = [uint32]1; Brightness = [byte][int]$p[2] } | Out-Null }
          $out = 'B ' + [int](Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness
        } catch { $out = 'B -1' }
      }
      'vol' {
        $n = [int]$p[2]
        if ($com) {
          if ($p[1] -eq 'set') { [Audio]::Set($n) } elseif ($p[1] -eq 'mute') { [Audio]::Mute($n) }
          $est = [Audio]::Get(); $mst = [Audio]::Muted()
        } else {
          if ($p[1] -eq 'set') { $d = [int][math]::Round(($n - $est) / 2); for ($i = 0; $i -lt [math]::Min(50, [math]::Abs($d)); $i++) { [K]::Tap([byte]$(if ($d -gt 0) { 175 } else { 174 })) }; $est = $n }
          elseif ($p[1] -eq 'mute') { if ($n -ne $mst) { [K]::Tap([byte]173) }; $mst = $n }
        }
        $out = "V $est $mst $(if ($com) { 1 } else { 0 })"
      }
    }
  } catch { $out = $(if ($p[0] -eq 'music') { 'null' } elseif ($p[0] -eq 'vol') { "V $est $mst" } else { 'OK' }) }
  [Console]::Out.WriteLine($out); [Console]::Out.Flush()
}
