-- Written to work on SQLite, Postgres and MySQL.
CREATE TABLE IF NOT EXISTS reports (
  id VARCHAR(36) PRIMARY KEY,
  city VARCHAR(100) NOT NULL,
  temp_c REAL NOT NULL,
  note TEXT,
  photo VARCHAR(255),
  created_at VARCHAR(32) NOT NULL
);

CREATE INDEX idx_reports_city ON reports (city);
