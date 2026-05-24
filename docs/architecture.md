# splendorgui Architecture

`splendorgui` はSplendorのWebインターフェースです。

## 境界

- 入力: API/USIから得た局面、候補手、評価値。
- 出力: ユーザー操作、表示、解析ビュー。
- 非責務: ルールエンジン、学習、モデル管理。

## 接続方針

- ローカル開発では `csplendor` APIまたはUSI adapterに接続する。
- AI対局では `dlsplendor` のUSIエンジンを子プロセスまたはサーバー経由で使う。
