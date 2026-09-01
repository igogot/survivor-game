<?php
/**
 * Who is allowed to submit under a name.
 *
 * A name is the only identity this board has, so without this anybody could
 * beat your run, submit under your name and take your row. Two ways to hold
 * one, and the difference between them is the whole design:
 *
 *   A token   — minted the first time a name is used, kept by the browser,
 *               never chosen or typed. Costs the player nothing and they need
 *               not know it exists. Lost with the browser's storage.
 *   A password — optional, and the only thing that survives a cleared cache or
 *               moves to another device.
 *
 * Passwords are never kept on the client and never sent with a score. Logging
 * in exchanges one for a token, and from then on the token does the work — so
 * a password crosses the wire only when the player is deliberately signing in,
 * rather than after every run they finish.
 *
 * There is no recovery. No email is collected, so there is nowhere to send a
 * reset to, and a forgotten password means a lost name. That is said plainly
 * on the screen that sets one rather than discovered later.
 */

declare(strict_types=1);

/** Shortest password the endpoint will accept. */
const MIN_PASSWORD_LENGTH = 8;

/** Longest, so a megabyte of text cannot be handed to the hashing function. */
const MAX_PASSWORD_LENGTH = 200;

/**
 * A fresh token: 32 random bytes as hex.
 *
 * `random_bytes` and nothing else. `rand` and `uniqid` are seeded from things
 * an attacker can guess at, and a guessable token is a name anybody can take.
 */
function mintToken(): string
{
    return bin2hex(random_bytes(32));
}

/**
 * How a token is stored.
 *
 * Hashed for the same reason a password is: the table is the thing that leaks,
 * and a stolen token is a stolen name. Plain sha256 rather than a slow hash is
 * right here and wrong for passwords — a 256-bit random string has nothing to
 * brute force, so the only property needed is that the stored form cannot be
 * turned back into the token.
 */
function hashToken(string $token): string
{
    return hash('sha256', $token);
}

/**
 * Whether this name — or anything that looks exactly like it — has been claimed.
 *
 * Looked up by the folded key rather than by the name, so `Kira` finds a row
 * claimed as `Кira` with a Cyrillic К. Matching on the name itself would let
 * the two coexist, which is the impersonation owning a name is meant to stop.
 */
function ownerOf(PDO $pdo, string $name): ?array
{
    $statement = $pdo->prepare('SELECT name, password_hash FROM owners WHERE name_key = ?');
    $statement->execute([nameKey($name)]);
    $row = $statement->fetch();

    return $row === false ? null : $row;
}

/**
 * Whether this token holds this name.
 *
 * The lookup is by hash, so a token that is not in the table finds nothing and
 * costs one index read — there is no comparison to time and nothing to leak by
 * how long the answer took.
 */
function tokenHoldsName(PDO $pdo, string $name, string $token): bool
{
    if ($token === '') {
        return false;
    }

    // The owner row is the one that decides what the name is. Comparing the
    // token against the name as typed would refuse somebody whose own name
    // reaches them in a different case than they claimed it in.
    $owner = ownerOf($pdo, $name);
    if ($owner === null) {
        return false;
    }

    $statement = $pdo->prepare('SELECT 1 FROM tokens WHERE name = ? AND token_hash = ?');
    $statement->execute([$owner['name'], hashToken($token)]);

    return $statement->fetchColumn() !== false;
}

/** Records a token against a name and hands the plain one back to the caller. */
function grantToken(PDO $pdo, string $name): string
{
    $token = mintToken();
    $pdo->prepare('INSERT INTO tokens (name, token_hash, created_at) VALUES (?, ?, NOW())')
        ->execute([$name, hashToken($token)]);

    return $token;
}

/**
 * Claims an unclaimed name, or reports that somebody else holds it.
 *
 * Returns the new token on a successful claim, or null when the name is taken
 * and the proof offered does not hold it. The insert is what decides, not the
 * read before it: two players claiming the same free name at the same instant
 * both see it as free, and the unique key on `owners.name` is the only thing
 * that can order them.
 */
function claimName(PDO $pdo, string $name): ?string
{
    try {
        $pdo->prepare(
            'INSERT INTO owners (name, name_key, password_hash, created_at)
                  VALUES (?, ?, NULL, NOW())'
        )->execute([$name, nameKey($name)]);
    } catch (PDOException $e) {
        // Somebody won the race. Not an error worth logging — it is the unique
        // key doing exactly its job.
        if (($e->errorInfo[1] ?? 0) === 1062) {
            return null;
        }
        throw $e;
    }

    return grantToken($pdo, $name);
}

/** Why a password will not do, or null when it will. */
function faultInPassword(mixed $password): ?string
{
    if (!is_string($password)) {
        return 'password-shape';
    }
    // Counted in characters rather than bytes, so a short Cyrillic password is
    // not silently accepted for being long in UTF-8.
    $length = mb_strlen($password, 'UTF-8');
    if ($length < MIN_PASSWORD_LENGTH) {
        return 'password-short';
    }
    if ($length > MAX_PASSWORD_LENGTH) {
        return 'password-long';
    }

    return null;
}

/**
 * Counts recent attempts of one kind from one caller.
 *
 * Guessing a password deserves a far tighter allowance than finishing runs
 * does, which is why the kind is part of the count rather than everything
 * sharing one budget.
 */
function recentAttempts(PDO $pdo, string $fingerprint, string $kind, int $windowMinutes): int
{
    // Interpolated, not bound: MySQL will not accept a placeholder as the
    // quantity of an INTERVAL. It is an integer constant from config.php and
    // never touches anything a request sent.
    $window = (int) $windowMinutes;
    $statement = $pdo->prepare(
        "SELECT COUNT(*) FROM submissions
          WHERE fingerprint = ? AND kind = ? AND created_at > (NOW() - INTERVAL {$window} MINUTE)"
    );
    $statement->execute([$fingerprint, $kind]);

    return (int) $statement->fetchColumn();
}

function recordAttempt(PDO $pdo, string $fingerprint, string $kind): void
{
    $pdo->prepare('INSERT INTO submissions (fingerprint, kind, created_at) VALUES (?, ?, NOW())')
        ->execute([$fingerprint, $kind]);
}
