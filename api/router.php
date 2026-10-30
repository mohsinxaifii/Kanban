<?php
// For PHP's built-in server only (local development and the test suite):
//   php -S localhost:3000 -t dist api/router.php
// On cPanel the .htaccess file does this job.
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
if (preg_match('#^/api(/|$)#', $path)) { require __DIR__ . '/index.php'; return true; }
return false;
