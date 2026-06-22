import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  // 無視するパス
  {
    ignores: ["node_modules/**"],
  },

  // ESLint 推奨ルール
  js.configs.recommended,

  // ブラウザで動く JS（app.js など）
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
      },
    },
  },

  // Service Worker（PWA 用。後で sw.js / service-worker.js を作ったとき向け）
  {
    files: ["**/sw.js", "**/service-worker.js"],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },

  // Prettier と競合する整形系ルールを無効化（最後に置く）
  prettier,
];
