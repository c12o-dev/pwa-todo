# step-2: Service Worker でオフラインでも開けるようにする

## ゴール

このステップを終えると、一度アクセスしたあとは **ネットを切ってもアプリが開く** ようになる。仕組みとして Service Worker のライフサイクル（install / fetch / activate）と cache-first 戦略を理解する。

## 前提

- `step-1-manifest` まで終えていること
- ローカルサーバーで開くこと（`file://` では Service Worker は動かない）

完成形のコードはリポジトリの `sw.js` と `app.js`。このドキュメントはそれをパーツごとに解説する。

---

## 全体像：Service Worker とは何か

Service Worker（以下 SW）は、**ページとネットワークの間に挟まる常駐のプロキシ（仲介役）**。`app.js` のような普通のスクリプトとは別世界で動く。

| 観点 | `app.js`（普通の JS） | Service Worker |
| --- | --- | --- |
| 動く場所 | ページのメインスレッド | 別スレッド（ページと独立） |
| DOM | 触れる | 触れない（`document`/`window` なし、自分は `self`） |
| 生存 | ページを閉じると死ぬ | ページを閉じても生きられる |
| 起動 | ページと一緒 | イベント駆動。用がなければブラウザに止められ、必要時に再起動 |
| 保存 | `localStorage` 可 | `localStorage` 不可（代わりに Cache Storage / IndexedDB） |
| 動作条件 | どこでも | HTTPS か localhost のみ |

一番大事な勘所は **「いつ止められてもいい前提で書く」**。SW は用がなければ勝手に止められるので、グローバル変数に状態を溜めても当てにならない。状態は Cache Storage / IndexedDB に置く。

SW は3つのライフサイクルイベントで動く。基本構造は **「install で入れて、activate で掃除して、fetch で出す」**。

| イベント | いつ走る | やること |
| --- | --- | --- |
| `install` | 初回登録時・SW 更新時に1回 | アプリのファイルをキャッシュに入れる |
| `activate` | install 済み SW が制御を握る直前 | 古いキャッシュを掃除する |
| `fetch` | activate 後ずっと | ページの全リクエストを横取りして返す（オフラインの肝） |

`sw.js` は **「設定（キャッシュ名・対象ファイル）＋3つの処理関数＋3つのイベント登録」** でできている。以下パーツごとに見ていく。

---

## ① キャッシュ名とアプリシェル

```js
const cacheName = "pwa-todo-v1";
const contentToCache = ["/", "/index.html", "/style.css", "/app.js", "/manifest.json", "/icon/icon-192x192.png", "/icon/icon-512x512.png"];
```

- `contentToCache` は **アプリシェル**＝UI を表示するのに必要な最小のファイル群（HTML / CSS / JS / manifest / アイコン）
- `cacheName` に **バージョン番号**（`v1`）を入れておく。後でファイルを更新したとき `v2` に上げると、`activate` で古い `v1` を掃除できる（④で使う）
- パスは SW の置き場所（ルート）基準の **ルート相対**で書く。`start_url` が `"."`（＝ `/`）なので `"/"` と `"/index.html"` は別物として両方入れる

---

## ② install — アプリシェルをキャッシュに入れる

```js
async function cacheAppShell() {
  const cache = await caches.open(cacheName); // この名前の箱を開ける（なければ作る）
  await cache.addAll(contentToCache); // 各 URL を取りに行って保存
}

self.addEventListener("install", (e) => e.waitUntil(cacheAppShell()));
```

- `install` は初回登録時とSW更新時に**1回**走る。ここでアプリのファイルをまとめてキャッシュに入れる
- **`e.waitUntil(promise)`** は「この Promise が終わるまで install を完了扱いにするな」とブラウザに伝える。これがないと、キャッシュが終わる前に SW が止められたり install 済みと見なされたりする
- `caches` は Cache Storage API。`caches.open(name)` で箱を開け、`cache.addAll([...])` で各 URL を取得して保存する

**つまずき：`addAll` は all-or-nothing**  
配列に1つでも 404（パス間違い）があると `addAll` 全体が失敗し、install がまるごと失敗する。しかも静かに失敗するので、`contentToCache` のパスは厳密に正しく書く。

---

## ③ fetch — cache-first でリクエストに応える

```js
async function cacheFirst(request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request); // 今のキャッシュから探す
  if (cached) return cached; // あれば返す
  return fetch(request); // 無ければネットワークへ
}

self.addEventListener("fetch", (e) => e.respondWith(cacheFirst(e.request)));
```

- `fetch` イベントは、スコープ内のページが出す**全リクエストを横取り**できる。`e.respondWith(...)` を呼ぶと、それがページへの返事になる（呼ばなければ普通にネットへ行く）
- 戦略は **cache-first**（まずキャッシュ、無ければネット）。アプリシェルのような滅多に変わらないファイルに向く。一度キャッシュすればオフラインでも返せる
- `caches.match`（全キャッシュ横断）ではなく **`caches.open(cacheName).match`（今のキャッシュ限定）** にしている。こうすると古いバージョンのキャッシュが残っていても新しい版しか返さない（stale 回避）

**つまずき：`respondWith` は同期で呼ぶ**  
`respondWith()` はハンドラの中で同期的に呼ぶ必要がある。`await` してから呼ぶと手遅れ（ブラウザがデフォルト動作に行く）。だから「`respondWith(Promiseを返す関数())`」の形にして、中で `await` する。

cache-first には弱点もある。キャッシュに無いものをオフラインで要求すると `fetch` が失敗する（例：`favicon.ico`）。アプリシェルは全部キャッシュ済みなので動作に支障はないが、性質として知っておく。

---

## ④ activate — 古いキャッシュを掃除する

```js
async function deleteOldCaches() {
  const keys = await caches.keys(); // 全キャッシュの名前
  await Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)));
}

self.addEventListener("activate", (e) => e.waitUntil(deleteOldCaches()));
```

- ファイルを更新して `cacheName` を `v2` に上げると、install は `v2` を作るが **古い `v1` の箱は残る**。これを消さないとストレージが無駄に増えていく
- 掃除は **`install` ではなく `activate`** でやる。install の時点ではまだ古い SW がページを支配している可能性があり、使っている最中のキャッシュを消すと危ない。`activate` は新しい SW が制御を握る瞬間なので、ここで消すのが安全
- `caches.keys()` で全キャッシュ名を取り、今の `cacheName` 以外を `caches.delete()` する

**つまずき：activate は「一度きり」＋「待機」**  
`activate` はそのSWバージョンが有効化される瞬間に1回だけ走る。`sw.js` を書き換えても、古い SW が生きている間は新しい SW が **待機（waiting）** のままで activate が走らない。開発中は DevTools の **「Update on reload」** にチェックを入れると回避できる。

---

## ⑤ ページ側で SW を登録する（app.js）

```js
window.addEventListener("load", () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js");
  }
});
```

- SW の仕事は `sw.js` 側だが、**登録はページ側（`app.js`）から**行う。これがないと SW は動き出さない
- `load` 後に登録するのは、SW の登録/install がキャッシュ取得でネットを使うため。初回表示のリソース読み込みと帯域を奪い合わないよう、表示が一通り済んだ後に回す
- `"serviceWorker" in navigator` のガードで、対応ブラウザだけで実行する
- 置き場所（スコープ）の都合で `sw.js` は **ルート直下**に置く。ルートに置けばサイト全体のリクエストを横取りできる

---

## 確認

ローカルサーバーで開き直して、DevTools → Application を見る：

- Service Workers に `sw.js` が **activated and is running** と表示される
- Cache Storage → `pwa-todo-v1` に、`contentToCache` のファイルが並ぶ
- Service Workers パネルの **「Offline」にチェック** を入れてリロードしても、アプリが表示される

最後のオフライン表示ができれば成功。

## つまずき（まとめ）

- **SW のコードは `sw.js` に書く**。`app.js` に `self.addEventListener("install", ...)` を書いても、`app.js` の `self` は `window` で install イベントが来ないため何も起きない
- **更新が反映されない** → 「Update on reload」にチェック、または Unregister してリロード（待機状態の解消）
- **オフラインで開けない** → Cache Storage が空なら install 失敗。`contentToCache` のパスを見直す

## 演習（任意）

- `style.css` を少し変えて `cacheName` を `pwa-todo-v2` に上げ、リロード後 Cache Storage から `v1` が消えて `v2` だけになるのを確認する（`activate` の掃除）
- 「Offline」チェック中に Network タブを開き、各ファイルが Service Worker から返っているのを確認する

次の `step-3-indexeddb` で、タスクのデータ保存を localStorage から IndexedDB に置き換える。
