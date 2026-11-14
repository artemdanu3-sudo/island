Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int f(); int g(); int h(); int i(); int SetMasterVolumeLevelScalar(float lv, Guid c); int j(); int GetMasterVolumeLevelScalar(out float lv); int k(); int l(); int m(); int n(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool b, Guid c); int GetMute(out bool b); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int ctx, IntPtr p, out IAudioEndpointVolume v); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d); }
[ComImport, Guid("BCDE0395-E52F-49B9-9B17-AB0CAFE8D3C4")] class MMDeviceEnumeratorComObject { }
public class Audio {
  static IAudioEndpointVolume V() { var e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator; IMMDevice d; e.GetDefaultAudioEndpoint(0, 1, out d); var id = typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v; d.Activate(ref id, 23, IntPtr.Zero, out v); return v; }
  public static int Get() { float x; V().GetMasterVolumeLevelScalar(out x); return (int)Math.Round(x * 100); }
  public static void Set(int p) { V().SetMasterVolumeLevelScalar(p / 100f, Guid.Empty); }
  public static int Muted() { bool m; V().GetMute(out m); return m ? 1 : 0; }
  public static void Mute(int m) { V().SetMute(m == 1, Guid.Empty); }
}
'@
while ($null -ne ($l = [Console]::In.ReadLine())) {
  $p = $l.Trim().Split(' ')
  try { if ($p[0] -eq 'set') { [Audio]::Set([int]$p[1]) } elseif ($p[0] -eq 'mute') { [Audio]::Mute([int]$p[1]) } } catch {}
  try { "$([Audio]::Get()) $([Audio]::Muted())" } catch { '0 0' }
  [Console]::Out.Flush()
}
