<?php
// Copy this file to config.php (same folder) and fill it in. config.php is never served
// to browsers and is not overwritten when you upload a new version of the app.
return [
  // The address people use. Used in invite and password-reset links.
  'PUBLIC_URL' => 'https://team.designdimensions.in',

  // The database file. Keep it OUTSIDE public_html so it can never be downloaded.
  // On this hosting account the home folder is /home1/a178436f.
  'DATABASE_PATH' => '/home1/a178436f/studio-data/studio.db',

  // Keep the same value the old Render site used ('true' or 'false'). 'false' turns the
  // fictional demo accounts off.
  'DEMO_MODE' => 'false',

  // Emails (invitations, password resets). An address on your own domain, created in
  // cPanel → Email Accounts. With only EMAIL_FROM set, mail goes out through the server.
  'EMAIL_FROM' => 'Design Dimensions Studio <studio@designdimensions.in>',
  // Optional: send through that mailbox over SMTP instead (often better delivery).
  'SMTP_HOST' => '',          // e.g. mail.designdimensions.in
  'SMTP_PORT' => '465',
  'SMTP_USER' => '',          // the full email address
  'SMTP_PASSWORD' => '',

  // Optional: "Continue with Google". Redirect URI to register in Google Cloud:
  // https://team.designdimensions.in/api/auth/google/callback
  'GOOGLE_CLIENT_ID' => '',
  'GOOGLE_CLIENT_SECRET' => '',
  // Optional: checks whether submitted Drive links are shared publicly.
  'GOOGLE_DRIVE_API_KEY' => '',

  // One-time wipe of ALL data, then a setup screen for the first administrator.
  // Leave empty unless you really want to start over.
  'RESET_WORKSPACE' => '',
];
