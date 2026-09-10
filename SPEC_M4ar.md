# M4ar — External preset bridge foundation

## 目的

他社シンセのpresetを同一音として再生すると主張せず、読めた設定をSynthEngineの編集可能なpatchへ近似変換する入口を作る。最初の実動対象は、このMac上の実ファイル構造を確認できたSerum 2 `.SerumPreset`とする。

## 対応境界

- Serum 2: `XferJson` header、JSON metadata、Zstandard圧縮CBOR payloadをローカルで検証して読む。
- Serum 1 `.fxp`: 公式にSerum 2から読める形式だが、このwaveでは構造未確認のため変換しない。
- Massive `.nmsv`: 公式にcustom preset形式であることだけ確認済み。実sample入手までparserを実装しない。
- Avenger: 公式manualでpreset browserとsample / wavetable importを確認したが、preset内部形式は未確認。実sample入手までparserを実装しない。
- factory preset原本、展開payload、wavetable、sample、画像をworkspaceへ複製しない。入力はread-only、出力は数値中心のSynthEngine patchと変換reportだけにする。
- 原本と同じ出力先、patch / reportの重複先、既存ファイルへの暗黙の上書きを拒否する。

## 変換契約

- 出力patchは既存schema 1を使い、`IMPORT JSON`から読み込める。
- source側の値を確認できた項目だけ変換する。単位または曲線が一致しない項目は`approximate`、対応先が無い項目は`unsupported`へ記録する。
- 初期sliceはOSC A/B enable・level・wavetable position・warp amount、AMP envelope、filter enable・cutoff・resonance、master levelの候補を対象とし、実payloadの型と単位を検証してから個別mapを有効化する。
- 他社wavetable名だけからSynthEngineの内蔵tableを推測しない。波形資産を伴わない場合はBasic Shapesを保ち、reportへ`source wavetable not transferred`と残す。
- macro / modulationはM4atでENV 1..3 / Macro 1..4の単純な1-source routeだけを既存6-slot Matrixへ近似する。Aux、bipolar、curve、LFO、未知destinationは自動適用しない。FXは同じ信号経路と単位を確認できるまで自動適用しない。
- 他社側のmaster値は単位差があるため、初回ローカル試聴patchではSynthEngineの`MASTER`を最大`0.20`へ制限する。必要な音量調整は比較後に手動で行う。
- 未変換の空間系を既定値で足さないよう、出力patchはWeb側のDelay / Reverbを明示的にOFFにする。Insert FXも空のままにする。
- 非有限値、過大header / payload、深すぎるCBOR、未知compression、壊れたmapは失敗として入力全体を拒否する。

## UI / UX契約

- このwaveはPatch Toolsの既存`IMPORT JSON`を出口にし、CLI変換と判断用HTMLを先に完成させる。ブラウザ直読みに必要な圧縮decoderの配布判断は次waveへ分ける。
- 判断用HTMLでは、形式ごとに`WORKING / SAMPLE NEEDED / FORMAT UNKNOWN`、変換数、近似数、未対応数を文字で示す。
- ローカル試聴セットはLead `Pianofy` / Bass `Morpheus` / SYNC Bass `Neon Drive`の3件に絞り、patch JSONとmapping reportを対にする。原本Serum presetは複製せず、source hashと数値出力だけを記録する。
- SYNC候補はsource wavetableを転送できないため、原音一致ではなくfallback波形へ移したSYNC量の有用性だけを判断対象にする。外部Serum 2との音量一致や自動A/Bは主張しない。
- 将来UIへ置く場合も新タブを増やさず、Patch Tools内の`PRESET BRIDGE`へ集約する。

## 合格条件

1. syntheticなSerum 2 containerを決定的にdecodeし、壊れたheader / size / compression / CBORを拒否する。
2. このMac上のSerum 2実ファイルをread-onlyでdecodeでき、原本hash / mtimeが変わらない。
3. 変換patchが既存`validatePatch`を通り、mapped / approximate / unsupportedをreportで区別する。
4. factory contentや展開payloadをrepoへ追加しない。
5. Massive / Avengerを未検証のまま対応済みと表示しない。
6. CLIがsource overwrite、重複出力先、既存出力への上書きをfail-closedで拒否する。
7. 変換patchの`MASTER`が`0.20`以下で、Delay / ReverbがOFFのまま`validatePatch`を通る。
