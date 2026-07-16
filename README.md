# mamemaki — Split LN Sender

Lightning Address を複数指定し、Nostr Wallet Connect (NWC / NIP-47) で
順番に送金するサーバーレス SPA。[kanabun](https://github.com/ocknamo/kanabun) 製。

## 使い方

1. Lightning Address と金額 (sats) を入力(CSV `address,amount` の貼り付けも可)
2. NWC 接続 URI (`nostr+walletconnect://...`) を入力して Connect
3. Send を押すと1件ずつ順番に送金し、進捗と結果(失敗理由つき)を表示

> **Note:** NWC URI (secret を含む) はブラウザの LocalStorage に保存されます。
> 支出上限を設定した NWC 接続の利用を推奨します。

## 開発

```sh
bun install
bun test        # テスト
bun run dev     # dev サーバー http://localhost:3000/
bun run build   # dist/ に本番バンドル
```

設計は [docs/DESIGN.md](docs/DESIGN.md) を参照。
