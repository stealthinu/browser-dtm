# vocaloid フィルター報告

## v2 — GOAL（2026-11-15）

同じ純JS APIを維持し、強度1で息・非周期成分を強く抑え、+3〜+5半音の包絡移動と強い音量平坦化によってv1より明確に機械的な歌声音色へ変える。強度0のPCM差は厳密に0。F0の編集は行わず20cent以内、音声・モデルはcommitしない。v1の記録とMP3を保持する。

## v2 — ACCEPTANCE TESTS（実装前に固定）

| コマンド | 合格条件 |
|---|---|
| `node --test tests/vocaloid.test.js` | 素通し・amount範囲・長さ・無音・入力保護・F0・新しい調波/雑音抑制の単体試験が全件PASS |
| `node tests/render-cli.js` | 指定v2ディレクトリへ0 / 0.5 / 1のMP3、比較用PCMを書き出す。v1は上書きしない |
| `node tests/browser.js` | Chrome実再生・同3強度MP3書き出し、非無音、エラー0、adapter一致、サーバー終了 |
| `python3 tests/analyze.py` | 原音との差0（強度0）、重心+800Hzまたは+30%、調波対雑音指標+6dB、固定発声窓DR低下3dB以上、差分RMS>0.10またはRMS正規化後の同等の大きな変化、peak<0.99、clip=0、ドロップアウト0、CLI/ブラウザPCM差<1e-5、F0中央値/対応窓差20cent以内。0/0.5/1とラウドネス整合比較を記録 |
| `git diff --check`、追跡ファイル/サーバー確認 | 音声・モデル・秘密の追跡なし、自分の5400〜5499番サーバー停止 |

測定定義・結果・変更・根拠・commit・sample source・NEXT STEPS・BLOCKED APPROVALSを完了時に追記する。受入試験失敗後の修復は最大2回、CLI切替最大1回（従量API禁止）。開始21:51:27 JST、終了期限23:20 JST（90分以内）。

## v2 — checkpoint / 修復記録（更新中）

- `3260d16`: 目標と受入コマンドを先に記録、push済み。
- `b79d6d5`: 調波ゲート、4.5半音包絡、平坦化、デモ/検査のv2化、push済み。
- 初回CLI・Chrome受入はPASS。単体は8/9、既知200Hz倍音＋白色雑音の独立射影HNRが+3.70dBで6dB基準未達。F0検出は199.95〜200.07Hzと正常だった。全整数倍近傍を無条件で残す処理を確認したため、修復1はピーク対周辺雑音powerの調波確信度を追加する。閾値を緩めず同じ射影テストを再実行する。

## v1（既存報告をそのまま保持）

# vocaloid フィルター最終報告

**実装・指定MP3 6本を作成済み。受入試験は一部未達（数値検証50/51）。修復上限2回に達したため、追加修正せず終了。**

## GOAL

VocaTabの生成歌声を、F0を変えず音色とダイナミクスで「ボカロっぽく」する独立エフェクト `vocaloid` を1つ作る。強度0〜1、0は素通し。既存3アプリへ埋め込まない。

## ACCEPTANCE TESTS と最終結果

| コマンド | 判定 | 実測・条件 |
|---|---|---|
| `node --test tests/vocaloid.test.js` | PASS | 8/8。強度0、範囲、入力保護、長さ、無音、短音、不正値、既知倍音源のF0、包絡上方移動、インパルス時刻 |
| `node tests/render-cli.js` | PASS | 0 / 0.5 / 1のMP3各1本＋MP3入力の追加1件。各379,260 frames |
| `node tests/browser.js` | PASS | Chrome実再生3/3、MP3保存3/3、adapterとデモの最大差0、ブラウザエラー0 |
| `python3 tests/analyze.py` | **FAIL** | **50/51**。出力についての47チェックはすべてPASS。推定器の追加陽性対照4件中650Hz絶対精度のみFAIL |
| `git diff --check` / 追跡ファイル確認 | PASS | 空白エラーなし、wav/mp3/onnx/SoundFont追跡0。5447番の自分のサーバー停止確認済み |

合格基準は、強度0 PCMが原音と一致、同じ強度のCLI/ブラウザPCMが最大差1e-5未満、MP3のRMS・重心差が各5%未満、歌声のF0中央値差と対応窓絶対差中央値が20cent未満、非無音かつクリップ0。非ゼロ強度で差分RMS>0.005、発声区間DRが低下することも確認した。受入試験の失敗を成功扱いにはしていない。

## 実装と処理チェーン（日本語）

- 共通API: `effects/vocaloid/dsp.js` の `applyVocaloid(input: Float32Array, sampleRate: number, amount: number): Float32Array`。0以下は同じ配列を返す。1超は1に制限、出力の長さとレートを維持。
- Web Audio / OfflineAudioContext用adapter: `effects/vocaloid/browser.js`。デモは `demo/vocaloid/`、重い処理とMP3変換はWorker。CLIは `cli/vocaloid-filter.js`、WAV/MP3入力→192kbps MP3出力。DSPは両版とも同じソース。
- 起動: `npm ci --ignore-scripts` → `npm run demo` → `http://127.0.0.1:5447/demo/vocaloid/`。外部公開なし。実行後はCtrl-Cで終了。CLI例: `node cli/vocaloid-filter.js --input in.wav --output out.mp3 --amount 0.5`。

まず−48dBFS付近の弱い部分をエキスパンダで抑え、−24dBFSから最大8:1のコンプレッサーで音量変化を減らす。次にケプストラムで滑らかなスペクトル包絡だけを取り出し、最大1.8半音相当だけ上方に動かす。元の複素スペクトルの周波数位置と位相を保ったまま、包絡の比率だけを掛ける。90Hzローカット、3.2kHzの明瞭さと9kHzのエアを少し持ち上げ、5.5kHz以上の強い歯擦音を抑える。最後に軽いtanh飽和と必要時の一定ゲインでピークを抑える。

ピッチ補正・ケロケロ・ピッチ平坦化・リサンプリング・タイムストレッチはDSPに入れていない。短いダブリングは必須ではないと判断し省略した。ブレス抑制は音量に基づくため、大きな息だけを分離する処理ではない。全ファイルを先に処理する方式で、ストリーミングAudioWorkletではない。長いファイルはメモリを使い、ステレオは各チャンネル独立処理。サチュレーションはオーバーサンプリングなし。

## 根拠調査

処理の根拠・パラメーター・出典は [docs/vocaloid-filter.md](docs/vocaloid-filter.md)。本文を確認した資料は以下。

- [VOCALOID6公式マニュアル p.51](https://rsc-net.vocaloid.com/assets/pdf_files/bb/VOCALOID_Reference_Manual_ENG.pdf#page=51): Characterのフォルマント調整とPitch Bendの音高調整を区別。[公式6.3説明](https://www.vocaloid.com/en/learn/ln6212/) でCharacterは旧Gender Factorに相当することを確認。
- [Shureのボーカル処理解説](https://www.shure.com/en-EU/insights/how-to-record-and-mix-vocals) と [iZotopeのチェーン例](https://www.izotope.com/community/blog/vocal-cheet-sheet): ハイパス、明瞭さ・エアEQ、コンプ、ディエッサー、軽い歪みという一般ボーカル制作の根拠。
- [iZotopeのフォルマントを変えるダブルの例](https://www.izotope.com/community/blog/8-tips-for-mixing-rap-and-hip-hop): ポップ／ラップの制作例であり、ボカロ曲固有の定石だとは主張しない。未確認の二次資料は根拠にしていない。
- [Julius O. Smithの技術解説](https://www.dsprelated.com/freebooks/sasp/Parameter_Modifications_Step_6.html) と [ケプストラム包絡法](https://www.dsprelated.com/freebooks/sasp/Spectral_Envelope_Cepstral_Windowing.html)、[RBJ Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/) を参照。

指定Sound on SoundページはHTTP 403で本文未確認。旧Crypton配布マニュアルは先頭の取得後にHTTP 503となり該当箇所を確認できなかったため、取得できた現行公式資料を使用。ネットワーク設定・サービスの復旧操作は行わず、gitの接続は正常だった。

## 数値結果

原音: 379,260 frames / 44,100 Hz mono / 8.60秒。全出力クリップサンプル0。

| 出力 | RMS dBFS | peak | 重心 Hz | DR 全体/発声 dB | F0 Hz | Δ cent | 対応窓絶対差 中央値/p95 cent | 有声窓 | 遅延 samples |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| source | -24.00 | 0.3097 | 3152.3 | 178.78/6.23 | 334.04 | +0.00 | 0.00/0.00 | 347 | 0 |
| cli-pcm-0 | -24.00 | 0.3097 | 3152.3 | 178.78/6.23 | 334.04 | +0.00 | 0.00/0.00 | 347 | 0 |
| cli-mp3-0 | -24.27 | 0.3007 | 3137.5 | 178.51/6.21 | 334.04 | -0.01 | 0.01/0.04 | 347 | 0 |
| browser-pcm-0 | -24.00 | 0.3097 | 3152.3 | 178.78/6.23 | 334.04 | +0.00 | 0.00/0.00 | 347 | 0 |
| browser-mp3-0 | -24.27 | 0.3017 | 3112.8 | 178.51/6.22 | 334.03 | -0.04 | 0.01/0.04 | 347 | 1105 |
| cli-pcm-0.5 | -23.81 | 0.3038 | 3548.7 | 178.28/4.11 | 333.98 | -0.29 | 0.38/4.64 | 347 | 0 |
| cli-mp3-0.5 | -24.07 | 0.2948 | 3526.0 | 178.01/4.11 | 333.98 | -0.29 | 0.39/4.59 | 347 | 0 |
| browser-pcm-0.5 | -23.81 | 0.3038 | 3548.7 | 178.28/4.11 | 333.98 | -0.29 | 0.38/4.64 | 347 | 0 |
| browser-mp3-0.5 | -24.07 | 0.2947 | 3491.9 | 178.02/4.10 | 333.98 | -0.28 | 0.38/4.66 | 347 | 1105 |
| cli-pcm-1 | -20.02 | 0.4319 | 3694.3 | 181.94/4.01 | 333.97 | -0.36 | 0.42/5.34 | 347 | 0 |
| cli-mp3-1 | -20.28 | 0.4201 | 3664.0 | 181.67/4.02 | 333.97 | -0.37 | 0.41/5.36 | 347 | -1 |
| browser-pcm-1 | -20.02 | 0.4319 | 3694.3 | 181.94/4.01 | 333.97 | -0.36 | 0.42/5.34 | 347 | 0 |
| browser-mp3-1 | -20.28 | 0.4183 | 3618.8 | 181.68/4.02 | 333.97 | -0.37 | 0.41/5.38 | 347 | 1104 |

DRは20ms窓RMSの95–5百分位差。全体DRが約180dBと大きいのは、末尾などの無音窓を−200dBFSで打ち切って計算するため。音量平坦化の評価には、原音の窓RMSが−40dBFSを超える**同じ発声窓**だけを比較した値を用いた（6.23 → 4.11 / 4.01dB）。重心は2048 sample STFTの振幅重み付き全窓集計。

F0は検査用に全入力へ同じ4次1200Hzローパスを適用後、11,025Hz・1024sample窓・220sample hopのYIN型推定。範囲70〜700Hz。原音の連続3窓が60cent以内の安定区間を選び、両方で有声だった347窓を比較。出力のcent差に基づく外れ値除外なし。MP3は相互相関で符号化遅延を測って整列した。これは測定用処理であり、書き出す音声には含めない。

| 強度 | PCM両版 最大絶対差 | MP3両版 RMS相対差 | MP3両版 重心相対差 |
|---|---:|---:|---:|
| 0 | 0.0 | 0.000902% | 0.787252% |
| 0.5 | 1.1102230246251565e-16 | 0.004616% | 0.964742% |
| 1 | 0.0 | 0.000342% | 1.233555% |

強度0のCLI/ブラウザPCMは原音と最大絶対差0。MP3の強度0は符号化によってRMSが約0.27dB下がる。原音との差分RMSは強度0.5で0.017598、強度1で0.052629。各出力の長さは379,260 samples、最大peakは0.432未満。

ブラウザ実再生の検査値:

| 強度 | AudioContext経過 秒 | analyser最大RMS | 保存MP3 bytes |
|---|---:|---:|---:|
| 0 | 2.208 | 0.092899 | 207516 |
| 0.5 | 2.304 | 0.080402 | 207516 |
| 1 | 2.304 | 0.120181 | 207516 |

全測定値と51チェックの機械可読データ: [docs/vocaloid-filter-results.json](docs/vocaloid-filter-results.json)。ブラウザのスクリーンショットは `out/vocaloid-demo.png`（非追跡）。

## 失敗・修復と停止理由

1. 初回ブラウザ試験FAIL: 固定2.5秒待機では起動の遅れる音声時計が2秒に達しなかった。診断で時計の進行とRMS 0.025〜0.063の実信号を確認。修復1は、音声時計が2.2秒進むまで最大8秒の有界待ちに変更。再試験PASS。
2. 初回数値試験FAIL（36/47）: ChromeのWAVデコードで正側の値がffmpegの32768/32767倍となる微差を確認（原音との最大差8.64e-6）。また高域をそのまま含むF0推定は全体中央値差+22.85/+23.01centとなったが、対応窓絶対差中央値0.45/0.65cent、p95は4.79/5.70cent。2〜3窓の推定差が旋律の二群の間にある全体中央値を変えていた。共通ローパスを700/900/1200/1600/2200Hzの5設定で独立診断すると、全体中央値差はすべて−0.82〜+0.25cent、p95は6.16cent以下だったため、音高操作ではなく推定器の音色依存と判断した。
3. 修復2は、ブラウザのPCM WAVを共通スケールで直接読み込む変更と、検査のみの共通1200Hzローパス＋既知周波数の陽性対照追加。**音のDSPは変更せず、ピッチ補正は追加していない。**
4. 最終数値試験は**50/51 FAIL**。200Hzの推定200.032482Hz、既知50cent差は49.834908centと検出。650Hzの推定が651.064039Hz（約+2.83cent）となり、追加陽性対照の2cent許容を超えた。歌声のF0保持基準20centとは別の、推定器そのものの絶対精度テストである。**上限2修復に達したため、閾値変更や追加修復はせず停止。**

生ログ: `out/unit-tests-final.log`, `out/cli-test.log`, `out/browser-test-final.log`, `out/analysis-test-final.log`。初回失敗表は `out/analysis-initial-failure.md` / `.json` に保持（いずれも非追跡）。

## デモMP3とsample source

| 版 | 強度 | ファイル | bytes |
|---|---:|---|---:|
| CLI | 0 | `/workspace/vocaloid-filter-demo/vocaloid-0.mp3` | 208186 |
| CLI | 0.5 | `/workspace/vocaloid-filter-demo/vocaloid-0.5.mp3` | 208186 |
| CLI | 1 | `/workspace/vocaloid-filter-demo/vocaloid-1.mp3` | 208186 |
| browser | 0 | `out/browser-vocaloid-0.mp3` | 207516 |
| browser | 0.5 | `out/browser-vocaloid-0.5.mp3` | 207516 |
| browser | 1 | `out/browser-vocaloid-1.mp3` | 207516 |

6本ともffprobeでMP3 / 44.1kHz / mono、コンテナ上約8.6465秒と確認。CLIのgaplessメタデータとブラウザエンコーダーの遅延情報の違いは、測定時に整列して比較した。

原音: `/workspace/vocaloid-filter-demo/source/vocatab-codex-vocal.wav`。出所は同ディレクトリの `SOURCE.txt`。VocaTabをheadlessで鳴らした歌トラックで、impl/codexの受入テスト生成物を依頼側がコピーしたもの（「ゆうやけ そらに とけていく」系フィクスチャ）。元の他worktree・ブランチには書き込んでいない。音声モデルは個人・非商用・再配布禁止、原音も処理音もcommitしていない。

## commits

| commit | 内容 | push |
|---|---|---|
| `a3cd77c` | GOAL / ACCEPTANCE TESTS / 使用量ログ初期化 | origin/feat/vocaloid-filter 済 |
| `325278d` | 共通DSP・CLI・Web Audioデモ・出典文書・テスト | 済 |
| `02999c5` | WAV数値統一・F0測定の音色依存対処・失敗を含む数値保存 | 済 |
| 最終docs commit | 本報告と手書き使用量ログの確定。hashは `git log -1 --format=%h` で確認 | このcommitも `git push origin HEAD` で保存 |

操作は担当ブランチ `feat/vocaloid-filter` のみ。force-push / PR / 公開 / 他ブランチの変更 / 外部メッセージ / 有料API / GPU / 音声やモデルのcommitは行っていない。依存インストールはnpmのみ、プロバイダ切替0。自分のサーバーは試験のfinallyで停止、5447番にlistenerがないことを確認。

## NEXT STEPS

- **本セッションの追加修復は行わない。** 次の作業を依頼する場合、650Hz付近のYIN補間精度を調べ、2cent陽性対照を満たす推定器に改善する（音声にピッチ補正を加えない）。
- 依頼者が6本を聴き比べ、音色が狙いに合うか判断する。数値試験は主観的な「ボカロらしさ」の証明にはならない。
- 別途依頼があれば任意の既存実装へadapterを接続する。今回は独立モジュールとして終了。
- 共有KB更新とトークン集計スクリプトは依頼側が実施。こちらは実行せず、トークン数も推測しない。

## BLOCKED APPROVALS

なし。PR・公開・外部送信・購入・認証情報・データ削除・有料APIに関する承認依頼は発生していない。数値試験1件の未達は承認待ちではなく、修復回数上限による停止。

## 作業時間

- 開始: 2026-11-13 21:58:22 JST
- 終了記録: 2026-11-13 22:14:13 JST（最終commit/push直前）
- 所要: 15分51秒（記録時点）。23:20 JSTの締切・90分以内。
- 修復2回 / CLI・プロバイダ切替0回。
