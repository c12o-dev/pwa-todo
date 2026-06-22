# step-3: IndexedDB でデータを永続化する

## ゴール

タスクの保存先を **localStorage から IndexedDB に置き換える**。  
仕組みとして IndexedDB の構造（DB / オブジェクトストア / トランザクション）と、**非同期 API の扱い方**を理解する。

## 前提

- `step-2-service-worker` まで終えていること
- `step-0-base` から使ってきた localStorage 永続化を置き換える

完成形はリポジトリの `app.js`（永続化セクション）。このドキュメントはそれをパーツごとに解説する。

---

## 全体像：なぜ IndexedDB か

このアプリは `step-0` から **localStorage** でタスクを保存してきた。それで動いてはいる。ではなぜ置き換えるのか。

注意：「**localStorage だとオフラインで壊れる**」は誤り。

localStorage でもオフラインで普通に動く。正しい動機は2つ：

- **Service Worker から読み書きできる**（localStorage は SW から使えない）  
  背景同期やプッシュ受信時にデータを触る、といった PWA 機能の土台になる
- **オブジェクトのまま保存でき、構造化・大容量にスケールする**

### IndexedDB のメンタルモデル

ブラウザ内蔵の **トランザクション型・非同期のオブジェクト DB**。入れ子構造になっている。

- **Database**（名前＋バージョン）　例: `"pwa-todo-db"` v1
- └ **Object Store**（≒テーブル）　例: `"tasks"`
- 　└ **レコード**（オブジェクトそのまま）　例: `{ text, done }`。各レコードにキーが1つ要る

localStorage との違い：

|              | localStorage   | IndexedDB                |
| ------------ | -------------- | ------------------------ |
| 保存できる物 | 文字列のみ     | オブジェクトのまま       |
| 呼び出し     | 同期（即返る） | 非同期（結果は後で来る） |
| 単位         | キー1個        | ストアに多数のレコード   |
| 整合性       | なし           | トランザクション         |
| SW から      | 使えない       | 使える                   |

`step-1` で保存処理を `save()` / `load()` の2関数に閉じ込めておいた（seam）。そのおかげで、置き換えるのは **この2関数の中身だけ**で済む。

---

## ① 接続：openDB と dbPromise

```js
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("pwa-todo-db", 1);
    // ストアを作れるのは onupgradeneeded（バージョンが上がったとき）の中だけ
    req.onupgradeneeded = () => {
      req.result.createObjectStore("tasks", { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dbPromise = openDB();
```

- `indexedDB.open(名前, バージョン)` で DB を開く  
  **バージョンは整数**。`"v1"` のような文字列を渡すと開けない
- **オブジェクトストアを作れるのは `onupgradeneeded` の中だけ**  
  これはバージョンが上がったとき（初回は 0→1）に走る。「DB を開く」と「ストアを作る」は別タイミング
- キーは `autoIncrement: true`（DB が連番キーを自動で振る）  
  タスクに id を持たせない今回の作りに合う
- `dbPromise` は **起動時に一度だけ** 開いた結果  
  `save`/`load` はこれを `await` して同じ接続を使い回す

---

## ② Promise 化ヘルパー：promisifyRequest / txDone

```js
function promisifyRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const txDone = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
```

- IndexedDB は **イベントベース**（`onsuccess`/`onerror` で結果が返る）。そのままだとコールバックだらけになるので、**Promise で包んで async/await に乗せる**
- `promisifyRequest` は1つのリクエスト（`getAll` など）の完了を待つ用
- `txDone` は **トランザクション全体**の完了を待つ用。成功は `oncomplete`、失敗は `onerror`、**`onabort`（トランザクションが中断された場合）** も保険で拾う

---

## ③ 保存：save（全消し→全追加）

```js
async function save() {
  // DOM スナップショットは同期で先に取る（await をまたぐと DOM が変わりうるため）
  const tasks = [...list.children].map((item) => ({
    text: item.querySelector("span").textContent,
    done: item.querySelector('input[data-action="toggle"]').checked,
  }));

  const db = await dbPromise;
  const tx = db.transaction("tasks", "readwrite"); // 書くので readwrite
  const store = tx.objectStore("tasks");
  store.clear(); // 一旦全消し
  for (const task of tasks) store.add(task); // 全追加
  await txDone(tx); // トランザクション完了を待つ
}
```

- 読み書きは必ず **トランザクション越し**。`db.transaction(ストア名, モード)` でトランザクションを開き、`objectStore()` で操作対象を得る。書くので `"readwrite"`
- localStorage の「配列まるごと上書き」と同じ挙動にするため、**全消し（`clear`）→全追加（`add`）**にしている
- `clear` と各 `add` を個別に待つ必要はない。同じトランザクションに積んで、最後に **`txDone(tx)` で全体の完了を待つ**
- DOM スナップショットは `await` の**前**に同期で取る。`await` をまたぐ間に DOM が変わると、保存内容がずれるため

---

## ④ 読み込み：load（全件取得して描画）

```js
async function load() {
  const db = await dbPromise;
  const tx = db.transaction("tasks", "readonly"); // 読むだけなので readonly
  const tasks = await promisifyRequest(tx.objectStore("tasks").getAll());
  for (const { text, done } of tasks) {
    list.appendChild(createTaskItem(text, done));
  }
}
```

- 読むだけなので `"readonly"`
- `getAll()` は **ストアの全レコードを配列で**返す。中身は保存した `{ text, done }` そのまま。あとは `createTaskItem` で描画する（描画部分は localStorage 版と同じ）

---

## ⑤ 非同期になったことの波及

localStorage は同期だったが、IndexedDB は非同期。これで `save`/`load` が `async` になる。

- `load` は「全件取得してから描画」なので、**起動時に呼ぶ側も非同期で扱う**。`document.addEventListener("DOMContentLoaded", load)` のように渡せばよい（`load` が Promise を返しても問題ない）
- `save` はイベントハンドラから **撃ちっぱなし**（`await` しない）で呼んでいる。それでも DOM スナップショットを `await` の前に同期で取っているので、保存内容は取りこぼさない

---

## 確認

- タスクを追加・編集・完了・削除して **リロードしても残る**
- DevTools → Application → IndexedDB → `pwa-todo-db` → `tasks` に、レコード（`{ text, done }`）が入っている
- localStorage（Application → Local storage）はもう使われていない

## つまずき / よくあるミス

- **バージョンに文字列を渡す** → `indexedDB.open("pwa-todo-db", "v1")` は開けない。バージョンは整数
- **ストアをトップレベルで作ろうとする** → `createObjectStore` は `onupgradeneeded` の中でだけ呼べる
- **これは `app.js`（ページ側）の話** → Service Worker（`sw.js`）と混同しない。ただし IndexedDB は SW からも使える

## 演習（任意）

- 各タスクに `id` を持たせ、「全消し→全追加」ではなく **1件ずつ追加/更新/削除** する形にしてみる（IndexedDB 本来の使い方）
- 旧 localStorage に残ったデータを読み出して IndexedDB へ移行するコードを書いてみる

これで本編は完成。**manifest（インストール）＋ Service Worker（オフライン）＋ IndexedDB（データ永続化）** が揃い、「オフラインで開けて、データも残る」PWA TODO になった。
