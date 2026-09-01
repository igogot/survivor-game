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
