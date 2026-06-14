# lisplendor

Splendor の局面エディタだけを切り出した単独アプリです。現在はクライアントサイド完結の静的な編集サイトとして動作し、局面は `?s=` クエリに埋め込まれるため、そのまま URL 共有できます。

## 方針

- フロントは単独 Next.js アプリです。
- 現時点では API や認証を持たず、局面保存は `localStorage`、共有は URL で完結します。
- ただし実装形は Cloud Run 前提の `standalone` 出力にしてあり、将来ログインや API Route を足しても載せ替え不要です。

## 開発

```bash
cd lisplendor
npm install
npm run dev
```

`http://localhost:3000/` がそのまま局面エディタ画面です。

## ビルド

```bash
cd lisplendor
npm run build
npm run start
```

## GCP 公開

将来の認証追加を考えると、初期公開から Cloud Run を使うのが最も素直です。

```bash
cd lisplendor
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
