# lisplendor

Splendor の局面エディタと、`dlsplendor` の学習済みモデルに挑戦できるローカル対局画面を備えた Next.js アプリです。

## 方針

- フロントは単独 Next.js アプリです。
- ルール処理は `csplendor`、AI探索は `dlsplendor` に委譲します。
- `.pt` ファイルや両パッケージの実装をこのリポジトリへコピーしません。
- 局面共有は URL、共有局面の永続化は API Route 経由で行います。
- `standalone` 出力に対応しています。ただしローカルAI対局には、サーバーと同じマシン上にPython環境・モデルが必要です。

## 開発

```bash
cd splendorgui
npm install
npm run dev
```

`http://localhost:3000/` がそのまま局面エディタ画面です。
AI対局画面は `http://localhost:3000/play` です。

## dlsplendor モデルとの対局

### 必要な配置

既定では、次のような兄弟リポジトリ構成を参照します。

```text
repos/
├── csplendor/
├── dlsplendor/
└── splendorgui/
```

Python環境に `torch` と `csplendor` が必要です。未導入の場合は、同じPythonへインストールします。

```bash
cd splendorgui
python -m pip install -e ../csplendor
python -m pip install -e ../dlsplendor
```

`npm run dev` の起動後に `/play` を開くと、Next.jsサーバーがローカルのPythonワーカーを自動起動します。別途FastAPIやUSIエンジンを起動する必要はありません。

既定の対戦相手は、現状の最終bestである次の `selfplay12` モデルです。

- `selfplay12/best.pt`（iteration 000011）

AI観戦の初期組み合わせは `selfplay10 best` 対 `selfplay12 best` です。比較用として、次のモデルも選択できます。

- `selfplay10/best.pt`（iteration 000007）
- `selfplay9/best.pt`（iteration 000012）
- `selfplay8/best.pt`（iteration 000008）
- `selfplay7/weights/iteration_000030.pt`

`selfplay5` は次のcheckpointを選択できます。

- `iteration_000139`
- `iteration_000203`
- `iteration_000380`
- `iteration_000577`
- `iteration_000824`
- `iteration_000998`

checkpoint不要の基準AIとして、`ルールAI（3手・得点効率）` も選択できます。3手以内に購入できる得点カードを得点÷支払い枚数で選び、得点カードがない場合は支払い枚数が最小のカードを狙います。

モデルは `../dlsplendor/models/` から直接読み込みます。`selfplay7`、`selfplay8`、`selfplay9`、`selfplay10`、`selfplay12` にはそれぞれ対応する `../dlsplendor/configs/selfplay*.yaml` を自動適用するため、multi-head checkpointとselfplay10以降の313次元公開確率特徴をそのまま利用できます。既定の探索回数は学習時と同じ400 simulationsです。先手・後手、探索回数、乱数seedは画面上で指定できます。探索回数は1以上の整数で、上限は設けていません。ルールAIは探索回数を使用しません。

`AI vs AI 観戦` を選ぶと、P0・P1それぞれのAIを指定して対局を自動再生できます。着手間隔は0秒以上の任意値（小数可）で、観戦中にも変更できます。一時停止・再開・1手進行に対応し、各着手と探索情報は右側の棋譜・検索欄へ記録されます。指定間隔は着手前の待機時間で、実際の表示間隔にはAIの探索時間も加わります。モデル同士が停滞した場合は、`dlsplendor` のArenaと同じく150ターンで打ち切り、引き分けとして表示します。

推論デバイスは利用可能性に応じて CUDA、MPS（Apple Silicon）、CPU の順に自動選択します。CPUで学習を並行実行しても負荷が集中しないよう、GUI用ワーカーのPyTorchスレッド数は既定で2です。必要な場合だけ起動前に変更してください。

```bash
DLSPLENDOR_GUI_TORCH_THREADS=4 npm run dev
```

利用可能な設定は次のとおりです。

- `DLSPLENDOR_ROOT`: `dlsplendor` の絶対パス。既定は `../dlsplendor`。
- `DLSPLENDOR_PYTHON`: ワーカー起動に使うPythonコマンド。既定は `python`。
- `DLSPLENDOR_GUI_TORCH_THREADS`: PyTorchのCPUスレッド数。既定は `2`。
- `DLSPLENDOR_GUI_DEVICE`: `cpu`、`cuda`、`mps`、`auto`。既定は `auto`。
  `auto` は CUDA、MPS（Apple Silicon）、CPU の順に選択します。`mps` を明示した場合、MPSを利用できない環境では起動時にエラーになります。

ローカルAI連携のテストでは、配置済みの `selfplay7`・`selfplay8`・`selfplay9`・`selfplay10`・`selfplay12` checkpointを実際に読み込み、人間対AIとAI観戦の着手を確認します。

```bash
python -m unittest scripts.test_dlsplendor_gui_engine -v
```

## ビルド

```bash
cd splendorgui
npm run build
npm run start
```

## GCP 公開

将来の認証追加を考えると、初期公開から Cloud Run を使うのが最も素直です。

```bash
cd splendorgui
gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/lisplendor
gcloud run deploy lisplendor \
  --image REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/lisplendor \
  --platform managed \
  --region REGION \
  --allow-unauthenticated
```

## 共有 URL

- 現在局面は URL に自動反映されます。
- `URL共有` ボタンで現在局面の URL をコピーできます。
- 保存済み局面一覧からも各局面の共有 URL をコピーできます。

## 詰み手順の再生

`csplendor/scripts/dfpn_mate_solver.py --kifu-output mate.kifu` で出力した代表棋譜と、
`generate_mate_puzzles.py` が保存した `strategy.json` を画面上部の `詰み手順読込` から読み込めます。
KIFU の公開カード補充は `reveal:C<id>` 注釈で再現します。`strategy.json` では
`自動再生` と `応手選択` を切り替えられ、完全応手 DAG 内の変化を盤面操作または候補一覧から確認できます。
`strategy_dag_compact_v1` では、同じ応手へ進む複数の具体めくれを reveal group として保持し、
現在ノードの候補だけを必要時に展開します。
SPN に `bought:[<id>,...]` と player section の `nobles:[<id>,...]` が含まれる場合、
初期局面および再生中の購入済みカード・取得済み貴族として表示します。
