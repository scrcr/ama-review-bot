CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  asin VARCHAR(16) NOT NULL,
  title VARCHAR(512) NOT NULL,
  image_url VARCHAR(1024) DEFAULT NULL,
  region VARCHAR(10) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_products_region_asin (region, asin)
);

CREATE TABLE IF NOT EXISTS reviews_processed (
  id INT AUTO_INCREMENT PRIMARY KEY,
  asin VARCHAR(16) NOT NULL,
  region VARCHAR(10) NOT NULL,
  review_text MEDIUMTEXT NOT NULL,
  highlight_text TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  sentiment_score INT NOT NULL,
  helpful_votes INT DEFAULT 0,
  language VARCHAR(10) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reviews_asin_region (asin, region)
);

CREATE TABLE IF NOT EXISTS post_queue (
  id INT AUTO_INCREMENT PRIMARY KEY,
  asin VARCHAR(16) NOT NULL,
  region VARCHAR(10) NOT NULL,
  post_text TEXT NOT NULL,
  status ENUM('pending','posted','failed') DEFAULT 'pending',
  scheduled_at DATETIME DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_post_queue_region_status (region, status)
);
