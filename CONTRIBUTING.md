# Contributing

このrepoはWeb UI専用です。Splendorの局面表示、操作、解析UIを扱います。

## 基本方針

- ルール判定は `csplendor` 側に寄せる。
- AI接続はUSIまたは明示的なAPI境界を通す。
- UI変更では `npm run lint` と `npx tsc --noEmit` を確認する。
