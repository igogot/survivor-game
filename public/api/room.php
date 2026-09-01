<?php
/**
 * A mailbox per team, so a code reaches further than one browser.
 *
 * The waiting room talks by broadcasting little messages — somebody knocks,
 * the host answers with a roster, people chat, the host says start. Between
 * windows of one browser `BroadcastChannel` carries those and this file is not
 * needed. Between two houses something has to hold a message until the other
 * side asks for it, and on shared hosting with no long-lived process the only
 * thing that can is a table.
 *
 * So this is a queue and nothing more:
 *
 *   POST  ?code=XXXXXX   puts one message in the room.
 *   GET   ?code=XXXXXX   takes everything since a cursor, minus your own.
 *
 * It is deliberately not a lobby. It does not know what a roster is, who the
 * host is, or whether a code names a real team — all of that is decided in
 * `src/net/lobby.ts` on the clients, and a server that also had opinions about
 * it would be a second implementation to disagree with the first.
 *
 * What it will eventually carry, and the reason it is worth having at all, is
 * WebRTC signalling: two browsers cannot introduce themselves without a third
 * party to pass the first two messages, and this is small enough to be that
 * without becoming a game server. Once they are introduced the run itself goes
 * peer to peer and never touches this host again — which it must not, because
 * a snapshot is four kilobytes twenty times a second and this is a shared plan.
 *
 * The code is the only key. Anybody who knows one can read and write that
 * room, which is exactly the promise the game already makes about a code: it
 * is a shared secret, and the way in is to be told it. There is nothing in a
 * room worth stealing and no account attached to one, so the rest of the
 * defence is about volume rather than secrecy — see the limits below.
 */

declare(strict_types=1);

/*
 * Errors go to the log, never into the response. See scores.php: this host
 * prints them by default, and the first line of one names the account and the
 * layout of the disk.
 */
ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');
// No cookies, no credentials, and the game is served from two origins that
// have to reach the same rooms or a team cannot form across them.
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require __DIR__ . '/shared.php';

if (!is_file(__DIR__ . '/config.php')) {
    fail(503, 'not-configured');
}
require __DIR__ . '/config.php';

// For `recentAttempts` and `recordAttempt`, which the board already uses to
// slow one machine down.
require __DIR__ . '/auth.php';

/**
 * How long a message waits to be read.
 *
 * Long enough that a guest who alt-tabbed away misses nothing, short enough
 * that the table is a queue rather than an archive. Nothing here is worth
 * keeping: a room exists for as long as people are standing in it.
 */
const ROOM_TTL_SECONDS = 900;

/** The longest one message may be. A roster of four is a few hundred bytes. */
const ROOM_MESSAGE_BYTES = 4096;

/** The most a single read may return, so a client that vanished cannot ask for a megabyte. */
const ROOM_BATCH = 64;

/**
 * Writes one address may make in the window below.
 *
 * Here rather than in config.php, unlike the board's allowances, and for a
 * practical reason: config.php lives only on the host and is never deployed, so
 * a constant added there is a constant every existing installation is missing.
 * A room's traffic is also not a matter of taste — it is set by how often the
 * game polls, and that is decided in this repository.
 *
 * Generous by the board's standards and mean by a chat's: four people in a room
 * post a roster, a few lines and a start. Two a second sustained is far more
 * than that and far less than a way to fill a table.
 */
const ROOM_LIMIT = 1200;
const ROOM_WINDOW_MINUTES = 10;

/**
 * A code, as the game writes them.
 *
 * Checked here as a shape rather than against a list of live rooms, because
 * this file has no idea which rooms are live — see the note at the top. What
 * the check buys is that the table is keyed by something bounded: without it a
 * `code` parameter is an arbitrary string and the index is at the mercy of
 * whoever calls.
 */
function roomCode(): string
{
    $code = strtoupper((string) ($_GET['code'] ?? ''));
    if (preg_match('/^[2346789ABCDEFGHJKMNPQRTUVWXYZ]{6}$/', $code) !== 1) {
        fail(400, 'bad-code');
    }

    return $code;
}

/** Who is asking, as the id their lobby made for them. */
function memberId(string $raw): string
{
    if (preg_match('/^[2346789ABCDEFGHJKMNPQRTUVWXYZ]{1,24}$/', $raw) !== 1) {
        fail(400, 'bad-member');
    }

    return $raw;
}

/**
 * Drops what nobody is coming back for.
 *
 * Run on writes rather than on a schedule, because shared hosting has no
 * scheduler worth relying on and a queue that is only ever added to is a table
 * that fills up quietly for a year and then fills up loudly.
 */
function sweep(PDO $pdo): void
{
    $pdo->prepare('DELETE FROM room_mail WHERE created_at < (NOW() - INTERVAL :ttl SECOND)')
        ->execute([':ttl' => ROOM_TTL_SECONDS]);
}

$pdo = db();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $code = roomCode();
    $since = max(0, (int) ($_GET['since'] ?? 0));
    $me = memberId((string) ($_GET['me'] ?? 'X'));

    // `sender <> :me` rather than filtering on the client: a broadcast that
    // came back to whoever sent it would double every line of chat and every
    // roster, and the sender already acted on it when they sent it.
    $statement = $pdo->prepare(
        'SELECT id, payload
           FROM room_mail
          WHERE code = :code AND id > :since AND sender <> :me
          ORDER BY id
          LIMIT ' . ROOM_BATCH
    );
    $statement->execute([':code' => $code, ':since' => $since, ':me' => $me]);

    $messages = [];
    $cursor = $since;
    foreach ($statement->fetchAll() as $row) {
        $cursor = (int) $row['id'];
        $decoded = json_decode((string) $row['payload'], true);
        if ($decoded !== null) {
            $messages[] = $decoded;
        }
    }

    respond(200, ['cursor' => $cursor, 'messages' => $messages]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail(405, 'method-not-allowed');
}

$fingerprint = clientFingerprint();
if (recentAttempts($pdo, $fingerprint, 'room', ROOM_WINDOW_MINUTES) >= ROOM_LIMIT) {
    fail(429, 'too-many');
}
recordAttempt($pdo, $fingerprint, 'room');

$code = roomCode();
$raw = (string) file_get_contents('php://input');
if (strlen($raw) > ROOM_MESSAGE_BYTES) {
    fail(413, 'too-long');
}

$body = json_decode($raw, true);
if (!is_array($body) || !isset($body['from']) || !isset($body['message'])) {
    fail(400, 'bad-body');
}

$from = memberId((string) $body['from']);
$payload = json_encode($body['message'], JSON_UNESCAPED_UNICODE);
if ($payload === false || strlen($payload) > ROOM_MESSAGE_BYTES) {
    fail(400, 'bad-message');
}

sweep($pdo);

$insert = $pdo->prepare(
    'INSERT INTO room_mail (code, sender, payload, created_at) VALUES (:code, :from, :payload, NOW())'
);
$insert->execute([':code' => $code, ':from' => $from, ':payload' => $payload]);

respond(200, ['cursor' => (int) $pdo->lastInsertId()]);
