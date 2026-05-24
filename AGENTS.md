# AGENTS.md

日本語で簡潔かつ丁寧に回答してください。

## このrepoの責務

- SplendorのWeb UI、局面表示、操作UI、解析UIを管理する。
- ルール判定やAI思考は内包せず、APIまたはUSI経由で接続する。
- `csplendor` や `dlsplendor` のソースをこのrepoに直接コピーしない。

## 確認コマンド

```bash
npm install
npm run lint
npx tsc --noEmit
```

## 禁止

- `node_modules/`, `.next/`, `*.pt`, 学習ログ、大量棋譜データをコミットしない。
- エンジン内部実装に依存したUIを増やさない。
