<?php
/**
 * The leaderboard, in the only language reg.ru shared hosting speaks.
 *
 * Two verbs and nothing else:
 *
 *   GET   returns the top hundred, best first.
 *   POST  takes one run, checks it could have happened, and keeps it if it is
 *         better than what that name already has.
 *
 * What this can and cannot promise is worth being plain about. The game runs
 * in the player's browser, so every number here arrives from a machine its
 * owner controls, and nothing short of replaying the whole simulation server
 * side would make a submission trustworthy. What the checks below buy is that
 * a forged score has to describe a run the game could actually have produced —
 * which turns a number typed into a console into a piece of work. That is the
 * honest ceiling for a client-side game, and pretending otherwise would be
 * worse than not having a board.
 *
 * The bounds are not written here. They are read from limits.json, which the
 * build generates from the game's own constants — see scripts/emit-limits.ts.
 * A copy of those numbers in this file would be wrong the first time anybody
 * retuned the spawn curve, and the failure would look like the board refusing
 * an honest player.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
// The board is public and carries no cookies or credentials, so any origin may
// read it. The game is served from GitHub Pages and from this host, and both
// have to reach the same table or the board is two boards.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
// Never let a proxy hold a copy: a board that is thirty seconds stale is a
// board where somebody's new record has silently not appeared.
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require __DIR__ . '/config.php';
// The checks that need neither the database nor the request.
require __DIR__ . '/validate.php';

/** Sends a JSON body and stops. */
function respond(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $status, string $reason): void
{
    respond($status, ['error' => $reason]);
}

/**
 * The bounds the build wrote out of the game's constants.
 *
 * A missing or unreadable file is a deploy that went wrong, and the right
 * answer is to refuse writes rather than to accept everything: an unchecked
 * board fills with nonsense in an afternoon and cannot be cleaned up by hand.
 */
function limits(): array
{
    static $cached = null;
    if ($cached !== null) {
        return $cached;
    }

    $raw = @file_get_contents(__DIR__ . '/limits.json');
    if ($raw === false) {
        fail(503, 'limits-missing');
    }

    $parsed = json_decode($raw, true);
    if (!is_array($parsed)) {
        fail(503, 'limits-unreadable');
    }

    $cached = $parsed;
    return $cached;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }

    try {
        $pdo = new PDO(
            sprintf('mysql:host=%s;dbname=%s;charset=utf8mb4', DB_HOST, DB_NAME),
            DB_USER,
            DB_PASSWORD,
            [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
            ]
        );
    } catch (PDOException $e) {
        // The message can name the database, the user and the host. None of
        // that belongs in a response to the internet.
        error_log('leaderboard: ' . $e->getMessage());
        fail(503, 'database-unavailable');
    }

    return $pdo;
}

/** The client's address, as far as a shared host can tell. */
function clientFingerprint(): string
{
    // Not identity and not trusted — a shared host sits behind proxies that
    // rewrite these freely. It only has to be stable enough to slow one
    // machine down, so it is hashed and never stored raw.
    $address = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    return hash('sha256', $address . '|' . SUBMIT_SALT);
}

function readBoard(PDO $pdo, int $limit): array
{
    $statement = $pdo->prepare(
        'SELECT name, time_ms, kills, level, bosses, weapon, seed, UNIX_TIMESTAMP(created_at) AS at
           FROM scores
          ORDER BY time_ms DESC, bosses DESC, kills DESC
          LIMIT :limit'
    );
    $statement->bindValue(':limit', $limit, PDO::PARAM_INT);
    $statement->execute();

    $board = [];
    foreach ($statement->fetchAll() as $row) {
        $board[] = [
            'name' => (string) $row['name'],
            'timeMs' => (int) $row['time_ms'],
            'kills' => (int) $row['kills'],
            'level' => (int) $row['level'],
            'bosses' => (int) $row['bosses'],
            'weapon' => (string) $row['weapon'],
            'seed' => (int) $row['seed'],
            'at' => (int) $row['at'],
        ];
    }

    return $board;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $limits = limits();
    respond(200, ['board' => readBoard(db(), (int) $limits['boardSize'])]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail(405, 'method-not-allowed');
}

$body = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($body)) {
    fail(400, 'malformed');
}

$limits = limits();

/*
 * Checked before the database is opened at all.
 *
 * These cost nothing — no I/O, no connection — so a payload that could not
 * describe a run is refused without MySQL ever hearing about it. It also means
 * every 422 path here can be exercised on a machine with no database, which is
 * how tests/api.php gets to run at all.
 */
$fault = faultInRun($body, $limits);
if ($fault !== null) {
    fail(422, $fault);
}

$name = (string) $body['name'];
$timeMs = (int) $body['timeMs'];
$kills = (int) $body['kills'];
$level = (int) $body['level'];
$bosses = (int) $body['bosses'];
$seed = (int) $body['seed'];
$weapon = is_string($body['weapon'] ?? null) ? substr($body['weapon'], 0, 16) : '';

$pdo = db();

// Then the rate limit, which is the first thing that needs the database. One
// machine hammering the endpoint is the failure this host actually sees, long
// before anybody bothers forging a plausible run.
$fingerprint = clientFingerprint();
// The window is interpolated rather than bound: MySQL will not accept a
// placeholder as the quantity of an INTERVAL. It is an integer constant from
// config.php and never touches anything a request sent, so the cast is the
// whole of what makes that safe.
$window = (int) SUBMIT_WINDOW_MINUTES;
$recent = $pdo->prepare(
    "SELECT COUNT(*) FROM submissions
      WHERE fingerprint = ? AND created_at > (NOW() - INTERVAL {$window} MINUTE)"
);
$recent->execute([$fingerprint]);
if ((int) $recent->fetchColumn() >= SUBMIT_LIMIT) {
    fail(429, 'too-many-submissions');
}

$pdo->prepare('INSERT INTO submissions (fingerprint, created_at) VALUES (?, NOW())')
    ->execute([$fingerprint]);

/*
 * One row per name, updated only when the run is better.
 *
 * The comparison lives in the WHERE of the update rather than in PHP because
 * two people can submit under the same name at the same moment, and a
 * read-then-write would let the worse of the two land last. Ranking order and
 * this condition have to agree exactly — time, then bosses, then kills.
 */
/*
 * One row per name, replaced whole or not at all.
 *
 * Done as a locking read and then a write rather than as one clever
 * INSERT ... ON DUPLICATE KEY UPDATE. The clever version has to decide
 * "is this better" once and apply it to seven columns, which in MySQL means
 * either repeating a four-line condition seven times or leaning on a user
 * variable and the evaluation order of the SET list. Both are the kind of
 * thing that works until it does not, on a server nobody here can test
 * against.
 *
 * The important property either way: a leaderboard row has to describe a
 * single run. Taking the best time from one run and the best kill count from
 * another would produce a record of something nobody did.
 */
$pdo->beginTransaction();

try {
    $held = $pdo->prepare(
        'SELECT time_ms, bosses, kills FROM scores WHERE name = ? FOR UPDATE'
    );
    $held->execute([$name]);
    $previous = $held->fetch();

    // FOR UPDATE holds the row until the commit, so two submissions under the
    // same name at the same moment are ordered rather than racing: the second
    // one reads what the first wrote.
    $better = $previous === false
        || $timeMs > (int) $previous['time_ms']
        || ($timeMs === (int) $previous['time_ms'] && $bosses > (int) $previous['bosses'])
        || ($timeMs === (int) $previous['time_ms'] && $bosses === (int) $previous['bosses']
            && $kills > (int) $previous['kills']);

    if ($better) {
        $pdo->prepare(
            'INSERT INTO scores (name, time_ms, kills, level, bosses, weapon, seed, created_at)
                  VALUES (:name, :time_ms, :kills, :level, :bosses, :weapon, :seed, NOW())
             ON DUPLICATE KEY UPDATE
                  time_ms = VALUES(time_ms), kills = VALUES(kills), level = VALUES(level),
                  bosses = VALUES(bosses), weapon = VALUES(weapon), seed = VALUES(seed),
                  created_at = VALUES(created_at)'
        )->execute([
            ':name' => $name,
            ':time_ms' => $timeMs,
            ':kills' => $kills,
            ':level' => $level,
            ':bosses' => $bosses,
            ':weapon' => $weapon,
            ':seed' => $seed,
        ]);
    }

    $pdo->commit();
} catch (PDOException $e) {
    $pdo->rollBack();
    error_log('leaderboard: ' . $e->getMessage());
    fail(503, 'database-unavailable');
}

/*
 * Only the top hundred are kept, so everything below it is deleted rather than
 * accumulating forever on a shared host. The subselect is wrapped because
 * MySQL will not delete from a table it is also selecting from directly.
 */
$keep = (int) $limits['boardSize'];
$pdo->exec(
    "DELETE FROM scores WHERE id NOT IN (
        SELECT id FROM (
            SELECT id FROM scores
             ORDER BY time_ms DESC, bosses DESC, kills DESC
             LIMIT {$keep}
        ) AS survivors
     )"
);

// Old rate-limit rows are of no use once their window has passed.
$pdo->exec("DELETE FROM submissions WHERE created_at < (NOW() - INTERVAL {$window} MINUTE)");

$board = readBoard($pdo, (int) $limits['boardSize']);

$rank = -1;
foreach ($board as $index => $entry) {
    if (mb_strtolower($entry['name'], 'UTF-8') === mb_strtolower($name, 'UTF-8')) {
        $rank = $index;
        break;
    }
}

respond(200, ['board' => $board, 'rank' => $rank, 'name' => $name]);
