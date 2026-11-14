param([string]$Last = 'T:')
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($t, $type) { $m = $asTask.MakeGenericMethod($type); $n = $m.Invoke($null, @($t)); $n.Wait(-1) | Out-Null; $n.Result }
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IInputStream, Windows.Storage.Streams, ContentType=WindowsRuntime] | Out-Null
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$s = $mgr.GetCurrentSession()
if ($s) {
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $st = $s.GetPlaybackInfo().PlaybackStatus.ToString()
  [Console]::OutputEncoding = [Text.Encoding]::UTF8
  $o = @{ title = $p.Title; artist = $p.Artist; status = $st; app = $s.SourceAppUserModelId }
  # обложку отдаём только когда сменился трек
  if ($p.Title -ne $Last.Substring(2)) {
    $o.art = ''
    try {
      if ($p.Thumbnail) {
        $str = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
        $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead([Windows.Storage.Streams.IInputStream]$str)
        $ms = New-Object IO.MemoryStream
        $net.CopyTo($ms)
        $o.art = [Convert]::ToBase64String($ms.ToArray())
      }
    } catch {}
  }
  $o | ConvertTo-Json -Compress
}
