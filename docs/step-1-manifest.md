# step-1: Web App Manifest でインストールできるようにする

## ゴール

このステップを終えると、TODO アプリをブラウザから **インストール** でき、アドレスバーのない独立ウィンドウ（アプリ窓）で起動できるようになる。仕組みとして「ブラウザが何をもってインストール可能と判断するか」を理解する。

## 前提

- `step-0-base` まで終えていること（CRUD ＋ localStorage の TODO アプリ）
- ローカルサーバーで開くこと（`file://` では manifest もこの先の Service Worker も動かない）
  ```bash
  pnpm dlx serve .   # または python3 -m http.server 8000
  ```

完成形は リポジトリの `manifest.json` と `index.html`。このドキュメントはそれをパーツごとに解説する。

---

## 全体像：Web App Manifest とは何か

**Web App Manifest** は、アプリの自己紹介（名前・アイコン・起動 URL・表示モード）をブラウザに宣言する JSON ファイル。これがあると、ブラウザは「これはただのページではなくインストール可能なアプリだ」と認識する。

ブラウザがインストール可能と判定する主な条件（installability criteria）：

- 有効な `manifest.json` があり、最低限のフィールドが揃っている（`name`/`short_name`・`start_url`・`display`・192と512の `icons`）
- **HTTPS または localhost** で配信されている（`file://` は不可。ローカルでサーバーが要るのはこのため）

やることは2つだけ：**`manifest.json` を作る** ＋ **`index.html` から繋ぐ**。以下パーツごとに見ていく。

---

## ① manifest.json のフィールド

```json
{
  "short_name": "TODO",
  "name": "PWA TODO",
  "icons": [
    { "src": "icon/icon-192x192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icon/icon-512x512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "start_url": ".",
  "display": "standalone",
  "theme_color": "#4f46e5",
  "background_color": "#16181d"
}
```

| フィールド | 役割 |
| --- | --- |
| `name` | 正式名称。インストール画面に出る |
| `short_name` | ホーム画面アイコン下の短い名前（12文字程度が目安） |
| `start_url` | アプリ起動時に開く URL。`"."` は manifest からの相対で「サイトのトップ」 |
| `display` | 表示モード（下記） |
| `icons` | アプリのアイコン。最低 192 と 512 の PNG |
| `theme_color` | アドレスバーやタイトルバーの色。`index.html` の `<meta name="theme-color">` と揃える |
| `background_color` | 起動時スプラッシュ画面の背景色 |

### display の表示モード

`display` が「インストール後どう見えるか」を決める。今回は `standalone`。

- `browser` — ふつうのタブ（PWA らしさは出ない）
- `minimal-ui` — 最小限のナビ付きウィンドウ
- `standalone` — アドレスバーのないアプリ窓（多くの PWA がこれ）
- `fullscreen` — 全画面（ゲームなど）

---

## ② アイコン

- `icons` には最低 **192×192** と **512×512** の PNG を指定する。両方ないとインストール条件を満たさないことがある
- 192 はホーム画面用、512 はスプラッシュなど大きく表示する用途に使われる
- 余裕があれば各アイコンに `"purpose": "maskable"` を付けると、Android がホーム画面の形（丸・角丸など）に切り抜いても崩れない。ただし切り抜き前提で**余白込みのデザイン**が必要

---

## ③ index.html への接続

```html
<meta name="theme-color" content="#4f46e5" />
<link rel="manifest" href="manifest.json" />
```

- `<link rel="manifest">` が、HTML と manifest を繋ぐ1行。**これがないと `manifest.json` を作っても読まれない**（「作ったのに反映されない」の典型原因）
- `<meta name="theme-color">` はアドレスバー等の色。manifest の `theme_color` と同じ値に揃えておく

---

## 確認

ローカルサーバーで開き直して、次を確かめる：

- DevTools → Application → Manifest に、アプリ名とアイコンがエラーなく表示される（ここが一番のデバッグ場所）
- アドレスバーに **インストールアイコン** が出る（メニューにも「アプリをインストール」が出る）
- インストールして起動すると、**アドレスバーのないウィンドウ** で開く

## つまずき / よくあるミス

- **`<link rel="manifest">` の付け忘れ** → manifest ファイルを作っただけでは読まれない。HTML に繋いで初めて有効になる
- **サンプルのコピーをそのまま使う** → `name` やアイコンのパスを自分のアプリのものに差し替える
- **アイコンが 192 か 512 の片方しかない** → 両方そろえる
- **`file://` で開いている** → インストールアイコンが出ないときはまずこれを疑う（localhost が必要）

## 演習（任意）

- `manifest.json` に `description` と `"lang": "ja"` を足してみる
- アイコンに `"purpose": "maskable"` を指定し、Android で切り抜かれても崩れないか試す

次の `step-2-service-worker` でオフライン対応を入れる。この段階では **インストールできても、まだオフラインでは開けない**（manifest と Service Worker は別の役割）。
