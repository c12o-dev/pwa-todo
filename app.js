// ===== DOM 参照・定数 =====
const input = document.getElementById("task");
const taskForm = document.getElementById("taskForm");
const list = document.getElementById("tasks");

// ===== 描画 =====

// 1タスク分の li を組み立てて返す（生成の責務をここに集約）
function createTaskItem(text, done = false) {
  const item = document.createElement("li");
  item.classList.toggle("done", done);

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.dataset.action = "toggle";
  toggle.setAttribute("aria-label", "完了");
  toggle.checked = done;

  const label = document.createElement("span");
  label.textContent = text;

  const editBtn = document.createElement("input");
  editBtn.type = "button";
  editBtn.value = "Edit";
  editBtn.dataset.action = "edit";

  const deleteBtn = document.createElement("input");
  deleteBtn.type = "button";
  deleteBtn.value = "Delete";
  deleteBtn.dataset.action = "delete";

  // 操作しやすい並び: チェックボックス → テキスト → 編集 → 削除
  item.append(toggle, label, editBtn, deleteBtn);
  return item;
}

// ===== 編集（インライン）=====

function startEditing(item) {
  // すでに編集中（テキスト入力に差し替わっている）なら何もしない
  if (item.querySelector("input[type=text]")) return;

  const label = item.querySelector("span");
  const editor = document.createElement("input");
  editor.type = "text";
  editor.value = label.textContent;

  // editor を外すと blur が同期発火し、ここへ再入する。DOM をいじる前に
  // 旗を立て、再入した側は即撤退させる（parentNode は再入時に「まだ子」に見えて素通りする）
  let closed = false;

  // editor を span に戻す。Enter/Escape/blur から呼ばれる
  const closeEditor = () => {
    if (closed) return;
    closed = true; // ← replaceChild より前に立てるのが肝
    item.replaceChild(label, editor);
  };

  // 入力を確定して戻す（Enter / blur から呼ばれる）
  const commit = () => {
    if (closed) return;
    const text = editor.value.trim();
    if (text) label.textContent = text; // 空なら据え置き = 元のまま
    closeEditor();
    save();
  };

  editor.addEventListener("keydown", (evt) => {
    if (evt.key === "Enter") commit();
    else if (evt.key === "Escape") closeEditor(); // 変更を捨てて元に戻す
  });

  // フォーカスが外れたら確定（取り消したいときは Escape）
  editor.addEventListener("blur", commit);

  item.replaceChild(editor, label); // span → input
  editor.focus();
}

// ===== 永続化（IndexedDB）=====
// 保存の出入り口はこの2関数だけ。localStorage → IndexedDB はここだけの差し替えで済んだ。

// --- ヘルパー：イベントベースの IndexedDB を Promise 化する ---
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

// --- 接続：起動時に一度だけ開き、Promise を使い回す ---
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

// --- 保存：DOM を {text, done} の配列にして「全消し→全追加」 ---
async function save() {
  // DOM スナップショットは同期で先に取る（await をまたぐと DOM が変わりうるため）
  const tasks = [...list.children].map((item) => ({
    text: item.querySelector("span").textContent,
    done: item.querySelector('input[data-action="toggle"]').checked,
  }));

  const db = await dbPromise;
  const tx = db.transaction("tasks", "readwrite");
  const store = tx.objectStore("tasks");
  store.clear(); // 一旦全消し
  for (const task of tasks) store.add(task); // id は autoIncrement に任せる
  await txDone(tx); // トランザクション完了を待つ
}

// --- 読み込み：全件取得して描画 ---
async function load() {
  const db = await dbPromise;
  const tx = db.transaction("tasks", "readonly");
  const tasks = await promisifyRequest(tx.objectStore("tasks").getAll());
  for (const { text, done } of tasks) {
    list.appendChild(createTaskItem(text, done));
  }
}

// ===== イベント =====

// 追加
taskForm.addEventListener("submit", (evt) => {
  evt.preventDefault();
  const task = input.value.trim();
  if (!task) return;

  list.appendChild(createTaskItem(task));
  save();
  input.value = "";
  input.focus();
});

// 編集・削除（ボタンの click を委譲で拾う）
list.addEventListener("click", (evt) => {
  const action = evt.target.dataset.action;
  if (action !== "delete" && action !== "edit") return;

  const item = evt.target.closest("li");
  if (action === "edit") startEditing(item);
  if (action === "delete") {
    item.remove();
    save();
  }
});

// 完了トグル（「値が変わった」を表す change で拾う）
list.addEventListener("change", (evt) => {
  if (evt.target.dataset.action !== "toggle") return;

  const item = evt.target.closest("li");
  item.classList.toggle("done", evt.target.checked);
  save();
});

// ===== 初期化 =====

// 保存済みタスクの復元。DOM さえ使えればよいので DOMContentLoaded で早めに描画
document.addEventListener("DOMContentLoaded", load);

// Service Worker 登録。初回表示のリソースと帯域を奪い合わないよう load(全部読み込み後)に遅らせる
window.addEventListener("load", () => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js");
  }
});
