<?php
/**
 * Copy to config.php on the host and fill in. Never committed, never uploaded.
 *
 * config.php is in .gitignore and in the deploy workflow's exclude list, so it
 * is created once by hand over FTP and then left alone. Both halves of that
 * matter: without the exclude, the deploy would delete it on the next push and
 * the board would start answering 503 to everybody.
 */

declare(strict_types=1);

// From the hosting panel. On reg.ru shared hosting the host is usually
// localhost and the database and user names are prefixed with the account.
const DB_HOST = 'localhost';
const DB_NAME = 'uXXXXXX_survivor';
const DB_USER = 'uXXXXXX_survivor';
const DB_PASSWORD = 'put-the-real-one-here';

/**
 * Any random string, set once and then left alone.
 *
 * The rate limiter hashes the client address with this. Without a salt the
 * table would hold plain hashes of addresses, which are trivially reversible —
 * there are only four billion of them.
 */
const SUBMIT_SALT = 'change-me-to-something-random';

/** How many submissions one address may make inside the window. */
const SUBMIT_LIMIT = 20;

/** The window, in minutes. */
const SUBMIT_WINDOW_MINUTES = 10;

/**
 * How many times one address may try to log in or register inside its window.
 *
 * Far tighter than the submit allowance, because this is the one endpoint
 * where guessing repeatedly is the attack. Successes are counted too: an
 * attacker who gets a password right on the tenth try has not failed ten
 * times, as far as a failure-only counter is concerned.
 */
const AUTH_LIMIT = 10;

/** That window, in minutes. */
const AUTH_WINDOW_MINUTES = 10;
