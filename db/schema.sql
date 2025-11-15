CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  asin VARCHAR(16) NOT NULL,
  title TEXT NOT NULL,
  image_url TEXT DEFAULT NULL,
  region VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uniq_products_region_asin UNIQUE (region, asin)
);

CREATE TABLE IF NOT EXISTS reviews_processed (
  id BIGSERIAL PRIMARY KEY,
  asin VARCHAR(16) NOT NULL,
  region VARCHAR(10) NOT NULL,
  review_text TEXT NOT NULL,
  highlight_text TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  sentiment_score INT NOT NULL,
  helpful_votes INT DEFAULT 0,
  language VARCHAR(10) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_asin_region ON reviews_processed (asin, region);

CREATE TABLE IF NOT EXISTS post_queue (
  id BIGSERIAL PRIMARY KEY,
  asin VARCHAR(16) NOT NULL,
  region VARCHAR(10) NOT NULL,
  post_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'posted', 'failed')),
  scheduled_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_queue_region_status ON post_queue (region, status);

CREATE TABLE IF NOT EXISTS posted_tweets (
  id BIGSERIAL PRIMARY KEY,
  region VARCHAR(10) NOT NULL,
  asin VARCHAR(16) NOT NULL,
  tweet_text TEXT NOT NULL,
  affiliate_url TEXT NOT NULL,
  tweet_id TEXT DEFAULT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_on_jst DATE NOT NULL,
  CONSTRAINT uniq_posted_tweets_region_day_asin UNIQUE (region, posted_on_jst, asin)
);

CREATE INDEX IF NOT EXISTS idx_posted_tweets_region_posted_at ON posted_tweets (region, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_posted_tweets_posted_on_jst ON posted_tweets (posted_on_jst);
