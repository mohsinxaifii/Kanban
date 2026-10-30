<?php
// Passwords. New hashes use PHP's password_hash (bcrypt). Accounts created by the earlier
// Node.js version have "scrypt$salt$key" hashes (N=16384, r=8, p=1, 64 bytes); those are
// checked with the scrypt below and upgraded to password_hash on the next sign-in.

function hash_password(string $pw): string {
  return password_hash($pw, PASSWORD_DEFAULT);
}

// Returns [ok, upgraded hash or null].
function verify_password(string $pw, ?string $stored): array {
  $stored = (string) $stored;
  if (str_starts_with($stored, 'scrypt$')) {
    $parts = explode('$', $stored);
    if (count($parts) !== 3) return [false, null];
    $salt = base64_decode($parts[1], true);
    $expected = base64_decode($parts[2], true);
    if ($salt === false || $expected === false) return [false, null];
    $key = scrypt($pw, $salt, 16384, 8, 1, strlen($expected));
    $ok = hash_equals($expected, $key);
    return [$ok, $ok ? hash_password($pw) : null];
  }
  if ($stored === '') return [false, null];
  $ok = password_verify($pw, $stored);
  return [$ok, $ok && password_needs_rehash($stored, PASSWORD_DEFAULT) ? hash_password($pw) : null];
}

// scrypt (RFC 7914) in plain PHP, used only for hashes from the earlier version.
function scrypt(string $pw, string $salt, int $N, int $r, int $p, int $len): string {
  $B = hash_pbkdf2('sha256', $pw, $salt, 1, $p * 128 * $r, true);
  $out = '';
  for ($i = 0; $i < $p; $i++) {
    $block = array_values(unpack('V*', substr($B, $i * 128 * $r, 128 * $r)));
    $out .= pack('V*', ...scrypt_romix($block, $N, $r));
  }
  return hash_pbkdf2('sha256', $pw, $out, 1, $len, true);
}

function scrypt_romix(array $X, int $N, int $r): array {
  // V is kept as packed strings (128·r bytes each, 16 MB in total) to stay well inside
  // shared-hosting memory limits; arrays of integers would need about eight times more.
  $V = [];
  for ($i = 0; $i < $N; $i++) { $V[$i] = pack('V*', ...$X); $X = scrypt_blockmix($X, $r); }
  $last = (2 * $r - 1) * 16;
  for ($i = 0; $i < $N; $i++) {
    $X = scrypt_blockmix(array_values(unpack('V*', pack('V*', ...$X) ^ $V[$X[$last] & ($N - 1)])), $r);
  }
  return $X;
}

function scrypt_blockmix(array $B, int $r): array {
  $x = array_slice($B, (2 * $r - 1) * 16, 16);
  $even = []; $odd = [];
  for ($i = 0; $i < 2 * $r; $i++) {
    $o = $i * 16;
    for ($k = 0; $k < 16; $k++) $x[$k] ^= $B[$o + $k];
    $x = salsa20_8($x);
    if ($i % 2) array_push($odd, ...$x); else array_push($even, ...$x);
  }
  return array_merge($even, $odd);
}

function salsa20_8(array $in): array {
  [$x0, $x1, $x2, $x3, $x4, $x5, $x6, $x7, $x8, $x9, $x10, $x11, $x12, $x13, $x14, $x15] = $in;
  for ($i = 0; $i < 4; $i++) {
    $t = ($x0 + $x12) & 0xffffffff; $x4 ^= (($t << 7) | ($t >> 25)) & 0xffffffff;
    $t = ($x4 + $x0) & 0xffffffff; $x8 ^= (($t << 9) | ($t >> 23)) & 0xffffffff;
    $t = ($x8 + $x4) & 0xffffffff; $x12 ^= (($t << 13) | ($t >> 19)) & 0xffffffff;
    $t = ($x12 + $x8) & 0xffffffff; $x0 ^= (($t << 18) | ($t >> 14)) & 0xffffffff;
    $t = ($x5 + $x1) & 0xffffffff; $x9 ^= (($t << 7) | ($t >> 25)) & 0xffffffff;
    $t = ($x9 + $x5) & 0xffffffff; $x13 ^= (($t << 9) | ($t >> 23)) & 0xffffffff;
    $t = ($x13 + $x9) & 0xffffffff; $x1 ^= (($t << 13) | ($t >> 19)) & 0xffffffff;
    $t = ($x1 + $x13) & 0xffffffff; $x5 ^= (($t << 18) | ($t >> 14)) & 0xffffffff;
    $t = ($x10 + $x6) & 0xffffffff; $x14 ^= (($t << 7) | ($t >> 25)) & 0xffffffff;
    $t = ($x14 + $x10) & 0xffffffff; $x2 ^= (($t << 9) | ($t >> 23)) & 0xffffffff;
    $t = ($x2 + $x14) & 0xffffffff; $x6 ^= (($t << 13) | ($t >> 19)) & 0xffffffff;
    $t = ($x6 + $x2) & 0xffffffff; $x10 ^= (($t << 18) | ($t >> 14)) & 0xffffffff;
    $t = ($x15 + $x11) & 0xffffffff; $x3 ^= (($t << 7) | ($t >> 25)) & 0xffffffff;
    $t = ($x3 + $x15) & 0xffffffff; $x7 ^= (($t << 9) | ($t >> 23)) & 0xffffffff;
    $t = ($x7 + $x3) & 0xffffffff; $x11 ^= (($t << 13) | ($t >> 19)) & 0xffffffff;
    $t = ($x11 + $x7) & 0xffffffff; $x15 ^= (($t << 18) | ($t >> 14)) & 0xffffffff;
    $t = ($x0 + $x3) & 0xffffffff; $x1 ^= (($t << 7) | ($t >> 25)) & 0xffffffff;
    $t = ($x1 + $x0) & 0xffffffff; $x2 ^= (($t << 9) | ($t >> 23)) & 0xffffffff;
    $t = ($x2 + $x1) & 0xffffffff; $x3 ^= (($t << 13) | ($t >> 19)) & 0xffffffff;
    $t = ($x3 + $x2) & 0xffffffff; $x0 ^= (($t << 18) | ($t >> 14)) & 0xffffffff;
    $t = ($x5 + $x4) & 0xffffffff; $x6 ^= (($t << 7) | ($t >> 25)) & 0xffffffff;
    $t = ($x6 + $x5) & 0xffffffff; $x7 ^= (($t << 9) | ($t >> 23)) & 0xffffffff;
    $t = ($x7 + $x6) & 0xffffffff; $x4 ^= (($t << 13) | ($t >> 19)) & 0xffffffff;
    $t = ($x4 + $x7) & 0xffffffff; $x5 ^= (($t << 18) | ($t >> 14)) & 0xffffffff;
    $t = ($x10 + $x9) & 0xffffffff; $x11 ^= (($t << 7) | ($t >> 25)) & 0xffffffff;
    $t = ($x11 + $x10) & 0xffffffff; $x8 ^= (($t << 9) | ($t >> 23)) & 0xffffffff;
    $t = ($x8 + $x11) & 0xffffffff; $x9 ^= (($t << 13) | ($t >> 19)) & 0xffffffff;
    $t = ($x9 + $x8) & 0xffffffff; $x10 ^= (($t << 18) | ($t >> 14)) & 0xffffffff;
    $t = ($x15 + $x14) & 0xffffffff; $x12 ^= (($t << 7) | ($t >> 25)) & 0xffffffff;
    $t = ($x12 + $x15) & 0xffffffff; $x13 ^= (($t << 9) | ($t >> 23)) & 0xffffffff;
    $t = ($x13 + $x12) & 0xffffffff; $x14 ^= (($t << 13) | ($t >> 19)) & 0xffffffff;
    $t = ($x14 + $x13) & 0xffffffff; $x15 ^= (($t << 18) | ($t >> 14)) & 0xffffffff;
  }
  return [
    ($x0 + $in[0]) & 0xffffffff, ($x1 + $in[1]) & 0xffffffff, ($x2 + $in[2]) & 0xffffffff, ($x3 + $in[3]) & 0xffffffff,
    ($x4 + $in[4]) & 0xffffffff, ($x5 + $in[5]) & 0xffffffff, ($x6 + $in[6]) & 0xffffffff, ($x7 + $in[7]) & 0xffffffff,
    ($x8 + $in[8]) & 0xffffffff, ($x9 + $in[9]) & 0xffffffff, ($x10 + $in[10]) & 0xffffffff, ($x11 + $in[11]) & 0xffffffff,
    ($x12 + $in[12]) & 0xffffffff, ($x13 + $in[13]) & 0xffffffff, ($x14 + $in[14]) & 0xffffffff, ($x15 + $in[15]) & 0xffffffff,
  ];
}
