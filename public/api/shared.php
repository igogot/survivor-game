<?php
/**
 * The plumbing both endpoints need: answering, the limits file, the database,
 * and who is calling.
 *
 * Extracted when the account endpoint arrived, because two copies of "how to
 * refuse a request" is how two endpoints end up refusing them differently —
 * and a client that has to know which error shape came from which URL is a
 * client with two of everything.
 */

declare(strict_types=1);

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

/*
 * Anything that gets this far still answers in JSON.
 *
 * Every query used to sit inside a try/catch that happened to cover it, which
 * held right up until there were two tables and a host that had run only the
 * first migration: the party board's SELECT threw, nothing caught it, and the
 * endpoint answered 500 with an empty body. The client is fine with that — it
 * reports the board unreachable either way — but an endpoint that answers
 * nothing tells whoever is setting it up nothing either.
 *
 * A handler rather than another try/catch, because the next query added will
 * not remember to bring one. Throwable covers Error too, so a missing class or
 * a call to something that is not there lands here as well.
 *
 * The message goes to the host's log and never into the response: a PDO error
 * names the database, the user and the table.
 */
set_exception_handler(static function (Throwable $thrown): void {
    error_log('leaderboard: ' . $thrown->getMessage());
    if (!headers_sent()) {
        fail(503, 'database-unavailable');
    }
});

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
