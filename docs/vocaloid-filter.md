# vocaloid — ピッチを変えない歌声フィルター

普通の生成歌声の音色・音量変化を加工する独立 ES module。既存3アプリには組み込んでいない。エフェクト名は `vocaloid`、操作は強度1つ。VOCALOID のエンジンや特定の歌手を再現するものではなく、明るく均一な質感を目指したプリセットである。「ボカロらしいか」の最終判断は聴き比べが必要。

## 起動・使い方

Node 20+、ffmpeg / ffprobe、ブラウザを使用する。`npm ci --ignore-scripts` で依存を用意する。DSP 自体は依存なし、ブラウザ MP3 は lamejs、テストは puppeteer-core を使用する。

```sh
npm run demo
# http://127.0.0.1:5447/demo/vocaloid/
# Ctrl-C で終了。VOCALOID_PORT=5450 npm run demo も可（5400〜5499限定）

node cli/vocaloid-filter.js --input in.wav --output out.mp3 --amount 0.5
# --input は WAV / MP3、--output 既定 vocaloid.mp3、192 kbps MP3。
# --pcm-output out/check.f32 は検証用の符号化前 Float32 PCM。
```

デモで歌声を選び、強度を調整して「この強度で処理」を押す。原音・処理音を再生して比較でき、処理した強度の MP3 を保存できる。ファイルを送信する処理や CDN はない。mono / stereo 対応。PCM WAV は8/16/24/32bit整数・32/64bit floatを符号付き値の共通スケールで直接読み込み、サンプルレートも維持。それ以外の対応コーデックはブラウザ標準デコーダーを使う。ブラウザ MP3 入力は44.1 kHzにデコード。CLI は入力レートを維持する（MP3 符号化が未対応のレートは ffmpeg 側で変換される）。同じサンプルレートと PCM を渡せば両版の DSP は同じ結果になる。多チャンネルは CLI のみ各チャンネル独立処理。

```js
import { applyVocaloid } from './effects/vocaloid/dsp.js';
const processed = applyVocaloid(inputFloat32, 44100, 0.5);

// Web Audio: AudioBuffer を直接処理、または OfflineAudioContext で render。
import { applyVocaloidBuffer, renderVocaloid } from './effects/vocaloid/browser.js';
const buffer = applyVocaloidBuffer(inputBuffer, amount, audioContext);
const offlineBuffer = await renderVocaloid(inputBuffer, amount);
```

有効な PCM / 8〜192 kHz を前提とする。`amount <= 0` は同じ入力配列を返す完全な素通し、`amount > 1` は1に制限。±Infinity の強度は端点に制限、NaN・不正な型・非有限サンプル・範囲外レートは例外。非ゼロ強度は新しい配列、入力を変更しない。フレーム数とサンプルレートは変わらない。0 も MP3 への再符号化による差は生じる。

処理はファイル全体を先に計算する。ライブ入力のストリーミング AudioWorklet ではない。デモは DSP とエンコードを Worker、再生を AudioContext、書き出し前の同一サンプル経路を OfflineAudioContext で動かす。長時間ファイルはメモリと処理時間に注意。ステレオはチャンネルごとのダイナミクス処理なので定位が変わる場合がある。

## 処理チェーン（実装値）

1. **弱い部分を抑えるエキスパンダ**: RMS 包絡（attack 4 ms / release 80 ms）、閾値 −48 dBFS、比率1〜3、最大減衰36 dB、ゲイン平滑25 ms。小さなブレスやノイズを抑える。大きな息を分離する AI ノイズ除去ではなく、子音も影響を受ける。
2. **強いコンプレッション**: 同じ RMS 包絡、閾値 −24 dBFS、比率1〜8、メイクアップ0〜8 dB。音量の細かい揺れを減らす。全体の無音区間を含む DR と、発声区間だけの DR は区別する。
3. **フォルマント上方シフト**: 最大1.8半音相当（周波数比約1.11）の包絡シフト。これは F0 の半音操作ではない。約46 msの2冪FFT窓、hop N/4、Hann窓の解析と合成、重なりの二乗和で正規化。log振幅 → IFFT → 1 ms raised-cosine lifter → FFT で包絡を抽出。`exp(E(k/r) − E(k))` を元の複素スペクトルに掛ける。各ビンの位置と位相はそのまま、補償は±9 dB、100 Hz以下は原包絡、100〜300 Hzで徐々に適用。前後をゼロ拡張して元の長さに戻す。ピッチ検出・補正・位相進行の変更・リサンプリング・タイムストレッチは行わない。
4. **ローカット**: 90 Hz、Q≈0.707の2次 high-pass と原信号を強度で混合。
5. **明瞭さとエア / 歯擦音制御**: 3.2 kHz peaking 最大+4 dB / Q=0.8、9 kHz high-shelf 最大+3 dB。5.5 kHz high-pass 成分の RMS（2/40 ms）で −30 dBFS以上を検出し最大6 dBだけ高域成分を抑える簡易split-band de-esser。フィルター周波数は低レート時0.45×sampleRate以下に制限。RBJ biquad式を使用。
6. **軽いサチュレーション**: drive 1〜1.6の `tanh(drive*x)/drive` と原信号を強度で混合。最後に必要なときだけ一定ゲインで sample peak ≤0.94を確保。true-peak limiterではない。オーバーサンプリングなしの軽い飽和なので、強い高域入力にはエイリアスがあり得る。
7. **ダブリングは省略**: 単一モノラル歌声の輪郭を優先。固定短遅延でもコムフィルターが生じるため、今回の目的に必須とはしなかった。

音量の均一化と明瞭さを一緒に強める設計。大きなフォルマント変化やボコーダー処理ではなく、ピッチの表情を残した軽度の音色加工にする。

## 短い根拠調査（2026-11-13 に本文確認）

一次資料 / メーカー資料:

- [Yamaha VOCALOID6 Reference Manual, p.51「Character」「Pitch Bend」](https://rsc-net.vocaloid.com/assets/pdf_files/bb/VOCALOID_Reference_Manual_ENG.pdf#page=51): Character は発音のフォルマントを調整し、Pitch Bend は音高を調整する別パラメーターとして説明される。[公式6.3更新説明](https://www.vocaloid.com/en/learn/ln6212/) は Character が旧 Gender Factor に相当すると明記。ここから、音高を動かさず声の印象を変える方向を採用した。本フィルターの1.8半音という値は独自設計で、公式パラメーターとの数値的互換性はない。
- [Shure「How to Record and Mix Vocals」EQ / Compression](https://www.shure.com/en-EU/insights/how-to-record-and-mix-vocals): 約100 Hzのハイパス、3〜7 kHzの明瞭さ、8 kHz以上のエア、強いコンプの出発点3:1〜7:1を挙げる。今回の90 Hz / 3.2 kHz / 9 kHzはこの範囲を参考にした設計。8:1は均一さを強調する独自設定であり、万能の推奨値ではない。
- [iZotope「Vocal mixing cheat sheet」§2〜5](https://www.izotope.com/community/blog/vocal-cheet-sheet): ローカット、5〜8 kHzの歯擦音処理、コンプ、軽い歪み、後段のEQ・ディエッサーなどを説明。特定の順序だけが定石なのではなく、素材に合わせて順序も調整する。今回の控えめなエキスパンダとコンプ先行は、生成歌声の音量を整えてから包絡を分析するための選択。
- [iZotope「8 Tips for Mixing Rap and Hip-Hop」§4](https://www.izotope.com/community/blog/8-tips-for-mixing-rap-and-hip-hop): ダブルや vocal throws の音色をフォルマントで変え、ピッチは変えない使い方を説明。これは**一般的なポップ／ラップの制作例**であって、「ボカロ曲で必須」とする根拠ではない。今回はダブリングそのものを採用しなかった。

DSP の一次に近い技術資料:

- Julius O. Smith [Spectral Audio Signal Processing: Parameter Modifications](https://www.dsprelated.com/freebooks/sasp/Parameter_Modifications_Step_6.html) は倍音の周波数と包絡の分離で、ピッチだけ／フォルマントだけの変更を説明。[Cepstral Windowing](https://www.dsprelated.com/freebooks/sasp/Spectral_Envelope_Cepstral_Windowing.html) はlog振幅・実ケプストラム・lifterによる平滑包絡を説明。本実装はこの考え方を独自に記述した。音高を変更する位相ボコーダーは使用していない。
- Robert Bristow-Johnson [Audio EQ Cookbook (W3C)](https://www.w3.org/TR/audio-eq-cookbook/) の high-pass / peaking / shelvingの式を使用。

指定された [Sound on Sound「Vocal Processing」](https://www.soundonsound.com/techniques/vocal-processing) はアクセス時 HTTP 403 で本文未確認のため、根拠として引用しない。Crypton配布の旧Yamahaマニュアルは先頭の取得後に HTTP 503 となり該当箇所を確認できず、上記の現行公式マニュアルを使った。ネットワーク設定やサービスの復旧操作はしていない。

一般ボーカルのゲート／コンプ／EQ／ディエッサーは標準的な処理である。一方、このチェーンが「ボカロ曲の共通手法」であると確認できたわけではない。2〜5 kHzを含む明瞭さの調整やフォルマントを変えるダブルの例は、上記の一般制作資料として範囲を限定して扱う。未確認の二次情報によるボカロ固有の定石は主張しない。

## 検証

```sh
node --test tests/vocaloid.test.js
node tests/render-cli.js
node tests/browser.js
python3 tests/analyze.py
git diff --check
```

サンプルは環境変数 `VOCALOID_SAMPLE`、CLI MP3の出力先は `VOCALOID_DEMO_DIR` で変更可。規定値は依頼された `/workspace/vocaloid-filter-demo/`。ブラウザテストは5447のみで起動し `finally` でサーバーとChromeを終了。音声と生PCM・スクリーンショット・生ログは `out/` または指定外部ディレクトリにのみ保存しgit追跡しない。最終数値・受け入れ判定は [REPORT.md](../REPORT.md) に記録する。

F0検査は全入力共通の4次1200Hzローパスを先に適用してからYIN型推定を行う。フォルマントやEQで変わる高域による推定器の偏りを抑えるためであり、エフェクト自体の処理ではない。既知の200Hz/650Hz、および実際に50cent異なる2つの合成波で推定器の検出能力も確認する。未前処理での初回結果と診断はREPORTに残す。

最終到達点: 単体8/8、CLIとブラウザの3強度保存・実再生はPASS。数値試験は50/51で**全体FAIL**（650Hz合成波の推定器精度が約2.83cent差となり、追加陽性対照の2cent許容を超えた）。歌声のF0中央値差は最大0.38cent、その他の出力検査はPASS。修復2回の上限により追加修正は行わず終了。詳細はREPORTを参照。
