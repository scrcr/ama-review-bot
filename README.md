# Amazon ロングテール「埋もれレビュー宝石」Bot (Node.js)

このリポジトリは、Amazon のロングテール商品から“埋もれた宝石レビュー”を発掘し、地域別 (US / JP / EU / IN / CA / UK / AU) に Twitter へ投稿する Node.js 製の Bot です。以前の Python 実装から全面的に再設計し、モジュール構成と設定駆動で複数地域を並列運用できるようになっています。

## アーキテクチャ概要

```
[ASIN 収集] → [レビュー取得] → [GPT 整形] → [Postgres 永続化] → [投稿キュー生成] → [Twitter 投稿]
```

- **設定ドリブン**: `config/regions.json` と `.env` を組み合わせて地域ごとのドメイン・言語・アフィリエイト ID・SNS 資格情報を切り替えます。環境変数 `ACTIVE_REGIONS` にカンマ区切りで地域キーを指定すれば、運用対象の国をいつでも増減できます。
- **モジュール分割**: `src/services/` 配下に各工程を 1 モジュールとして整理しています。
- **キュー + 投稿履歴**: 高スコアレビューを `post_queue` テーブルへ投入し、実際に投稿した内容は `posted_tweets` テーブルに日次で蓄積します。JST ベースの日付で同一 ASIN を 1 日 1 回までに制限する一意制約を付与し、重複投稿を防ぎます。

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

4. Postgres にスキーマを適用します (Neon などのフルマネージドサービスも利用可能です)。

   ```bash
   psql "$DATABASE_URL" -f db/schema.sql
   # もしくはローカル環境:
   psql -h <host> -U <user> -d <database> -f db/schema.sql
   ```

5. 必要に応じて Cron か `node-cron` を使ってスケジュール実行します (後述)。GitHub Actions などから全地域を一括で回す場合は `node src/cli.js pipeline` を利用してください。`ACTIVE_REGIONS` を調整すると、GitHub Actions・スケジューラともに対象地域が自動で絞り込まれます。

## ディレクトリ構成

```
├── config/regions.json        # 地域別定義 (ドメイン・言語・カテゴリ重み)
├── db/schema.sql              # Postgres 初期スキーマ
├── src/
│   ├── cli.js                 # CLI エントリーポイント
│   ├── pipeline.js            # シーケンシャル実行
│   ├── scheduler.js           # node-cron ベースのスケジューラ
│   ├── config/
│   │   └── index.js           # 設定/環境変数ローダー
│   ├── db/
│   │   └── pool.js            # Postgres 接続ユーティリティ
│   ├── models/                # DB アクセスラッパー
│   ├── services/              # ASIN 収集〜投稿までのサービス
│   └── utils/                 # ロガーや共通ヘルパー
├── scripts/
│   └── smoke-test.js          # 依存なしの簡易動作検証
└── package.json
```

## Postgres スキーマ

`db/schema.sql` に初期テーブルを定義しています。既存テーブルへカラム追加する場合は `region` カラムが `NOT NULL` で含まれていることを確認してください。また、`products` テーブルは `region × ASIN` で一意制約を張っており、同じ ASIN が複数地域で同時にトラッキングできるようになっています。Twitter 投稿履歴は `posted_tweets` テーブルに保存し、`(region, posted_on_jst, asin)` 一意制約で「同一地域の ASIN は 1 日 1 回まで」ルールをデータベースレベルで保証しています。Neon など TLS 必須な環境では `.env` の `DATABASE_SSL=true` を設定してください。

## カテゴリと重み付け

Bot が扱うカテゴリは生活改善に寄せたベースカテゴリ群に加え、`config/regions.json` の `category_weights` で参照されたカテゴリ (例: `home_improvement`, `kitchen_highend`, `outdoor` など) を自動的に取り込みます。ASIN 取得時は重みに基づいてカテゴリを抽選し、人気領域ほど出現確率が高くなるようにしています。検索 URL はドメインとカテゴリキーワードから自動生成されますが、必要であれば `.env` で地域×カテゴリ単位の URL を上書き可能です。

## Twitter スケジューラ

`src/scheduler.js` は JST を基準に 1 日 6 ブロック (02:00 / 06:00 / 10:00 / 14:00 / 18:00 / 22:00) を実行します。各ブロックで以下を行い、7 地域ぶんの投稿を **順番に 7 回 API コール** する設計です。

1. `regions.json` を読み込み、対象地域をシャッフル。
2. 地域ごとのカテゴリ重みに従ってカテゴリを抽選。
3. 直近に使っていない ASIN を取得し、条件を満たすレビューをスクレイピング。
4. 言語別テンプレートでツイート文を整形し、アフィリエイト URL を付与。
5. `POST /2/tweets` を 1 リクエストずつ (最大 7 回) 送信し、成功した投稿を `posted_tweets` に記録。

1 ブロックあたり 7 投稿、1 日 6 ブロックで **合計 42 投稿 (42 API コール)** を確実に実行します。GitHub Actions などからは 1 時間に 1 回 `node src/cli.js post-block` を呼び出し、現在時刻がブロックに一致したときだけ実際の投稿処理が走るようにしておくのが安全です (例: `0 * * * * node src/cli.js post-block`). 強制実行したいときは `node src/cli.js post-block --force` を利用します。

ASIN 収集やレビュー処理は従来通り `--region` オプションで個別に実行できます。

## CLI

```
node src/cli.js fetch-asins --region us --limit 20
node src/cli.js fetch-reviews --region jp
node src/cli.js process-reviews --region eu
node src/cli.js create-posts --region us --max 5
node src/cli.js post-block --force
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

