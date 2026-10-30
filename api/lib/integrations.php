<?php
// Google Drive links, Google sign-in and email. All optional.

// ---------- Google Drive ----------
// App permissions and Drive permissions are separate: nothing here changes sharing on a
// file, and nothing claims a reviewer can open it.
function parse_drive_link($raw): ?array {
  $link = trim((string) $raw);
  $patterns = [
    ['file', '#^https://drive\.google\.com/file/d/([\w-]{10,})#'],
    ['folder', '#^https://drive\.google\.com/drive/(?:u/\d+/)?folders/([\w-]{10,})#'],
    ['file', '#^https://drive\.google\.com/open\?id=([\w-]{10,})#'],
    ['doc', '#^https://docs\.google\.com/(?:document|spreadsheets|presentation)/d/([\w-]{10,})#'],
  ];
  foreach ($patterns as [$kind, $re]) if (preg_match($re, $link, $m)) return ['link' => $link, 'kind' => $kind, 'drive_id' => $m[1]];
  return null;
}

function preview_url(array $sub): ?string {
  if (!$sub['drive_id']) return null;
  if ($sub['link_kind'] === 'folder') return "https://drive.google.com/embeddedfolderview?id={$sub['drive_id']}#grid";
  if ($sub['link_kind'] === 'doc' && preg_match('#docs\.google\.com/(document|spreadsheets|presentation)/#', $sub['link'], $m)) {
    return "https://docs.google.com/{$m[1]}/d/{$sub['drive_id']}/preview";
  }
  return "https://drive.google.com/file/d/{$sub['drive_id']}/preview";
}

function drive_integration(): ?string { return cfg('GOOGLE_DRIVE_API_KEY') !== '' ? 'api_key' : null; }

// With an API key, Drive only answers for files shared as "anyone with the link".
function check_link_sharing(string $driveId): array {
  $key = cfg('GOOGLE_DRIVE_API_KEY');
  if ($key === '') return ['not_checked', 'No Google Drive integration is configured, so access has not been checked.'];
  try {
    [$status, $res] = http_request('GET', 'https://www.googleapis.com/drive/v3/files/' . rawurlencode($driveId) . '?fields=id,name,mimeType&supportsAllDrives=true&key=' . rawurlencode($key), null, [], 8);
    if ($status >= 200 && $status < 300) {
      $f = json_decode($res, true);
      return ['link_shared', 'Drive reports "' . ($f['name'] ?? 'the file') . '" is shared with anyone who has the link.'];
    }
    if ($status === 404 || $status === 403) return ['restricted', 'Drive did not open this link anonymously. It is restricted, so each reviewer needs to be shared on it in Google Drive.'];
    return ['error', "Drive check failed (HTTP $status). Access has not been verified."];
  } catch (Throwable $e) {
    return ['error', 'Drive check could not be completed. Access has not been verified.'];
  }
}

// ---------- Google sign-in ----------
// Google only proves who someone is. It never creates an account or grants access.
function google_enabled(): bool { return cfg('GOOGLE_CLIENT_ID') !== '' && cfg('GOOGLE_CLIENT_SECRET') !== ''; }
function google_redirect_uri(): string { return public_url() . '/api/auth/google/callback'; }

function google_start(): array {
  $state = token(16);
  $nonce = token(16);
  $url = 'https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query([
    'client_id' => cfg('GOOGLE_CLIENT_ID'), 'redirect_uri' => google_redirect_uri(), 'response_type' => 'code',
    'scope' => 'openid email profile', 'state' => $state, 'nonce' => $nonce, 'prompt' => 'select_account',
  ], '', '&', PHP_QUERY_RFC3986);
  return [$url, $state, $nonce];
}

// Exchanges the code and returns the verified email. The ID token comes straight from
// Google's token endpoint over TLS, authenticated with our client secret.
function google_finish(string $code, string $expectedNonce): string {
  try {
    [$status, $res] = http_request('POST', cfg('GOOGLE_TOKEN_URL', 'https://oauth2.googleapis.com/token'), http_build_query([
      'code' => $code, 'client_id' => cfg('GOOGLE_CLIENT_ID'), 'client_secret' => cfg('GOOGLE_CLIENT_SECRET'),
      'redirect_uri' => google_redirect_uri(), 'grant_type' => 'authorization_code',
    ]), ['Content-Type: application/x-www-form-urlencoded']);
  } catch (Throwable $e) { throw new RuntimeException('google-exchange'); }
  if ($status < 200 || $status >= 300) throw new RuntimeException('google-exchange');
  $idToken = (string) (json_decode($res, true)['id_token'] ?? '');
  $payload = explode('.', $idToken)[1] ?? '';
  $claims = json_decode((string) base64_decode(strtr($payload, '-_', '+/')), true) ?: [];
  $issuerOk = in_array($claims['iss'] ?? '', ['accounts.google.com', 'https://accounts.google.com'], true);
  if (!$issuerOk || ($claims['aud'] ?? '') !== cfg('GOOGLE_CLIENT_ID') || ($claims['nonce'] ?? '') !== $expectedNonce || ($claims['exp'] ?? 0) * 1000 < now_ms()) {
    throw new RuntimeException('google-token');
  }
  if (empty($claims['email']) || ($claims['email_verified'] ?? null) !== true) throw new RuntimeException('google-unverified');
  return strtolower((string) $claims['email']);
}

// ---------- email ----------
// Sent through the server's own mail (PHP mail(), which cPanel delivers), or through an
// SMTP mailbox when SMTP_HOST is set. Without EMAIL_FROM nothing is sent and admins copy
// links themselves.
function email_enabled(): bool { return cfg('EMAIL_FROM') !== ''; }

function esc(string $s): string { return htmlspecialchars($s, ENT_QUOTES, 'UTF-8'); }
function first_name(string $name): string { return explode(' ', trim($name))[0]; }

function email_html(string $inner): string {
  return '<div style="font-family:-apple-system,Segoe UI,Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1a1a1f;max-width:520px">' . $inner . '</div>';
}
function email_button(string $url, string $label): string {
  return '<p style="margin:24px 0"><a href="' . esc($url) . '" style="background:#111114;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;display:inline-block">' . esc($label) . '</a></p>';
}

function send_invite(string $to, string $name, string $inviter, string $url): array {
  if (!email_enabled()) return ['status' => 'not_configured'];
  $first = first_name($name);
  $text = "Hi $first,\n\n$inviter has invited you to the Design Dimensions studio, where the team plans, reviews and delivers creative work.\n\nAccept your invitation and choose a password:\n$url\n\nThis link is just for you ($to) and works once. If you were not expecting it, you can ignore this email.";
  $html = email_html('<img src="' . esc(public_url()) . '/dd-logo.png" alt="Design Dimensions" width="120" style="display:block;margin:0 0 20px">'
    . '<p>Hi ' . esc($first) . ',</p><p>' . esc($inviter) . ' has invited you to the <b>Design Dimensions studio</b>, where the team plans, reviews and delivers creative work.</p>'
    . email_button($url, 'Accept invitation')
    . '<p style="color:#7a7c85;font-size:12px">Or paste this link into your browser:<br>' . esc($url) . '</p>'
    . '<p style="color:#7a7c85;font-size:12px">This link is just for you (' . esc($to) . ') and works once. If you were not expecting it, you can ignore this email.</p>');
  return send_email($to, "$inviter invited you to the Design Dimensions studio", $text, $html);
}

function send_reset(string $to, string $name, string $url): array {
  $first = first_name($name);
  $text = "Hi $first,\n\nSomeone (hopefully you) asked to reset your Design Dimensions studio password. Choose a new one here:\n$url\n\nThe link works once and expires in one hour. If you did not ask for this, ignore this email; your password stays the same.";
  $html = email_html('<p>Hi ' . esc($first) . ',</p><p>Someone (hopefully you) asked to reset your <b>Design Dimensions studio</b> password.</p>'
    . email_button($url, 'Choose a new password')
    . '<p style="color:#7a7c85;font-size:12px">The link works once and expires in one hour. If you did not ask for this, ignore this email; your password stays the same.</p>');
  return send_email($to, 'Reset your Design Dimensions studio password', $text, $html);
}

function send_signup_notice(string $to, string $adminName, array $person): array {
  $url = public_url() . '/#/settings';
  $text = 'Hi ' . first_name($adminName) . ",\n\n{$person['name']} ({$person['email']}) asked to join the Design Dimensions studio as \"{$person['title']}\".\n\nThey cannot sign in until you approve them. Review the request and choose their role and permissions in Settings:\n$url";
  $html = email_html('<p>Hi ' . esc(first_name($adminName)) . ',</p><p><b>' . esc($person['name']) . '</b> (' . esc($person['email']) . ') asked to join the Design Dimensions studio as <b>' . esc($person['title']) . '</b>.</p><p>They cannot sign in until you approve them.</p>' . email_button($url, 'Review request'));
  return send_email($to, "{$person['name']} asked to join the studio", $text, $html);
}

function send_approved(string $to, string $name): array {
  $url = public_url();
  $text = 'Hi ' . first_name($name) . ",\n\nYour request to join the Design Dimensions studio was approved. Sign in here:\n$url";
  $html = email_html('<p>Hi ' . esc(first_name($name)) . ',</p><p>Your request to join the <b>Design Dimensions studio</b> was approved.</p>' . email_button($url, 'Sign in'));
  return send_email($to, 'You can now sign in to the Design Dimensions studio', $text, $html);
}

function send_email(string $to, string $subject, string $text, string $html): array {
  if (!email_enabled()) return ['status' => 'not_configured'];
  $from = cfg('EMAIL_FROM');
  $fromAddr = preg_match('/<([^>]+)>/', $from, $m) ? $m[1] : trim($from);
  $boundary = 'b' . bin2hex(random_bytes(8));
  $headers = [
    'From: ' . $from,
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="' . $boundary . '"',
  ];
  $mime = "--$boundary\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n" . quoted_printable_encode($text)
    . "\r\n--$boundary\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n" . quoted_printable_encode($html)
    . "\r\n--$boundary--\r\n";
  $encSubject = '=?UTF-8?B?' . base64_encode($subject) . '?=';

  if (cfg('SMTP_HOST') === '') {
    $ok = @mail($to, $encSubject, $mime, implode("\r\n", $headers), '-f' . $fromAddr);
    return $ok ? ['status' => 'sent'] : ['status' => 'failed', 'error' => 'The server could not send the email.'];
  }
  try {
    smtp_send($fromAddr, $to, array_merge($headers, ['To: ' . $to, 'Subject: ' . $encSubject, 'Date: ' . date('r')]), $mime);
    return ['status' => 'sent'];
  } catch (RuntimeException $e) {
    return ['status' => 'failed', 'error' => $e->getMessage()];
  }
}

// Minimal SMTP client: implicit TLS on 465, STARTTLS when offered on other ports.
function smtp_send(string $from, string $to, array $headers, string $body): void {
  $host = cfg('SMTP_HOST');
  $port = (int) cfg('SMTP_PORT', '465');
  $remote = ($port === 465 ? 'ssl://' : 'tcp://') . $host . ':' . $port;
  $s = @stream_socket_client($remote, $errno, $errstr, 10);
  if (!$s) throw new RuntimeException('Could not reach the mail server.');
  stream_set_timeout($s, 15);
  $read = function () use ($s) {
    $all = '';
    while (($line = fgets($s, 1024)) !== false) { $all .= $line; if (strlen($line) < 4 || $line[3] === ' ') break; }
    return $all;
  };
  $cmd = function (?string $line, array $ok) use ($s, $read) {
    if ($line !== null) fwrite($s, $line . "\r\n");
    $r = $read();
    if (!in_array((int) substr($r, 0, 3), $ok, true)) throw new RuntimeException(trim($r) ?: 'The mail server closed the connection.');
    return $r;
  };
  try {
    $cmd(null, [220]);
    $ehlo = $cmd('EHLO ' . (gethostname() ?: 'localhost'), [250]);
    if ($port !== 465 && stripos($ehlo, 'STARTTLS') !== false) {
      $cmd('STARTTLS', [220]);
      if (!stream_socket_enable_crypto($s, true, STREAM_CRYPTO_METHOD_TLS_CLIENT)) throw new RuntimeException('Could not start a secure connection to the mail server.');
      $cmd('EHLO ' . (gethostname() ?: 'localhost'), [250]);
    }
    if (cfg('SMTP_USER') !== '') {
      $cmd('AUTH PLAIN ' . base64_encode("\0" . cfg('SMTP_USER') . "\0" . cfg('SMTP_PASSWORD')), [235]);
    }
    $cmd("MAIL FROM:<$from>", [250]);
    $cmd("RCPT TO:<$to>", [250, 251]);
    $cmd('DATA', [354]);
    $data = implode("\r\n", $headers) . "\r\n\r\n" . $body;
    $data = preg_replace('/^\./m', '..', str_replace(["\r\n", "\n"], ["\n", "\r\n"], $data));
    $cmd($data . "\r\n.", [250]);
    fwrite($s, "QUIT\r\n");
  } finally {
    fclose($s);
  }
}
