# PWA TODO

素の HTML / CSS / JavaScript だけで作る TODO アプリを題材に、**PWA（Progressive Web App）** を段階的に学ぶ教材リポジトリです。フレームワークもビルドツールも使いません。

## 動かす

Service Worker と manifest は `file://` では動かないため、ローカルサーバー経由で開きます（インストール不要）。

```bash
pnpm dlx serve .
# または
python3 -m http.server 8000
```

表示された URL（例: http://localhost:8000）をブラウザで開く。

## 学習ステップ（タグ）

各ステップはタグで切ってあり、`git checkout <タグ>` でその時点の状態に移動できます。

| タグ | 内容 |
| --- | --- |
| `step-0-base` | TODO アプリ（追加・編集・完了・削除 ＋ localStorage 永続化）。PWA 化前の出発点 |
| `step-1-manifest` | Web App Manifest でインストール可能化 |
| `step-2-service-worker` | Service Worker でオフライン対応（cache-first） |
| `step-3-indexeddb` | IndexedDB でデータ永続化 |
