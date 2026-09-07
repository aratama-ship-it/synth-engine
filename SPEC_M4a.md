# SPEC M4a — Built-in Wavetable Palette

対象: `core/src/wavetable.*`、`shells/web/synth.*`。前提: M3c3完了（パラメータ0〜75、engine version 8）。

## 目的

既存の4 wavetable slotとMorphパラメータを維持したまま、slot 1〜3でも位置変化が音色変化になる内蔵パレットを作る。Reverbを複雑化せず、音源側の素材を増やす最初の垂直スライスとする。

## 契約

- 4 slotすべてを4 frame、2048 sample、10 mip levelで初期化する。
- slot名は `Basic Shapes / Analog Sweep / Digital Edge / Hollow Formant`。
- 各slotのframe 0は従来の `Sine / Saw / Square / Triangle`を同じ生成式で維持する。
- frame間は既存の線形補間、sample間は既存の線形補間、mip選択も既存ロジックを維持する。
- 新frameは高調波係数から非RT初期化時に生成する。音声処理ループへFFT・追加AudioNode・追加パラメータを入れない。
- slot 1〜3のframe 1〜3は、同slotのframe 0とpeakを揃え、位置移動による不意な音量差を抑える。
- C ABIとパラメータ数は不変。OSC A/Bのslot selectorをともに整数へ揃え、slot 1〜3のMorph解釈が変わるため`engine version`を9へ上げる。

## 検証

1. OSC A/Bのslot selectorがともにintegerで、全4 slotのframe countが4、全sampleがfinite。
2. slot 1〜3のframe 0とframe 3の差分RMSが0.25以上。
3. slot 1〜3のframe 0 / frame 3のpeak差が1e-5以下。
4. 従来のSine / Saw先頭frameを使うgolden renderがビット一致。
5. 全core test、freestanding build、WASM build、Web testを通す。
6. Web UIで4名称、POSによる波形図と音の連続変化、最初の鍵盤操作での発音を確認する。

## 今回含めないもの

- `.wav` / Serum wavetable import
- 任意frame数、wavetable editor、spectral editor
- 追加OSC、warp mode、FM方式の拡張
- Reverbの追加作り込み
