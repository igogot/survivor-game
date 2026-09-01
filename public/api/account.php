<?php
/**
 * Signing in, and choosing to have an account at all.
 *
 * Three things a player can ask for, and nothing else:
 *
 *   register  a free name, with a password, from a device that holds nothing
 *   login     a name they have a password for, on any device
 *   protect   a name they already hold by token, given a password to keep it by
 *
 * `protect` is the one that matters most and the one easiest to miss. Most
 * players will never register: they will type a name after a good run, the
 * board will mint them a token, and it will work. The moment worth catching is
 * when that player wants their name to survive a new laptop — at that point
 * they already own it, so setting a password is a change to a thing they hold
 * rather than a sign-up.
 *
 * Every path answers with a token and never with anything derived from the
 * password. The password's whole job is to get a token; after that it is not
 * needed again and is not kept anywhere on the client.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require __DIR__ . '/config.php';
require __DIR__ . '/validate.php';
require __DIR__ . '/auth.php';
require __DIR__ . '/shared.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fail(405, 'method-not-allowed');
}

$body = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($body)) {
    fail(400, 'malformed');
}

$limits = limits();

$action = $body['action'] ?? '';
if (!in_array($action, ['register', 'login', 'protect'], true)) {
    fail(400, 'unknown-action');
}

$name = is_string($body['name'] ?? null)
    ? cleanName($body['name'], (int) $limits['maxNameLength'])
    : null;
if ($name === null || $name !== ($body['name'] ?? null)) {
    fail(422, 'name');
}

$passwordFault = faultInPassword($body['password'] ?? null);
if ($passwordFault !== null) {
    fail(422, $passwordFault);
}
$password = (string) $body['password'];

$pdo = db();
$fingerprint = clientFingerprint();

/*
 * Every path here is rate limited, including the ones that succeed.
 *
 * Counting only failures would leave the cheapest attack open: a name is worth
 * guessing at, and an attacker who gets one right on the tenth try has not
 * failed ten times as far as a failure-only counter is concerned. The
 * allowance is deliberately far tighter than the one on submitting a score.
 */
if (recentAttempts($pdo, $fingerprint, 'auth', AUTH_WINDOW_MINUTES) >= AUTH_LIMIT) {
    fail(429, 'too-many-attempts');
}
recordAttempt($pdo, $fingerprint, 'auth');

$owner = ownerOf($pdo, $name);

if ($action === 'register') {
    if ($owner !== null) {
        // Deliberately the same answer as a wrong password below. Saying "that
        // name exists" turns this endpoint into a way to enumerate who is on
        // the board, and the board already shows that — but only for names
        // that have actually scored, not for every name anybody reserved.
        fail(409, 'name-taken');
    }

    $token = claimName($pdo, $name);
    if ($token === null) {
        fail(409, 'name-taken');
    }

    setPassword($pdo, $name, $password);
    respond(200, ['name' => $name, 'token' => $token, 'protected' => true]);
}

if ($action === 'protect') {
    $token = is_string($body['token'] ?? null) ? $body['token'] : '';

    // Holding the name is the whole permission. Somebody who cannot prove that
    // is trying to put a password on a name that is not theirs.
    if ($owner === null || !tokenHoldsName($pdo, $name, $token)) {
        fail(403, 'not-yours');
    }
    if (($owner['password_hash'] ?? null) !== null) {
        fail(409, 'already-protected');
    }

    setPassword($pdo, $name, $password);
    // The same token keeps working; nothing about this device changed.
    respond(200, ['name' => $name, 'token' => $token, 'protected' => true]);
}

// login
if ($owner === null || ($owner['password_hash'] ?? null) === null) {
    // A name with no account is the same answer as a wrong password, so this
    // cannot be used to find out which names have one.
    fail(401, 'wrong-credentials');
}

if (!password_verify($password, (string) $owner['password_hash'])) {
    fail(401, 'wrong-credentials');
}

/*
 * A token per login rather than one per name.
 *
 * Signing in on a phone must not sign the desktop out — that is somebody
 * losing their name to their own second device, which reads as the board
 * eating it.
 */
respond(200, ['name' => $name, 'token' => grantToken($pdo, $name), 'protected' => true]);

/**
 * Stores a password.
 *
 * `password_hash` with the default algorithm, which is bcrypt today and
 * whatever PHP moves to tomorrow. Never a plain digest: people reuse passwords,
 * so a leak of this table is a leak of accounts elsewhere, and that is worth
 * more care than a game leaderboard needs for its own sake.
 */
function setPassword(PDO $pdo, string $name, string $password): void
{
    $pdo->prepare('UPDATE owners SET password_hash = ? WHERE name_key = ?')
        ->execute([password_hash($password, PASSWORD_DEFAULT), nameKey($name)]);
}
