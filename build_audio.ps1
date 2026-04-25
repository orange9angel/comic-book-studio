$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$AudioDir = Join-Path $Root "assets\audio"
New-Item -ItemType Directory -Force -Path $AudioDir | Out-Null

$Lines = @(
  @{ File = "voice_01.wav"; Text = "雨后的街角，小岚和豆豆，捡到一封发光的银色信。"; Start = 0.45 },
  @{ File = "voice_02.wav"; Text = "信封展开，阁楼里亮起一张星图。"; Start = 6.65 },
  @{ File = "voice_03.wav"; Text = "信纸折成小船，载着他们飞过屋顶。"; Start = 13.05 },
  @{ File = "voice_04.wav"; Text = "云层深处，一颗小星星被雨线缠住了。"; Start = 19.45 },
  @{ File = "voice_05.wav"; Text = "天亮时，小星星回到天空，城市也亮了起来。"; Start = 25.85 }
)

$Voice = New-Object -ComObject SAPI.SpVoice
$Huihui = $Voice.GetVoices() | Where-Object { $_.GetDescription() -like "*Huihui*" } | Select-Object -First 1
if ($Huihui) {
  $Voice.Voice = $Huihui
}
$Voice.Rate = 1
$Voice.Volume = 100

foreach ($Line in $Lines) {
  $Path = Join-Path $AudioDir $Line.File
  $Stream = New-Object -ComObject SAPI.SpFileStream
  $Stream.Open($Path, 3, $false)
  $Voice.AudioOutputStream = $Stream
  [void]$Voice.Speak($Line.Text, 0)
  $Stream.Close()
}

$FlipPath = Join-Path $AudioDir "page_flip.wav"
ffmpeg -y -f lavfi -i "anoisesrc=d=0.42:c=pink:r=48000" -af "highpass=f=650,lowpass=f=5200,afade=t=in:st=0:d=0.025,afade=t=out:st=0.22:d=0.20,volume=0.20" -ac 2 $FlipPath

$VoiceInputs = @()
$VoiceFilters = @()
for ($i = 0; $i -lt $Lines.Count; $i++) {
  $VoiceInputs += "-i"
  $VoiceInputs += (Join-Path $AudioDir $Lines[$i].File)
  $Delay = [int]([double]$Lines[$i].Start * 1000)
  $VoiceFilters += "[$($i):a]adelay=$Delay|$Delay,volume=1.25[v$i]"
}
$VoiceMixInputs = (0..($Lines.Count - 1) | ForEach-Object { "[v$_]" }) -join ""
$DialoguePath = Join-Path $AudioDir "dialogue.wav"
$VoiceMix = "${VoiceMixInputs}amix=inputs=$($Lines.Count):duration=longest:normalize=0,aresample=48000[dialogue]"
$VoiceFilter = ($VoiceFilters + $VoiceMix) -join ";"
ffmpeg -y @VoiceInputs -filter_complex $VoiceFilter -map "[dialogue]" -acodec pcm_s16le -ar 48000 $DialoguePath

$BgmIn = Join-Path $AudioDir "pixabay_bgm.mp3"
$BgmPath = Join-Path $AudioDir "bgm.wav"
ffmpeg -y -stream_loop -1 -i $BgmIn -t 32 -af "volume=0.18,afade=t=in:st=0:d=1.2,afade=t=out:st=29:d=3" -ac 2 -ar 48000 $BgmPath

$SfxInputs = @()
$SfxFilters = @()
$FlipTimes = @(5.6, 12.0, 18.4, 24.8)
for ($i = 0; $i -lt $FlipTimes.Count; $i++) {
  $SfxInputs += "-i"
  $SfxInputs += $FlipPath
  $Delay = [int]([double]$FlipTimes[$i] * 1000)
  $SfxFilters += "[$($i):a]adelay=$Delay|$Delay,volume=1.8[s$i]"
}
$SfxMixInputs = (0..($FlipTimes.Count - 1) | ForEach-Object { "[s$_]" }) -join ""
$SfxPath = Join-Path $AudioDir "sfx.wav"
$SfxMix = "${SfxMixInputs}amix=inputs=$($FlipTimes.Count):duration=longest:normalize=0,aresample=48000[sfx]"
$SfxFilter = ($SfxFilters + $SfxMix) -join ";"
ffmpeg -y @SfxInputs -filter_complex $SfxFilter -map "[sfx]" -acodec pcm_s16le -ar 48000 $SfxPath

$MixedPath = Join-Path $AudioDir "mixed.wav"
ffmpeg -y -i $DialoguePath -i $BgmPath -i $SfxPath -filter_complex "[0:a]volume=1.2[d];[1:a]volume=1.0[b];[2:a]volume=1.0[s];[d][b][s]amix=inputs=3:duration=longest:normalize=0,alimiter=limit=0.95[out]" -map "[out]" -acodec pcm_s16le -ar 48000 $MixedPath

Write-Host "Audio written to $MixedPath"
