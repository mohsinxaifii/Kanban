<?php
// Fictional demo people and sample work. Everything here is flagged is_demo = 1 and uses
// the reserved .test email domain.

function demo_password(): string { return cfg('DEMO_PASSWORD', 'demo-studio-2026'); }

function seed_demo(): void {
  // Seed once per database; removing demo data later does not bring it back.
  if (setting('demo_seeded') !== null) return;
  tx(function () {
    if (setting('demo_seeded') !== null) return;
    set_setting('demo_seeded', now());
    $at = function (float $days, float $hours = 0): string {
      $t = microtime(true) + $days * 86400 + $hours * 3600;
      return gmdate('Y-m-d\TH:i:s', (int) $t) . sprintf('.%03dZ', (int) (($t - floor($t)) * 1000));
    };
    $date = fn (float $days) => substr($at($days), 0, 10);
    $pw = hash_password(demo_password());
    $user = function (string $name, string $title, string $role, string $color, array $opts = []) use ($pw, $at) {
      $perms = $opts['permissions'] ?? role_defaults($role);
      $email = strtolower(explode(' ', $name)[0]) . '@demo.designdimensions.test';
      return run("INSERT INTO users (name, email, title, role, permissions, project_access, status, password_hash, is_demo, color, created_at)
        VALUES (?,?,?,?,?,?,'active',?,1,?,?)", $name, $email, $title, $role, json_encode($perms), json_encode($opts['access'] ?? 'all'), $pw, $color, $at(-30))['id'];
    };
    $client = fn (string $name) => run('INSERT INTO clients (name, is_demo) VALUES (?,1)', $name)['id'];
    $project = fn (string $name, int $c) => run('INSERT INTO projects (name, client_id, is_demo) VALUES (?,?,1)', $name, $c)['id'];

    $halden = $client('Halden Audio');
    $saffron = $client('Saffron & Sage');
    $northpeak = $client('Northpeak Outdoors');
    $pAurora = $project('Aurora headphones launch', $halden);
    $pRetail = $project('Retail refresh', $halden);
    $pWinter = $project('Winter menu campaign', $saffron);
    $pTrail = $project('Trail Series', $northpeak);

    $aanya = $user('Aanya Shah', 'Creative Head', 'creative_head', '#7c5cff');
    $rohan = $user('Rohan Mehta', 'Video Editor', 'producer', '#0d74ce');
    $meera = $user('Meera Kapoor', 'Graphic Designer', 'producer', '#d6409f');
    // Kabir is explicitly authorised to approve (not a role default), so he can be a second approval step.
    $kabir = $user('Kabir Sethi', 'Account Manager', 'account_manager', '#12a594', ['permissions' => [...role_defaults('account_manager'), 'review.approve']]);
    // Nisha is a client-side recipient who can only reach the Halden Audio projects.
    $nisha = $user('Nisha Rao', 'Marketing Recipient', 'recipient', '#f76b15', ['access' => [$pAurora, $pRetail]]);
    $user('Studio Admin', 'Administrator', 'admin', '#4b5563');

    $order = 1;
    $task = function (array $t) use (&$order, $at) {
      $b = $t['blocked'] ?? null;
      $id = run('INSERT INTO tasks (title, project_id, brief, priority, stage, creator_id, assignee_id, delivery_owner_id, recipient_id, due_date,
        blocked, blocked_reason, blocked_resolver_id, blocked_by_id, blocked_at, sort_order, is_demo, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)', $t['title'], $t['project'], $t['brief'] ?? '', $t['priority'] ?? 'medium', $t['stage'], $t['creator'],
        $t['assignee'] ?? null, $t['delivery'] ?? null, $t['recipient'] ?? null, $t['due'] ?? null, $b ? 1 : 0, $b['reason'] ?? null, $b['resolver'] ?? null,
        $b['by'] ?? null, $b ? $at(-1) : null, $order++, $at($t['createdDays'] ?? -10), $at($t['updatedDays'] ?? -1))['id'];
      foreach ($t['steps'] ?? [] as $i => $s) run('INSERT INTO approval_steps (task_id, position, label, approver_id) VALUES (?,?,?,?)', $id, $i, $s[0], $s[1]);
      run('INSERT INTO activity (task_id, actor_id, kind, message, created_at) VALUES (?,?,?,?,?)', $id, $t['creator'], 'created', 'Created the task', $at($t['createdDays'] ?? -10));
      return $id;
    };
    $sub = fn (int $taskId, array $s) => run('INSERT INTO submissions (task_id, version, link, link_kind, drive_id, note, submitted_by, submitted_at, review_deadline, status, current_step)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)', $taskId, $s['version'], "https://drive.google.com/file/d/{$s['driveId']}/view", 'file', $s['driveId'], $s['note'] ?? '', $s['by'],
      $at($s['days']), $s['deadline'] ?? null, $s['status'], $s['step'] ?? 0)['id'];
    $review = fn ($subId, $pos, $label, $by, $decision, $feedback, $days) =>
      run('INSERT INTO reviews (submission_id, step_position, step_label, reviewer_id, decision, feedback, created_at) VALUES (?,?,?,?,?,?,?)', $subId, $pos, $label, $by, $decision, $feedback, $at($days));
    $log = fn ($taskId, $actor, $kind, $msg, $days) => run('INSERT INTO activity (task_id, actor_id, kind, message, created_at) VALUES (?,?,?,?,?)', $taskId, $actor, $kind, $msg, $at($days));
    $comment = fn ($taskId, $by, $body, $days) => run('INSERT INTO comments (task_id, author_id, body, created_at) VALUES (?,?,?,?)', $taskId, $by, $body, $at($days));

    // In review, second version, waiting for Aanya.
    $t1 = $task(['title' => 'Aurora teaser cut-downs (15s and 6s)', 'project' => $pAurora, 'priority' => 'high', 'stage' => 'in_review', 'creator' => $kabir, 'assignee' => $rohan,
      'delivery' => $kabir, 'recipient' => $nisha, 'due' => $date(2), 'steps' => [['Creative Head', $aanya]], 'createdDays' => -9,
      'brief' => "Cut the 45s hero film into a 15s and a 6s version for paid social.\n\n- Open on the product turn, not the logo.\n- End card: \"Aurora. Hear the room.\"\n- Deliver 9:16 and 1:1."]);
    $s1a = $sub($t1, ['version' => 'v1', 'driveId' => 'DEMO-aurora-teaser-v1', 'by' => $rohan, 'days' => -4, 'status' => 'changes_requested', 'note' => 'First pass on both lengths.']);
    $review($s1a, 0, 'Creative Head', $aanya, 'changes_requested', 'The 6s loses the product turn. Start on the close-up and drop the room wide.', -3.5);
    $sub($t1, ['version' => 'v2', 'driveId' => 'DEMO-aurora-teaser-v2', 'by' => $rohan, 'days' => -0.8, 'status' => 'in_review', 'deadline' => $date(1), 'note' => '6s now opens on the close-up. Music re-timed.']);
    $log($t1, $rohan, 'submitted', 'Submitted v1 for review. Waiting for Aanya Shah (Creative Head)', -4);
    $log($t1, $aanya, 'changes', 'Requested changes on v1 (Creative Head)', -3.5);
    $log($t1, $rohan, 'submitted', 'Submitted v2 for review. Waiting for Aanya Shah (Creative Head)', -0.8);

    // Two-step approval, now at Kabir's step.
    $t2 = $task(['title' => 'Trail Series ep. 3 rough cut', 'project' => $pTrail, 'priority' => 'medium', 'stage' => 'in_review', 'creator' => $aanya, 'assignee' => $rohan, 'delivery' => $kabir,
      'due' => $date(5), 'steps' => [['Creative Head', $aanya], ['Account Manager', $kabir]], 'createdDays' => -12,
      'brief' => 'Ten-minute rough cut of episode 3 (the ridge crossing). Hold on the silence before the summit. Temp music is fine.']);
    $s2 = $sub($t2, ['version' => 'v1', 'driveId' => 'DEMO-trail-ep3-v1', 'by' => $rohan, 'days' => -2, 'status' => 'in_review', 'step' => 1, 'deadline' => $date(0)]);
    $review($s2, 0, 'Creative Head', $aanya, 'approved', 'Pacing works. Good to show the client.', -1.2);
    $log($t2, $aanya, 'approved', 'Approved v1 (Creative Head). Waiting for Kabir Sethi (Account Manager)', -1.2);

    // Blocked in progress.
    $t3 = $task(['title' => 'Winter menu posters, A2 set of 4', 'project' => $pWinter, 'priority' => 'urgent', 'stage' => 'in_progress', 'creator' => $kabir, 'assignee' => $meera, 'delivery' => $kabir,
      'due' => $date(1), 'steps' => [['Creative Head', $aanya]], 'blocked' => ['reason' => 'Waiting on final menu prices from the client.', 'resolver' => $kabir, 'by' => $meera], 'createdDays' => -6,
      'brief' => 'Four A2 posters for the winter menu. Use the new illustration set. Prices must match the final menu.']);
    $log($t3, $meera, 'blocked', 'Flagged as blocked, needs Kabir Sethi: Waiting on final menu prices from the client.', -1);

    // Changes requested.
    $t4 = $task(['title' => 'Retailer banner set', 'project' => $pRetail, 'priority' => 'medium', 'stage' => 'changes_requested', 'creator' => $kabir, 'assignee' => $meera, 'delivery' => $kabir,
      'recipient' => $nisha, 'due' => $date(3), 'steps' => [['Creative Head', $aanya]], 'createdDays' => -8, 'brief' => 'Web banners for three retail partners: 300x250, 728x90, 160x600.']);
    $s4 = $sub($t4, ['version' => 'v1', 'driveId' => 'DEMO-retail-banners-v1', 'by' => $meera, 'days' => -2, 'status' => 'changes_requested']);
    $review($s4, 0, 'Creative Head', $aanya, 'changes_requested', 'Logo lockup is too small on the 728x90. Increase safe area.', -1);
    $log($t4, $aanya, 'changes', 'Requested changes on v1 (Creative Head)', -1);

    // Ready to deliver.
    $t5 = $task(['title' => 'Aurora spec sheet', 'project' => $pAurora, 'priority' => 'high', 'stage' => 'ready_to_deliver', 'creator' => $kabir, 'assignee' => $meera, 'delivery' => $kabir,
      'recipient' => $nisha, 'due' => $date(0), 'steps' => [['Creative Head', $aanya]], 'createdDays' => -11, 'brief' => 'Two-page spec sheet PDF for retail buyers.']);
    $s5 = $sub($t5, ['version' => 'v1', 'driveId' => 'DEMO-aurora-spec-v1', 'by' => $meera, 'days' => -3, 'status' => 'approved']);
    $review($s5, 0, 'Creative Head', $aanya, 'approved', '', -0.5);
    $log($t5, $aanya, 'approved', 'Approved v1 (Creative Head). All approvals complete; ready to deliver, handoff by Kabir Sethi', -0.5);

    // Delivered.
    $t6 = $task(['title' => 'Aurora key visual', 'project' => $pAurora, 'priority' => 'high', 'stage' => 'delivered', 'creator' => $aanya, 'assignee' => $meera, 'delivery' => $kabir,
      'recipient' => $nisha, 'due' => $date(-3), 'steps' => [['Creative Head', $aanya]], 'createdDays' => -20, 'brief' => 'Hero key visual for launch. Master plus social crops.']);
    $s6 = $sub($t6, ['version' => 'v2', 'driveId' => 'DEMO-aurora-kv-v2', 'by' => $meera, 'days' => -6, 'status' => 'approved']);
    $review($s6, 0, 'Creative Head', $aanya, 'approved', 'Lovely.', -5);
    run('INSERT INTO deliveries (task_id, submission_id, recipient_id, sender_id, method, note, verified, delivered_at) VALUES (?,?,?,?,?,?,0,?)', $t6, $s6, $nisha, $kabir, 'Google Drive share', 'Shared the master folder.', $at(-4));
    $log($t6, $kabir, 'delivered', 'Recorded manual delivery of v2 to Nisha Rao via Google Drive share', -4);

    // Planned / in progress / backlog.
    $t7 = $task(['title' => 'Chef portrait reel', 'project' => $pWinter, 'priority' => 'medium', 'stage' => 'planned', 'creator' => $aanya, 'assignee' => $rohan, 'delivery' => $kabir,
      'due' => $date(9), 'steps' => [['Creative Head', $aanya]], 'createdDays' => -3, 'brief' => '30s portrait of the head chef for Instagram. Shoot is booked.']);
    $comment($t7, $rohan, 'Can we get the shoot selects by Monday?', -1);
    $task(['title' => 'Trail Series thumbnails, eps 1 to 6', 'project' => $pTrail, 'priority' => 'low', 'stage' => 'in_progress', 'creator' => $kabir, 'assignee' => $meera, 'delivery' => $kabir,
      'due' => $date(6), 'steps' => [['Creative Head', $aanya]], 'createdDays' => -4, 'brief' => 'YouTube thumbnails, consistent type system across the series.']);
    $task(['title' => 'Store window graphics', 'project' => $pRetail, 'priority' => 'medium', 'stage' => 'backlog', 'creator' => $kabir, 'delivery' => $kabir, 'due' => $date(18), 'createdDays' => -2,
      'brief' => 'Window vinyls for the flagship store. Measurements to follow.']);
    $task(['title' => 'Trail Series ep. 4 assembly', 'project' => $pTrail, 'priority' => 'medium', 'stage' => 'planned', 'creator' => $aanya, 'assignee' => $rohan, 'delivery' => $kabir,
      'due' => $date(13), 'steps' => [['Creative Head', $aanya]], 'createdDays' => -1]);
  });
}
