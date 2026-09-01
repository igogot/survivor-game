<?php
/**
 * Everything the endpoint decides without touching the database or the request.
 *
 * Split out of scores.php for two reasons. It is the half most likely to be
 * subtly wrong — Unicode filtering and a sampled curve read backwards look
 * exactly like working code — and it is the half that can be executed on a
 * machine with no MySQL on it. tests/api.php runs it, and runs it against the
 * same cases tests/scores.test.ts runs the TypeScript against, because these
 * two must agree: a run the game offers to submit and the board then refuses
 * is a bug the player experiences as the board being broken.
 */

declare(strict_types=1);

/**
 * Strips what a keyboard did not mean to send, then trims and caps.
 *
 * Deliberately the same rules as `cleanName` in src/core/scores.ts, including
 * the bidi block: those characters are not typos, they reorder the glyphs
 * around them, and one name carrying an override rewrites how its neighbours
 * read on a public board.
 */
function cleanName(string $raw, int $maxLength): ?string
{
    /*
     * The one-word rule is checked first, on what was actually typed.
     *
     * Order matters and the reverse of it is a bug: a tab is a control
     * character, so stripping first would remove it and leave "ka	50" as the
     * single word "ka50" — a name nobody chose. Refusing can only be done
     * while the separator is still there.
     */
    $typed = trim($raw);
    if (preg_match('/\s/u', $typed) === 1) {
        return null;
    }

    $kept = '';
    $length = mb_strlen($typed, 'UTF-8');

    for ($i = 0; $i < $length; $i++) {
        $character = mb_substr($typed, $i, 1, 'UTF-8');
        $point = mb_ord($character, 'UTF-8');
        if ($point === false || !isNameCharacter($point)) {
            continue;
        }
        $kept .= $character;
    }

    $trimmed = trim($kept);
    if ($trimmed === '') {
        return null;
    }

    return mb_substr($trimmed, 0, $maxLength, 'UTF-8');
}

/**
 * The form two names are compared in.
 *
 * Deliberately the same fold as `nameKey` in src/core/scores.ts, and for the
 * same reason: `Kira` and `Кira` with a Cyrillic К are different strings that
 * render identically, so a board refusing only exact matches shows one name
 * twice with two people behind it.
 *
 * Never displayed. What a player typed is what the board shows; this only
 * decides whether the name is already taken.
 */
function nameKey(string $name): string
{
    static $confusable = [
        // Cyrillic
        'а' => 'a', 'в' => 'b', 'е' => 'e', 'ё' => 'e', 'з' => '3', 'и' => 'u',
        'к' => 'k', 'м' => 'm', 'н' => 'h', 'о' => 'o', 'р' => 'p', 'с' => 'c',
        'т' => 't', 'у' => 'y', 'х' => 'x', 'ѕ' => 's', 'і' => 'i', 'ј' => 'j',
        'ԁ' => 'd', 'ԛ' => 'q', 'ѡ' => 'w',
        // Greek
        'α' => 'a', 'β' => 'b', 'ε' => 'e', 'ζ' => 'z', 'η' => 'n', 'ι' => 'i',
        'κ' => 'k', 'μ' => 'm', 'ν' => 'v', 'ο' => 'o', 'ρ' => 'p', 'τ' => 't',
        'υ' => 'y', 'χ' => 'x', 'ѳ' => 'o',
    ];

    return strtr(mb_strtolower($name, 'UTF-8'), $confusable);
}

/** Whether a code point may appear in a name. Mirrors the TypeScript exactly. */
function isNameCharacter(int $point): bool
{
    if ($point < 0x20) {
        return false; // C0 controls, newlines included
    }
    if ($point >= 0x7f && $point <= 0x9f) {
        return false; // DEL and the C1 block
    }
    if ($point >= 0x200b && $point <= 0x200f) {
        return false; // zero-width joiners and marks
    }
    if ($point === 0x2028 || $point === 0x2029) {
        return false; // line and paragraph separators
    }
    if ($point >= 0x202a && $point <= 0x202e) {
        return false; // bidi embeddings and overrides
    }
    if ($point >= 0x2066 && $point <= 0x2069) {
        return false; // bidi isolates
    }
    return true;
}

/**
 * The ceiling at `$x`, read off a sampled curve.
 *
 * Both curves are monotonic, so a value between two samples takes the higher
 * one. That errs towards accepting, which is the direction a bound on the
 * impossible has to err in: refusing a real run costs a player their place,
 * while accepting a slightly generous one costs nothing anybody notices.
 */
function ceilingFrom(array $samples, float $x): float
{
    $ceiling = 0.0;
    foreach ($samples as [$at, $value]) {
        $ceiling = (float) $value;
        if ($x <= (float) $at) {
            return $ceiling;
        }
    }

    return $ceiling;
}

/**
 * Why a submitted run is not one this game could have produced, or null.
 *
 * Returns the same words `ScoreFault` uses in the TypeScript, so a refusal
 * reads the same on both sides of the wire.
 */
function faultInRun(array $body, array $limits): ?string
{
    foreach (['timeMs', 'kills', 'level', 'bosses', 'seed'] as $key) {
        // A float that happens to be whole is still a client that rounded
        // somewhere it should not have, and letting it through means two
        // clients can disagree about the same run.
        if (!is_int($body[$key] ?? null)) {
            return 'shape';
        }
    }

    $name = is_string($body['name'] ?? null)
        ? cleanName($body['name'], (int) $limits['maxNameLength'])
        : null;
    if ($name === null || $name !== $body['name']) {
        // Refused rather than quietly cleaned: the client cleans a name before
        // sending it, so anything different here means the two disagree about
        // the rules, and guessing which is right is how they drift apart.
        return 'name';
    }

    $timeMs = (int) $body['timeMs'];
    $kills = (int) $body['kills'];
    $level = (int) $body['level'];
    $bosses = (int) $body['bosses'];

    if ($timeMs < 0 || $timeMs > (int) $limits['maxRunMs']) {
        return 'time';
    }
    if ($kills < 0 || $kills > ceilingFrom($limits['killCeiling'], $timeMs / 1000)) {
        return 'kills';
    }
    if ($level < 1 || $level > ceilingFrom($limits['levelCeiling'], $kills)) {
        return 'level';
    }

    $bossCeiling = (int) floor(($timeMs / 1000) / (float) $limits['bossIntervalSeconds'])
        * (int) $limits['bossesPerInterval'];
    if ($bosses < 0 || $bosses > $bossCeiling) {
        return 'bosses';
    }

    return null;
}
