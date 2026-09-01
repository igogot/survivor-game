-- The leaderboard's two tables. Run once, by hand, in phpMyAdmin or the
-- hosting panel's SQL console — nothing in the deploy touches the schema,
-- because an FTP upload has no way to run a migration and a half-applied one
-- would take the board down with no way back.

-- One row per name, not per run.
--
-- The unique key on the name is what enforces that, and it is the reason the
-- API can use ON DUPLICATE KEY UPDATE instead of reading a row, comparing it
-- in PHP and writing it back — two submissions under the same name arriving
-- together would race that read.
--
-- utf8mb4 throughout, and utf8mb4_unicode_ci so "Ann" and "ANN" are the same
-- name to the unique key as well as to the ranking. A board where the same
-- person holds two rows because they capitalised differently is a board that
-- looks broken.
CREATE TABLE IF NOT EXISTS scores (
  id          INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  name        VARCHAR(18)      NOT NULL,
  -- Milliseconds as an integer. The game keeps run time as a float and the
  -- board must not inherit that: two clients rounding differently would
  -- disagree about a tie.
  time_ms     INT UNSIGNED     NOT NULL,
  kills       INT UNSIGNED     NOT NULL,
  level       SMALLINT UNSIGNED NOT NULL,
  bosses      SMALLINT UNSIGNED NOT NULL,
  weapon      VARCHAR(16)      NOT NULL DEFAULT '',
  -- Kept so any row on the board can be replayed with ?seed=. The whole
  -- simulation is deterministic, so this makes every entry a thing you can go
  -- and look at rather than a number to take on faith.
  seed        INT UNSIGNED     NOT NULL,
  created_at  DATETIME         NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_name (name),
  -- Exactly the ranking the API sorts by, so the top hundred is an index read
  -- rather than a sort of the whole table.
  KEY rank_order (time_ms DESC, bosses DESC, kills DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rate limiting, and nothing else.
--
-- Rows here are deleted as soon as their window passes, so this stays small.
-- The fingerprint is a salted hash of the address: a shared host sits behind
-- proxies that rewrite it freely, so it is not identity and is never stored
-- in a form that could be read back as one.
CREATE TABLE IF NOT EXISTS submissions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  fingerprint CHAR(64)     NOT NULL,
  created_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY window_lookup (fingerprint, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;
