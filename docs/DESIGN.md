# Split LN Sender — 設計

Lightning Address を複数指定し、NWC (NIP-47) 経由で順番に送金するサーバーレス SPA。

今後の実装候補(MVP 未対応の機能・既知の制限)は [ROADMAP.md](./ROADMAP.md) を参照。

## 全体構成

```
app.tsx (状態の所有 + 送金オーケストレーション + 画面合成)
 ├─ model.ts                     Row(行ごとの編集用 signal)
 ├─ components/
 │   ├─ styles.ts                共有スコープCSS (card / ghost button)
 │   ├─ header.tsx               AppHeader
 │   ├─ recipients-card.tsx      行編集 + CSV貼り付け(CSVのローカル状態も所有)
 │   ├─ qr-scan-dialog.tsx       カメラQR読取 (getUserMedia + BarcodeDetector)
 │   ├─ nwc-card.tsx             NWC URI入力 + Connect/Disconnect(表示のみ)
 │   ├─ progress-card.tsx        進捗・結果表示
 │   └─ send-bar.tsx             合計 + Sendボタン(sticky バー)
 └─ lib/
     ├─ csv.ts                   CSV貼り付けのパース
     ├─ qr.ts                    QRペイロード → Lightning Address 変換 (bech32)
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
  2. fetchInvoice     GET <callback>?amount=<msats>[&comment=%23<行番号>] (10s timeout)
  3. payInvoice       kind:23194 (pay_invoice) を relay へ publish、
                      kind:23195 の応答を待つ                          (30s timeout)
  失敗しても次の recipient へ継続
```

comment は LUD-12 の識別子(`#<行番号>`)で、LNURL-pay 応答の `commentAllowed` が
長さ十分な場合のみ付与する。非対応サーバーへはコメント無しで送金する(送金成功を優先)。

ステータス遷移: `pending → resolving → paying → success | failed | unconfirmed | cancelled`。
失敗理由はカテゴリ付きメッセージ(`Lightning Address取得失敗` / `Invoice取得失敗` /
`支払い拒否`(リレーの OK false)/ `支払い失敗`(ウォレットの error 応答))。

**`unconfirmed`(成否不明)は failed と厳密に区別する。** `pay_invoice` のタイムアウトや
preimage を欠く応答は「支払いが成立している可能性がある」状態であり、✗ と表示して
再送を誘発すると二重払いになる。UI は「?」+ 警告文(再送前にウォレット履歴を確認)で表示する。

送金中は送金先リストの編集・追加・削除・CSV取り込みをすべてロックし、
進捗/結果は **Send 押下時のスナップショット**(`ProgressEntry`)から描画する。
後からの編集が「実際に支払った先」の表示を書き換えることはない。
バッチは Cancel ボタンで中断できる(実行中の1件は完了を待ち、残りは `cancelled`)。

## NWC (NIP-47)

- URI `nostr+walletconnect://<wallet-pubkey>?relay=<url>&secret=<hex>` をパース。
- Connect = WebSocket 接続 + **info イベント (kind:13194) の取得・検証**。
  `pay_invoice` 対応と(encryption タグがあれば)NIP-04 対応を確認してから「接続済み」にする。
- `pay_invoice`: NIP-04 で暗号化したリクエストを kind:23194 で送信し、
  `#e` フィルタで kind:23195 の応答を購読して待つ。
- 暗号化は NIP-04(全 NWC ウォレットが対応するベースライン)。
  共有鍵 = ECDH の X 座標、AES-256-CBC は WebCrypto。

### 信頼モデル: リレーと LNURL サーバーは信頼しない

- **リレーからのイベントはすべて検証する**: pubkey がウォレットと一致・kind 一致・
  `e` タグがこのリクエスト id を指す・NIP-01 の id 再計算 + schnorr 署名検証
  (`verifyEvent`)。フィルタ(`authors` / `#e`)はリレーへの依頼にすぎず保証ではない。
  検証に通らないイベント(ゴミ・偽装・過去応答のリプレイ)は **無視して待ち続け**、
  購読の終了条件は「正当な応答」か「タイムアウト」だけにする。
- **成功の判定は preimage の存在を要求する**。`error` が無いだけの応答
  (`result` 欠落・preimage 空)は成功と断言せず `unconfirmed` にする。
- **invoice の金額を検証する**(LUD-06): bolt11 の HRP から金額をデコードし
  (`lib/bolt11.ts`)、リクエストした amount と一致しない invoice は拒否する。
  LNURL 応答は `callback` / `minSendable` / `maxSendable` を必須とし、欠落は不正応答として弾く。
- LUD-16 に従い Lightning Address は小文字化してから解決する。

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

## セキュリティ上の注意と既知の制限

- NWC secret は LocalStorage に URI ごと保存される(MVP の割り切り)。
  支出上限付きの NWC 接続の利用を README で推奨する。
- 外部由来の文字列(エラーメッセージ等)は kanabun のテキスト補間
  (`createTextNode` 経由)で描画されるため HTML としては解釈されない。
- **既知の制限(MVP で未対応)**:
  - bolt11 の `description_hash`(LUD-16 metadata の SHA-256)は検証しない。
  - `sha256(preimage) === payment_hash` の検証はしない(bolt11 を完全デコード
    していないため payment_hash を持たない)。preimage の存在確認まで。
  - NWC URI の `relay` は最初の1つのみ使用(単一リレー障害 = 全機能停止)。
  - `unconfirmed` の自動再確認(`lookup_invoice`)は行わない。ユーザーに
    ウォレット履歴の確認を促すのみ。

## テスト

`bun test` + `@kanabun/testing`(jsdom 不要)。

- 純粋ロジック: csv / validation / lnurl(fetch モック)/ nostr(署名・NIP-04 往復)
- nwc: フェイク WebSocket + フェイクウォレットで pay_invoice の往復を検証
- UI: 行追加・削除、CSV 追加、合計表示、Send disabled 条件
