# Split LN Sender — 設計

Lightning Address を複数指定し、NWC (NIP-47) 経由で順番に送金するサーバーレス SPA。

## 全体構成

```
app.tsx (状態の所有 + 送金オーケストレーション + 画面合成)
 ├─ model.ts                     Row(行ごとの編集用 signal)
 ├─ components/
 │   ├─ styles.ts                共有スコープCSS (card / ghost button)
 │   ├─ header.tsx               AppHeader
 │   ├─ recipients-card.tsx      行編集 + CSV貼り付け(CSVのローカル状態も所有)
 │   ├─ nwc-card.tsx             NWC URI入力 + Connect/Disconnect(表示のみ)
 │   ├─ progress-card.tsx        進捗・結果表示
 │   └─ send-bar.tsx             合計 + Sendボタン(sticky バー)
 └─ lib/
     ├─ csv.ts                   CSV貼り付けのパース
     ├─ validation.ts            Lightning Address / Amount の検証
     ├─ storage.ts               LocalStorage ラッパー
     └─ sender.ts                逐次送金オーケストレーション
          ├─ lib/lnurl.ts        Lightning Address → LNURL-pay → Invoice
          └─ lib/nwc.ts          NWCクライアント (relay WebSocket + pay_invoice)
               └─ lib/nostr.ts   イベント署名 (schnorr) + NIP-04 暗号化
```

コンポーネントは props(signal / accessor / ハンドラ)を受け取る表示部品で、
アプリ状態(rows / NWC接続 / 送金フェーズ)と副作用は App が所有する。
スタイルは各コンポーネントが `css``` で自前のスコープを持ち、
デザイントークン(CSS変数)とリセットだけ index.html に置く。

- バックエンドなし。ブラウザから LNURL エンドポイントと Nostr リレーへ直接アクセスする。
- 永続化は LocalStorage のみ(キー: `split-ln-sender.nwc-uri`、NWC 接続 URI だけを保存)。

## 依存

| 依存 | 用途 |
|------|------|
| `@kanabun/core` | UI (signals / JSX) |
| `@noble/curves` | secp256k1: schnorr 署名 (イベント署名) と ECDH (NIP-04 共有鍵) |

secp256k1 は WebCrypto に無いため `@noble/curves` を使う。それ以外の暗号
(AES-256-CBC, SHA-256 は `@noble/hashes` 経由/WebCrypto) に追加依存はない。

## 送金フロー(逐次・並列なし)

```
for each recipient:
  1. resolveAddress   GET https://<domain>/.well-known/lnurlp/<name>   (10s timeout)
  2. fetchInvoice     GET <callback>?amount=<msats>                    (10s timeout)
  3. payInvoice       kind:23194 (pay_invoice) を relay へ publish、
                      kind:23195 の応答を待つ                          (30s timeout)
  失敗しても次の recipient へ継続
```

ステータス遷移: `pending → resolving → paying → success | failed`。
失敗理由はカテゴリ付きメッセージ(`Lightning Address取得失敗` / `Invoice取得失敗` /
`支払い拒否`(リレーの OK false)/ `支払い失敗`(ウォレットの error 応答)/ タイムアウト)。

## NWC (NIP-47)

- URI `nostr+walletconnect://<wallet-pubkey>?relay=<url>&secret=<hex>` をパース。
- Connect = リレーへ WebSocket 接続(能力確認は行わない。エラーは送金時に表面化)。
- `pay_invoice`: NIP-04 で暗号化したリクエストを kind:23194 で送信し、
  `#e` フィルタで kind:23195 の応答を購読して待つ。
- 暗号化は NIP-04(全 NWC ウォレットが対応するベースライン)。
  共有鍵 = ECDH の X 座標、AES-256-CBC は WebCrypto。

## UI(モバイルファースト)

単一カラム、max-width 30rem。セクションはカード。
合計(Recipients / Total)と Send ボタンは **画面下部に sticky** で常時表示。

1. Recipients カード — 行編集(address / amount / 削除)、+ Add Row、Paste CSV(details)
2. NWC カード — URI 入力(password type)、Connect / Disconnect、接続状態
3. Progress / Results カード — 送金開始後に表示。`n / total` と各行の ✓ / ✗ / … と失敗理由
4. Sticky バー — Recipients 数、Total sats、Send ボタン(未接続・入力不備時は disabled + 理由表示)

## バリデーション

- Lightning Address: `name@domain` 形式(正規表現)。空欄は送金不可。
- Amount: 1 以上の整数(sats)。LNURL の min/maxSendable 範囲チェックは invoice 取得時。
- Send 可能条件: 行が1件以上・全行有効・NWC 接続済み・送金中でない。

## セキュリティ上の注意

- NWC secret は LocalStorage に URI ごと保存される(MVP の割り切り)。
  支出上限付きの NWC 接続の利用を README で推奨する。
- リレー・LNURL 応答は信頼しない: JSON を検証し、失敗はカテゴリ付きエラーに変換する。

## テスト

`bun test` + `@kanabun/testing`(jsdom 不要)。

- 純粋ロジック: csv / validation / lnurl(fetch モック)/ nostr(署名・NIP-04 往復)
- nwc: フェイク WebSocket + フェイクウォレットで pay_invoice の往復を検証
- UI: 行追加・削除、CSV 追加、合計表示、Send disabled 条件
