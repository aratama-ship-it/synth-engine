# M4av — Serum 2 source correction and safe drive approximation

## 目的

本人のPianofy A/B試聴で確認された「Serum 2原音よりSynthEngine近似がかなり穏やか」という差に対し、画面とdecoded payloadを突き合わせて、誤っていたmodulation source番号を修正する。同時に、原音のFilter DriveとTape Satを、既存Distortionへ低い上限つきで近似する。

## 確認できた根拠

- Serum 2 MATRIX画面とPianofy payloadの対応から、source ID `3 = ENV 2`、`4 = ENV 3`、`6 = LFO 1`、`17 = Note#`を確認した。
- したがって従来の`source 1..3 = ENV 1..3`は1段ずれていた。M4avでは`2 = ENV 1`、`3 = ENV 2`、`4 = ENV 3`へ修正する。
- Pianofyの`VoiceFilter0.kParamDrive = 22.1575...`、FX Rackの`kTapeSat`と`kParamDrive = 7.0175...`をdecoded payloadで確認した。
- Filter画面にFat操作は見えるが、Pianofyのdecoded `VoiceFilter0.plainParams`にFat値は存在しない。値を推測して補わない。

## Modulation変換

- ENV 2が使われた場合、`Env1` ADSRをSynthEngine Filter Envelopeへ移す。
- ENV 3が使われた場合、`Env2` ADSRをSynthEngine Mod Envelopeへ移す。
- `Oscillator module 3 / kParamVolume`をNoise Levelとして追加する。100%はSynthEngine level +1.0相当になるよう1/4する。
- LFO 1、Note#はlabelだけ正しくし、curve / polarity / LFO modeをまだ再現できない経路は従来どおりskipする。
- Pianofyは6 slotを、ENV 3→Cutoff、ENV 2→Noise/A Level/B Level、Macro 2→A Warp、Macro 1→Cutoffの順で使用する。Sub、OSC C、bipolar Note#経路は未転送。

## Drive / Tape Sat近似

- SynthEngineにSerum VoiceFilter内部のDrive / Fatと同じ位置・アルゴリズムはないため、既存のpost-synth Distortionへ寄与をまとめる。
- Filter Driveは有効なVoiceFilterの値だけを使う。Tape Satは`kParamMode = kTapeSat`を確認できたmoduleだけを使う。
- SynthEngine Distortionは`Drive <= 0.24`、`Mix <= 0.20`へ制限する。Tape Sat frequencyは800–18000 Hzの対数範囲へ近似する。
- Tape Sat以外のDistortion mode、FX routing、EQ、Delay、Reverb、Utility、Compressor、Convolveはこのwaveでは移さない。
- patch MASTERは0.20以下、Delay / ReverbはOFFのままにする。

## 出力と可逆性

- M4atの候補は上書きせず、`design/preset-bridge-20260909/audition-mod-fx-v2/`へ新しい3組のpatch / reportを生成する。
- report version 3に`fxApproximation.profile / distortion / limits`を加える。
- Preset Bridgeの一発起動allowlistだけを新候補へ切り替える。任意pathや外部URLは受けない。

## 合格条件

1. synthetic fixtureでSerum source 3 / 4がENV 2 / 3へ入り、Noise destinationと各ADSRが期待するcore IDへ入る。
2. LFO 1がENV 4と誤表示されず、未対応理由へ正しいlabelが出る。
3. Pianofyの6 Matrix slotが想定順で入り、Master 0.20以下、Delay / Reverb OFFを保つ。
4. 3候補のDistortionがDrive 0.24以下、Mix 0.20以下でschema validationを通る。
5. 物理出力へ接続しないOfflineAudioContextで3候補をrenderし、NaN / Inf 0、peak 0.25以下、note-off後tail 1e-7以下を通す。
6. 一発起動時は従来どおりミュートを保ち、unknown IDはfail closedとする。
