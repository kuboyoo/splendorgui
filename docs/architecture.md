# splendorgui Architecture

`splendorgui` はSplendorのWebインターフェースです。

## 境界

- 入力: API/USIから得た局面、候補手、評価値。
- 出力: ユーザー操作、表示、解析ビュー。
- 非責務: ルールエンジン、学習、モデル管理。

## 接続方針

- ローカル開発では `csplendor` APIまたはUSI adapterに接続する。
- AI対局では `dlsplendor` のUSIエンジンを子プロセスまたはサーバー経由で使う。

## ローカルAI対局

`/play` のAPI Routeは、`scripts/dlsplendor_gui_engine.py` をJSON Lines形式の子プロセスとして起動する。

```text
Browser (/play)
  -> Next.js API Route
    -> local JSON-lines adapter
      -> csplendor (rules and game state)
      -> dlsplendor (network and MCTS)
      -> models/selfplay{5,7}/weights/*.pt
      -> models/selfplay{8,9,10,12}/best.pt
      -> configs/selfplay{7,8,9,10,12}.yaml (model and input features)
```

- ブラウザへモデルパスを公開せず、サーバー側の固定カタログから選択する。
- モデルごとの設定も固定カタログで解決し、`selfplay7`〜`selfplay9` のmulti-head構成と`selfplay10`以降の313次元公開確率特徴を正しく復元する。
- 山札から予約したカードは、本人以外への対局APIではカードIDを返さず、プレイヤー番号・予約スロットごとのレベルだけを返す。AI同士の観戦では両者とも伏せる。
- `.pt` は `dlsplendor` 側の配置を直接参照し、GUIリポジトリへコピーしない。
- 対局セッション、MCTS tree、ロード済みnetworkはPythonワーカー内だけに保持する。
- Arenaと同じ150ターンを上限とし、モデルの反復手順で観戦が無期限に続くことを防ぐ。
- UIは合法手の選択と表示に限定し、合法手生成や局面更新を再実装しない。
- ローカル学習との同時利用を考慮し、CPUスレッド数は既定で2に抑える。
