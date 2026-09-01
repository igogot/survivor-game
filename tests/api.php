<?php
/**
 * The server's half of the leaderboard rules, executed.
 *
 * The client and the endpoint have to agree about what a valid run is. If they
 * do not, the game offers to submit a score and the board then refuses it, and
 * the player experiences that as the board being broken. So these cases are
 * deliberately the same ones tests/scores.test.ts runs against the TypeScript.
 *
 * Run it with:
 *
 *     npm run build          # writes public/api/limits.json
 *     php tests/api.php
 *
 * Plain PHP with no framework, because adding Composer and PHPUnit to a project
 * whose server is one file would cost more than it could ever return.
 */

declare(strict_types=1);

require __DIR__ . '/../public/api/validate.php';

$limitsPath = __DIR__ . '/../public/api/limits.json';
if (!file_exists($limitsPath)) {
    fwrite(STDERR, "limits.json is missing — run `npm run build` first.\n");
    exit(1);
}

/** @var array<string, mixed> $limits */
$limits = json_decode((string) file_get_contents($limitsPath), true);

$failures = 0;
$checks = 0;

function check(string $what, bool $passed): void
{
    global $failures, $checks;
    $checks++;
    if ($passed) {
        return;
    }
    $failures++;
    fwrite(STDERR, "  FAIL  {$what}\n");
}

function is(string $what, $actual, $expected): void
{
    check(
        $what . ' — got ' . var_export($actual, true) . ', wanted ' . var_export($expected, true),
        $actual === $expected
    );
}

/** A run the game could actually have produced, so fixtures are never the bug. */
function run(array $over = []): array
{
    $timeMs = $over['timeMs'] ?? 600_000;
    $seconds = max(0, (is_int($timeMs) ? $timeMs : 0) / 1000);

    return array_merge([
        'name' => 'player',
        'timeMs' => $timeMs,
        'kills' => (int) floor($seconds * 8),
        'level' => 1 + (int) floor($seconds / 40),
        'bosses' => (int) floor($seconds / 600),
        'weapon' => 'bolt',
        'seed' => 42,
    ], $over);
}

echo "names\n";
is('trims', cleanName('  spaced  ', 18), 'spaced');
is('caps to the limit', mb_strlen((string) cleanName(str_repeat('x', 200), 18), 'UTF-8'), 18);
is('refuses nothing at all', cleanName('', 18), null);
is('refuses only spaces', cleanName('   ', 18), null);
is('keeps Cyrillic', cleanName('Игрок', 18), 'Игрок');
is('keeps an emoji', cleanName('ka-50🐙', 18), 'ka-50🐙');
is('strips a control character', cleanName("a\x07bc", 18), 'abc');
is('strips a zero-width space', cleanName("we\u{200b}ird", 18), 'weird');
// A newline separates words, so this is two of them and refused rather than
// joined into a name nobody chose.
is('refuses a newline between words', cleanName("two\nlines", 18), null);
is('strips a bidi override', cleanName("right\u{202e}left", 18), 'rightleft');
is('strips a bidi isolate', cleanName("a\u{2066}b", 18), 'ab');
is('is idempotent', cleanName((string) cleanName('  bob ', 18), 18), 'bob');

is('refuses two words', cleanName('two words', 18), null);
is('refuses a tab between words', cleanName("ka	50", 18), null);
is('refuses a non-breaking space', cleanName("a" . mb_chr(0x00a0, 'UTF-8') . "b", 18), null);
is('refuses an ideographic space', cleanName("a" . mb_chr(0x3000, 'UTF-8') . "b", 18), null);
is('still trims the ends', cleanName('  solo  ', 18), 'solo');
is('one word with punctuation is fine', cleanName('ka-50', 18), 'ka-50');

echo "names that look the same
";
/*
 * Both sides have to fold identically, or the game offers a name the board
 * then refuses. These are the same pairs tests/scores.test.ts asserts on.
 */
check('a Cyrillic lookalike folds onto its Latin twin', nameKey('Kira') === nameKey('Кira'));
check('a whole word of them folds', nameKey('POCTOB') === nameKey('РОСТОВ'));
check('Greek folds too', nameKey('okto') === nameKey('οκτο'));
check('case is ignored', nameKey('Kira') === nameKey('kIRA'));
check('different names stay different', nameKey('Kira') !== nameKey('Volk'));
check('different Russian names stay different', nameKey('Игрок') !== nameKey('Волк'));
is('the fold is stable', nameKey(nameKey('Кira')), nameKey('Kira'));

echo "the sampled curves\n";
check('a value below the first sample takes it', ceilingFrom([[10, 100], [20, 200]], 5.0) === 100.0);
check('a value between samples takes the higher', ceilingFrom([[10, 100], [20, 200]], 15.0) === 200.0);
check('a value on a sample takes that one', ceilingFrom([[10, 100], [20, 200]], 10.0) === 100.0);
check('a value past the end takes the last', ceilingFrom([[10, 100], [20, 200]], 999.0) === 200.0);

echo "what the bounds refuse\n";
is('an ordinary run passes', faultInRun(run(), $limits), null);
is('a negative run', faultInRun(run(['timeMs' => -1, 'bosses' => 0]), $limits), 'time');
is('a run longer than a day', faultInRun(run(['timeMs' => 86_400_001, 'bosses' => 0]), $limits), 'time');
is('impossible kills', faultInRun(run(['kills' => 99_999_999]), $limits), 'kills');
is('kills for the time', faultInRun(run(['timeMs' => 10_000, 'kills' => 40_000]), $limits), 'kills');
is('a level the kills cannot pay for', faultInRun(run(['kills' => 0, 'level' => 60]), $limits), 'level');
is('more bosses than the clock allows', faultInRun(run(['timeMs' => 60_000, 'bosses' => 5]), $limits), 'bosses');
is('a fractional time', faultInRun(run(['timeMs' => 1.5]), $limits), 'shape');
is('a string where a number goes', faultInRun(run(['kills' => '100']), $limits), 'shape');
is('a missing field', faultInRun(['name' => 'x'], $limits), 'shape');
is('an uncleaned name', faultInRun(run(['name' => '  padded  ']), $limits), 'name');
is('an empty name', faultInRun(run(['name' => '']), $limits), 'name');
is('a name with an override in it', faultInRun(run(['name' => "bad\u{202e}name"]), $limits), 'name');

echo "the exact bound, spelled out\n";
$interval = (int) $limits['bossIntervalSeconds'];
is('one interval allows one boss', faultInRun(run(['timeMs' => $interval * 1000, 'bosses' => 1]), $limits), null);
is('one interval refuses two', faultInRun(run(['timeMs' => $interval * 1000, 'bosses' => 2]), $limits), 'bosses');
is('a second short of it refuses one', faultInRun(run(['timeMs' => $interval * 1000 - 1000, 'bosses' => 1]), $limits), 'bosses');

echo "what the bounds must never refuse\n";
/*
 * The half that matters. These are real runs, taken off the balance stand's
 * own table — the numbers in README.md — because a bound that lands under a
 * run somebody actually played turns the board into a thing that refuses the
 * players who earned a place on it.
 */
$measured = [
    ['timeMs' => 719_000, 'kills' => 10_616, 'level' => 31, 'bosses' => 1],
    ['timeMs' => 719_000, 'kills' => 10_529, 'level' => 31, 'bosses' => 1],
    ['timeMs' => 453_000, 'kills' => 3_544, 'level' => 21, 'bosses' => 0],
    ['timeMs' => 693_000, 'kills' => 9_384, 'level' => 27, 'bosses' => 1],
    ['timeMs' => 505_000, 'kills' => 4_648, 'level' => 23, 'bosses' => 0],
    // The endless stand's deepest run: ninety minutes, level 118.
    ['timeMs' => 5_400_000, 'kills' => 250_000, 'level' => 118, 'bosses' => 8],
];

foreach ($measured as $index => $played) {
    is("run {$index} from the stand is accepted", faultInRun(run($played), $limits), null);
}

echo "passwords\n";
require __DIR__ . '/../public/api/auth.php';

is('too short is refused', faultInPassword('short'), 'password-short');
is('exactly the minimum is fine', faultInPassword(str_repeat('x', MIN_PASSWORD_LENGTH)), null);
is('an ordinary one is fine', faultInPassword('correct horse battery'), null);
is('a novel is refused', faultInPassword(str_repeat('x', MAX_PASSWORD_LENGTH + 1)), 'password-long');
is('a number is not a password', faultInPassword(12345678), 'password-shape');
is('null is not a password', faultInPassword(null), 'password-shape');

/*
 * Counted in characters rather than bytes. Eight Cyrillic letters are sixteen
 * bytes, and a byte count would quietly accept a four-letter password from
 * anybody not writing in ASCII.
 */
is('eight Cyrillic letters count as eight', faultInPassword('пароль12'), null);
is('four Cyrillic letters are still too short', faultInPassword('паро'), 'password-short');

echo "tokens\n";
$first = mintToken();
$second = mintToken();
is('a token is 64 hex characters', preg_match('/^[0-9a-f]{64}$/', $first), 1);
check('two tokens differ', $first !== $second);
check('the stored form is not the token', hashToken($first) !== $first);
check('hashing is stable', hashToken($first) === hashToken($first));
check('different tokens hash differently', hashToken($first) !== hashToken($second));


echo "\n{$checks} checks, {$failures} failed\n";
exit($failures === 0 ? 0 : 1);
