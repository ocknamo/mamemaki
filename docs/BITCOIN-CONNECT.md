# Bitcoin Connect 導入検討

https://bitcoin-connect.com/ ([getAlby/bitcoin-connect](https://github.com/getAlby/bitcoin-connect))
を mamemaki に導入すべきかの評価。調査日: 2026-07-25。

**結論(推奨): 「接続 UI としてのみ」採用する案(案 B)を条件付きで推奨。**
支払い経路は現行の自前 `lib/nwc.ts` を維持し、Bitcoin Connect は
「NWC 接続 URI をユーザーに手入力させない」ためだけに使う。
ただしバンドルが約 5 倍になるため、**採用判断は「手入力の解消にどれだけ価値を置くか」**
に帰着する。全面採用(案 C)は DESIGN.md の安全性設計を壊すため**非推奨**。

---

## 1. ライブラリの概要(実測・一次情報)

| 項目 | 値 |
|------|-----|
| パッケージ | `@getalby/bitcoin-connect` |
| 最新版 | 3.12.3(2026-05-23 公開。3.12.0 は 2026-02) |
| ライセンス | MIT |
| 依存 | `@getalby/sdk` / `@getalby/lightning-tools` / `@lightninglabs/lnc-web` / `qrcode-generator` / `zustand`(+ Web Components 実装に Lit) |
| 実装形態 | Web Components(`<bc-button>` 等)+ 命令的 API |
| 対応コネクタ | Alby 拡張(WebLN)、Alby Hub、CoinOS、LNbits、LNC、汎用 NWC ほか |

主な命令的 API(`src/api.ts`):

```ts
init(config: BitcoinConnectConfig): void
launchModal(): void
requestProvider(): Promise<WebLNProvider>
onConnected(cb: (provider: WebLNProvider) => void): () => void
onDisconnected(cb: () => void): () => void
getConnectorConfig(): ConnectorConfig | undefined
disconnect(): void
```

`ConnectorConfig` は **`nwcUrl?: string` を持つ**(`src/types/ConnectorConfig.ts`)。
つまり接続後に `nostr+walletconnect://...` を取り出して**自前クライアントに渡せる**。
これが案 B が成立する根拠。

設定で効くもの:

- `filters: ['nwc']` — NWC 系コネクタだけを表示(`ConnectorFilter` は `'nwc'` のみ)
- `persistConnection: false` — 「接続を確立して NWC secret を得るだけのアプリ向け」と
  型定義のコメントに明記されている。mamemaki の用途そのもの
- `providerConfig.nwc.authorizationUrlOptions` — Alby Hub 等の認可フローに
  `maxAmount` / `budgetRenewal` / `expiresAt` / `requestMethods` / `isolated` を渡せる

## 2. サイズ影響(実測)

現行 `bun run build`:

| | raw | gzip |
|---|---|---|
| 現在の `dist` JS | 82.8 KB | 31.1 KB |

Bitcoin Connect 3.12.3(bundlephobia):

| チャンク | raw | gzip |
|---|---|---|
| main | 421 KB | 152 KB |
| 遅延チャンク(LNC) | 315 KB | 77 KB |

LNC は `await import('@lightninglabs/lnc-web')` で**動的読み込み**(`LNCConnector.ts:27`)
なので、`filters: ['nwc']` なら 77 KB 側は落ちてこない。それでも初期ロードは
**31 KB → 約 183 KB gzip(約 5.9 倍)**。「依存は最小限」という DESIGN.md /
ROADMAP.md の方針に対する最大のコスト。

## 3. 導入パターンの比較

### 案 A: 導入しない(現状維持)

ユーザーは NWC URI を手でコピペする。追加依存ゼロ。
欠点は明白で、**初見のユーザーが最も脱落しやすい箇所が残る**。
ウォレットアプリから URI をコピーしてブラウザに貼る操作は、モバイルでは特に重い。

### 案 B: 接続 UI としてのみ採用(推奨)

Bitcoin Connect は「NWC URI をユーザーから受け取る手段」に限定し、
取得した URI を既存の `NwcClient` に渡す。支払い経路は 1 行も変えない。

```ts
// src/lib/bitcoin-connect.ts (スケッチ)
import { init, launchModal, onConnected, getConnectorConfig, disconnect }
  from '@getalby/bitcoin-connect';

init({
  appName: 'mamemaki',
  filters: ['nwc'],            // NWC 系だけ表示 → nwcUrl が必ず取れる
  persistConnection: false,    // 保存は既存の storage.ts に一本化する
  showBalance: false,
  providerConfig: {
    nwc: {
      authorizationUrlOptions: {
        requestMethods: ['pay_invoice', 'get_info'],
        maxAmount: 10_000,       // 既定の支出上限を要求
        budgetRenewal: 'monthly',
      },
    },
  },
});

onConnected(() => {
  const cfg = getConnectorConfig();
  if (cfg?.nwcUrl) {
    // 既存フローに合流: parseNwcUri → NwcClient.connect → storage 保存
  }
});
```

UI 上は NWC カードに「ウォレットを接続」ボタンを 1 つ足し、
**URI の手入力欄は従来どおり残す**(フォールバック兼上級者向け)。

得られるもの:

- **手入力の解消**。Alby Hub / CoinOS / Alby 拡張などから 2〜3 タップで接続でき、
  モバイルでの脱落が減る
- **支出上限を「お願い」から「既定」へ**。現在 README は
  「支出上限を設定した NWC 接続の利用を推奨します」と注意書きするだけだが、
  `authorizationUrlOptions` で `maxAmount` / `budgetRenewal` / `requestMethods` を
  要求すれば、対応ウォレットでは**上限つき接続が既定の導線**になる。
  資金の安全性という最優先の評価軸に直接効く
- ROADMAP Phase 4「WalletConnect 以外の接続」への足がかり

失うもの / 気をつける点:

- gzip +152 KB(約 5.9 倍)
- 依存ツリーが一気に深くなる(Lit / zustand / Alby SDK / lightning-tools)。
  監査対象が「自分で読める 3,400 行」から外部数万行に広がる。
  NWC secret を扱う画面に外部コードを載せる以上、これは**セキュリティ上のコスト**として
  明示的に受け入れる必要がある
- Shadow DOM のため見た目の統一は CSS 変数経由でのみ可能。既存デザイントークン
  (`--accent: #f7931a` 等)とは別に Bitcoin Connect 側の変数を設定する必要がある
- `persistConnection: false` にしても、接続確立の過程で外部ドメイン
  (Alby Hub 等の認可 URL)へ遷移する導線が入る。「バックエンドなし・
  ブラウザから直接」という前提自体は崩れないが、
  **どのウォレットを使ったかが第三者に伝わる**点は現状より増える
- 命令的 API のみ使うので kanabun との JSX 統合は不要(`<bc-button>` は使わない)

### 案 C: 支払いも Bitcoin Connect 経由にする(非推奨)

`provider.sendPayment(invoice)` に置き換える案。**DESIGN.md の安全性設計を壊す**。

- **`unconfirmed` を区別できない**。WebLN の `sendPayment` はタイムアウトや
  不正応答を例外として投げるだけで、「支払いが成立している可能性がある」状態を
  呼び出し側に伝える手段がない。DESIGN.md が「failed と厳密に区別する」と明記した
  二重払い防止の中核がそのまま失われる
- **リレー応答の検証を自前で行えなくなる**(pubkey / kind / `#e` / id 再計算 /
  schnorr 署名検証)。SDK の実装を信頼することになる
- preimage 必須という成功判定も SDK の挙動依存になる
- なお invoice の金額検証(LUD-06)は送金**前**の処理なので、案 C でも維持できる

現行の `lib/nwc.ts`(313 行)+ `lib/nostr.ts`(138 行)は、
テスト(`nwc.spec.ts` 343 行)込みで既に動いており、置き換える利得がない。

## 4. WebLN について

ROADMAP Phase 4 の「WebLN 対応」は Bitcoin Connect と混同されやすいが、**別の判断**である。
結論としては **mamemaki には向かないため優先度を下げる**(実質「対応予定なし」寄り)。

### 実装コストの問題ではない

まず前提として、**ブラウザ拡張の WebLN 対応に Bitcoin Connect は不要**。
`window.webln` はブラウザが注入するグローバルで、`enable()` して `sendPayment()` を
呼ぶだけなので依存追加ゼロで書ける。構造的にも安く、`sendAll` の第 2 引数は既に
`Pick<NwcClient, "payInvoice">`(`lib/sender.ts`)という最小インターフェースなので、
`payInvoice` を持つ別実装を渡せば済む。

**問題は実装コストではなく意味論**である。逆に言えば「Bitcoin Connect を入れれば
WebLN 対応がついてくる」は BC 採用の理由にならない。

### 理由 1: `unconfirmed` を表現できない

WebLN の `sendPayment(invoice)` は成功時に `{preimage}` を返し、失敗時は
**文字列メッセージだけを持つ例外**を投げる。現行の `lib/nwc.ts` の `payInvoice` が
区別している 4 通りが潰れる:

| 事象 | NWC での判定 | WebLN |
|---|---|---|
| リレーが `OK: false` | `failed`(発射されていない) | 表現なし |
| ウォレットが `error` を返した | `failed` | 例外(文字列) |
| 応答に preimage が無い | `unconfirmed` | 表現なし |
| タイムアウト | `unconfirmed` | 例外(文字列) |

「ユーザーがポップアップで拒否した(確実に未払い)」と「タイムアウトした
(払われたかもしれない)」が同じ形の rejection で返るため、実装は二択になる —
**全部 `failed` にして二重払いのリスクを負う**か、**全部 `unconfirmed` にして
毎回ウォレット履歴の確認を促す**か。どちらも DESIGN.md の設計に対する後退。
エラーメッセージの文字列マッチによる分類はウォレット実装依存で壊れるため採らない。

### 理由 2: バッチ送金と 1 件ずつの承認が噛み合わない

WebLN の `enable()` はサイトへのアクセス許可であって支出の許可ではなく、
送金ごとに確認ポップアップが出るのが素の挙動。Alby 拡張にはサイト単位の予算設定が
あり上限内は自動承認されるが、これは**仕様ではなく実装依存**。

mamemaki は 10 件・50 件を順に送るアプリで、`sendAll` は送金中リストを編集ロックし
1 件あたり最大 30 秒待つ。ここに N 回のポップアップが挟まると、ユーザーがタブを
離れた瞬間に承認待ちが詰まって `unconfirmed` が量産される。
**「支出上限つき接続で無人でも回る」という NWC の性質がこのアプリの前提**であり、
WebLN はそこが弱い。

### 理由 3: モバイルファーストと矛盾する

DESIGN.md は明確にモバイルファースト(sticky バー、iOS のズーム防止まで見ている)だが、
WebLN 拡張は事実上デスクトップ専用。獲得できるのは想定ユースケースの少数派になる。

### 案 B との関係(重要)

案 B で `filters: ['nwc']` を指定するのはコネクタ一覧を整理するためだけではない。
**これを外すと Alby 拡張コネクタが選択肢に混ざり、その経路だけ BC の provider 経由に
なって上記の劣化がそのまま入る。** 案 B を採るなら filters は外さないことが条件。

### それでも実装する場合の最低ライン

送金経路ごとに `unconfirmed` の扱いを変える `Payer` インターフェースを切った上で、
**WebLN 経路の失敗はすべて `unconfirmed` 扱い**(安全側)にする。
あるいは「WebLN は 1 件送金のときだけ選べる」と割り切る。WebLN が本来向いているのは
ページ上の単発課金であって、バッチ送金ではない。

## 5. ROADMAP との関係

| ROADMAP 項目 | Bitcoin Connect 導入の影響 |
|---|---|
| Phase 4「WebLN 対応」 | BC とは独立の判断。優先度を下げるべき(前節参照)。案 B を採る場合はむしろ `filters: ['nwc']` を**外さない**ことが条件になる |
| Phase 4「NIP-44 暗号化」 | **案 B では解決しない**(暗号化は自前 `nostr.ts` のまま)。案 C なら `@getalby/sdk` が NIP-44 対応済みなので付いてくるが、そのために案 C を選ぶのは本末転倒 |
| Phase 4「LNC 等」 | 案 B の延長で選択肢に入る(ただし +77 KB) |
| Phase 1「複数リレー対応」 | 影響なし(自前クライアント側の課題のまま) |
| Phase 5「QR 読取の NWC URI 流用」 | **競合する**。BC 導入なら NWC URI の QR 読取は不要になる可能性が高い。逆に、既に `BarcodeDetector` で QR 読取を実装済みなので、**依存ゼロで NWC URI の QR 読取に流用する**方が安上がりな代替案になりうる |

## 6. 判断

**採用するなら案 B、ただし以下を満たすこと。**

1. `filters: ['nwc']` + `persistConnection: false` で使う(支払いは自前クライアント)。
   **後から filters を外して WebLN 拡張を混ぜない**(4 節参照)
2. URI 手入力欄を残す(BC 障害時・上級者向けのフォールバック)
3. `authorizationUrlOptions` で支出上限を要求する導線をつくる
4. バンドル増(gzip 31 KB → 約 183 KB)を README / DESIGN.md の依存方針に明記する

**先に検討すべき安上がりな代替案**: 既存の QR 読取(`lib/qr.ts` / `qr-scan-dialog.tsx`)を
NWC URI にも流用する(ROADMAP Phase 5 に記載済み)。多くの NWC ウォレットは
接続 URI を QR で表示するため、**依存追加ゼロで手入力の大半を解消できる**。
これを先に実装し、それでも接続体験が不十分なら案 B に進むのが、
「追加依存は最小限」という本プロジェクトの方針と整合する。

一方、案 B が明確に勝る点が 1 つある — **支出上限つき接続を既定の導線にできる**こと。
QR 流用では「上限を設定してください」という README の注意書きのままで、
資金の安全性は依然ユーザーの運用任せになる。ここを重視するなら案 B を先に採る。
