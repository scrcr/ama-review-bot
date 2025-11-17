# Amazon ロングテール「埋もれレビュー宝石」Bot (Node.js)

このリポジトリは、Amazon のロングテール商品から“埋もれた宝石レビュー”を発掘し、地域別 (US / JP / EU / IN / CA / UK / AU) に Twitter へ投稿する Node.js 製の Bot です。以前の Python 実装から全面的に再設計し、モジュール構成と設定駆動で複数地域を並列運用できるようになっています。

## アーキテクチャ概要

```
[ASIN 収集] → [レビュー取得] → [GPT 整形] → [MySQL 永続化] → [投稿キュー生成] → [Twitter 投稿]
```

- **設定ドリブン**: `config/regions.json` と `.env` を組み合わせて地域ごとのドメイン・言語・アフィリエイト ID・SNS 資格情報を切り替えます。環境変数 `ACTIVE_REGIONS` にカンマ区切りで地域キーを指定すれば、運用対象の国をいつでも増減できます。
- **モジュール分割**: `src/services/` 配下に各工程を 1 モジュールとして整理しています。
- **キュー駆動投稿**: 高スコアレビューを `post_queue` テーブルへ投入し、Twitter Bot が地域ごとに投稿します。

## セットアップ

1. Node.js 18+ を用意してください。
2. 依存パッケージをインストールします。

   ```bash
   npm install
   ```

3. `.env` を作成します。

   ```bash
   cp .env.example .env
   # 値を環境に合わせて編集
   ```

4. MySQL にスキーマを適用します。

   ```bash
   mysql -u <user> -p < db/schema.sql
   ```

5. 必要に応じて Cron か `node-cron` を使ってスケジュール実行します (後述)。GitHub Actions などから全地域を一括で回す場合は `node src/cli.js pipeline` を利用してください。`ACTIVE_REGIONS` を調整すると、GitHub Actions・スケジューラともに対象地域が自動で絞り込まれます。

## ディレクトリ構成

```
├── config/regions.json        # 地域別定義 (ドメイン・言語・カテゴリ重み)
├── db/schema.sql              # MySQL 初期スキーマ
├── src/
│   ├── cli.js                 # CLI エントリーポイント
│   ├── pipeline.js            # シーケンシャル実行
│   ├── scheduler.js           # node-cron ベースのスケジューラ
│   ├── config/
│   │   └── index.js           # 設定/環境変数ローダー
│   ├── db/
│   │   └── pool.js            # MySQL 接続ユーティリティ
│   ├── models/                # DB アクセスラッパー
│   ├── services/              # ASIN 収集〜投稿までのサービス
│   └── utils/                 # ロガーや共通ヘルパー
├── scripts/
│   └── smoke-test.js          # 依存なしの簡易動作検証
└── package.json
```

## MySQL スキーマ

`db/schema.sql` に初期テーブルを定義しています。既存テーブルへカラム追加する場合は `region` カラムが `NOT NULL` で含まれていることを確認してください。また、`products` テーブルは `region × ASIN` で一意制約を張っており、同じ ASIN が複数地域で同時にトラッキングできるようになっています。

## カテゴリと重み付け

Bot が扱うカテゴリは生活改善に寄せたベースカテゴリ群に加え、`config/regions.json` の `category_weights` で参照されたカテゴリ (例: `home_improvement`, `kitchen_highend`, `outdoor` など) を自動的に取り込みます。ASIN 取得時は重みに基づいてカテゴリを抽選し、人気領域ほど出現確率が高くなるようにしています。検索 URL はドメインとカテゴリキーワードから自動生成されますが、必要であれば `.env` で地域×カテゴリ単位の URL を上書き可能です。

## 地域別スケジュール

Cron での実行は地域ごとに分けます。

| 地域 | 時刻 (ローカルタイム) | 実行内容 |
|------|-----------------------|----------|
| US   | 09:00 / 14:00 / 19:00 (PST) | `node src/cli.js post --region us` |
| JP   | 09:00 / 12:00 / 18:00 (JST) | `node src/cli.js post --region jp` |
| EU   | 08:00 / 13:00 / 20:00 (CET/CEST) | `node src/cli.js post --region eu` |
| IN   | 09:00 / 13:00 / 19:00 (IST) | `node src/cli.js post --region in` |
| CA   | 09:00 / 13:00 / 18:00 (ET) | `node src/cli.js post --region ca` |
| UK   | 09:00 / 12:00 / 18:00 (UK) | `node src/cli.js post --region uk` |
| AU   | 09:00 / 13:00 / 19:00 (AET) | `node src/cli.js post --region au` |

ASIN 収集やレビュー処理も同様に `--region` を付けて実行します。

## CLI

```
node src/cli.js fetch-asins --region us --limit 20
node src/cli.js fetch-reviews --region jp
node src/cli.js process-reviews --region eu
node src/cli.js create-posts --region us --max 5
node src/cli.js post --region jp
```

## テンプレート

`src/services/templates.js` に言語別テンプレートを定義しています。`createPostQueue` サービスから言語コードで呼び分け、英語は抽象→具体→結論のテンプレート、日本語はレビュー紹介型のテンプレートで投稿を整形します。

## テスト

依存関係をインストールできない環境でも設定読み込みなどの最低限のチェックができるよう、`npm test` で `scripts/smoke-test.js` を実行します。

```bash
npm test
```

## 免責

- Amazon の利用規約に従ってください。
- スクレイピングの際は適切なレート制限とキャッシュを実装してください。
- Twitter API の投稿制限に注意してください。

