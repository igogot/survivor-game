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
  -- 'submit' or 'auth'. Guessing a password deserves a far tighter allowance
  -- than finishing runs does, and one table with a kind is simpler than two
  -- tables that would drift apart in how they are pruned.
  kind        VARCHAR(8)   NOT NULL DEFAULT 'submit',
  created_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  KEY window_lookup (fingerprint, kind, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=ascii;

-- Who owns a name.
--
-- A name is claimed by whoever submits under it first, and from then on it
-- takes proof to use it again. Without this the board is a free-for-all: a
-- name is the only identity there is, so anybody could beat your run, submit
-- under your name and take your row.
--
-- `password_hash` is null for the ordinary case — a player who never asked for
-- an account and holds their name through a token their browser keeps. Setting
-- a password is what makes the name survive a cleared cache or another device,
-- and it is entirely optional.
--
-- Same collation as `scores`, so "Ann" and "ANN" are one name to the owner
-- table and to the board alike. Two tables disagreeing about that would let
-- somebody own `Ann` and still be refused their own row.
CREATE TABLE IF NOT EXISTS owners (
  name          VARCHAR(18)  NOT NULL,
  -- What uniqueness is actually decided on. Two names that render identically
  -- fold to the same key, so `Kira` and `Кira` with a Cyrillic К cannot both
  -- exist — see nameKey() in validate.php. The application computes it; the
  -- unique index is what makes it true even when two claims race.
  name_key      VARCHAR(18)  NOT NULL,
  -- From PHP's password_hash(). Never a plain digest: a leaked table of sha256
  -- passwords is a leaked table of passwords, and people reuse them.
  password_hash VARCHAR(255) NULL,
  created_at    DATETIME     NOT NULL,
  PRIMARY KEY (name),
  UNIQUE KEY uniq_name_key (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Proof of ownership, one row per device that holds a name.
--
-- Several per name on purpose: logging in on a phone must not sign the desktop
-- out. Stored as a hash for the same reason passwords are — the table is the
-- thing that leaks, and a stolen token is a stolen name.
CREATE TABLE IF NOT EXISTS tokens (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(18)  NOT NULL,
  token_hash CHAR(64)     NOT NULL,
  created_at DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_token (token_hash),
  KEY by_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- The waiting room's post box.
--
-- Not a lobby and not a game server: a queue of little messages keyed by a team
-- code, so that a code reaches further than one browser. Between windows of one
-- browser `BroadcastChannel` carries these and this table is never touched;
-- between two houses something has to hold a message until the other side asks,
-- and on hosting with no long-lived process the only thing that can is a table.
--
-- Everything in it is disposable. `room.php` deletes anything older than a
-- quarter of an hour on every write, because a scheduler is not something
-- shared hosting reliably has, and a queue that is only ever appended to fills
-- up quietly for a year and then loudly.
CREATE TABLE IF NOT EXISTS room_mail (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code       CHAR(6)         NOT NULL,
  -- Who sent it, so a reader can be given everything except their own: a
  -- broadcast that came back would double every roster and every line of chat.
  sender     VARCHAR(24)     NOT NULL,
  payload    VARCHAR(4096)   NOT NULL,
  created_at DATETIME        NOT NULL,
  PRIMARY KEY (id),
  -- The one query this table answers: everything in a room after a cursor.
  KEY room_since (code, id),
  -- And the one the sweep runs.
  KEY expiry (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The party board, top fifty.
--
-- A second table rather than a column on `scores`, for two reasons. The first
-- is that these are not comparable runs: a party meets the same crowd with
-- several people shooting at it, so a solo time and a party time measure
-- different things and ranking them together would make one of the boards
-- meaningless whichever way it fell.
--
-- The second is that `scores` is already live with real rows in it. Adding a
-- board this way is a migration that only creates, and one that only creates
-- cannot half-apply and take the existing board down with it.
--
-- Ownership is *not* duplicated. `owners` and `tokens` are keyed by name and
-- know nothing about boards, so somebody who holds `Kira` holds it on both —
-- which is the point, since it is one person either way.
CREATE TABLE IF NOT EXISTS party_scores (
  id          INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  name        VARCHAR(18)      NOT NULL,
  time_ms     INT UNSIGNED     NOT NULL,
  kills       INT UNSIGNED     NOT NULL,
  level       SMALLINT UNSIGNED NOT NULL,
  bosses      SMALLINT UNSIGNED NOT NULL,
  weapon      VARCHAR(16)      NOT NULL DEFAULT '',
  -- How many people played it. Always at least two, or the row belongs on the
  -- other table.
  party       TINYINT UNSIGNED NOT NULL,
  -- Kept, but it does not promise what the solo table's does.
  --
  -- There a seed is an invitation: the simulation is deterministic, so ?seed=
  -- replays the row and you can go and look at it. Here it cannot be. The same
  -- seed played by one person is a different run — a different horde, since
  -- enemy health follows the party's size — so this identifies the run rather
  -- than reproducing it. Said out loud because the column looks identical to
  -- the one next door and would otherwise be read as the same offer.
  seed        INT UNSIGNED     NOT NULL,
  created_at  DATETIME         NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_name (name),
  KEY rank_order (time_ms DESC, bosses DESC, kills DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
