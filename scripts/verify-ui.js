// Browser walkthrough of the example workflow. Each person uses a separate browser
// context (separate cookies), against the built app and a fresh database.
// Run: npm run build && npm run verify:ui   (CHROME_PATH=/path/to/chrome if Playwright browsers are not installed)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4100 + Math.floor(Math.random() * 80);
const BASE = `http://localhost:${PORT}/`;
const DB = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dd-ui-')), 'ui.db');
const OUT = process.env.SHOTS_DIR || 'verify-output/screens';
fs.mkdirSync(OUT, { recursive: true });
const PW = 'demo-studio-2026';
let n = 0;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${ok ? '' : `  -> ${detail}`}`); };

const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
  env: { ...process.env, PORT: String(PORT), DATABASE_PATH: DB, DEMO_MODE: 'true' }, stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((r) => server.stdout.on('data', (d) => String(d).includes('studio on') && r()));

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
async function as(name) {
  const ctx = await browser.newContext({ viewport: { width: 1480, height: 920 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] page error: ${e.message}`));
  await page.goto(BASE);
  await page.fill('#email', `${name}@demo.designdimensions.test`);
  await page.fill('#pw', PW);
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar');
  // Every new person gets the welcome tour once. The first one is walked through; the rest skip it.
  await page.waitForSelector('.tour-card');
  if (!toured) {
    toured = true;
    await shot(page, 'tour-welcome');
    let steps = 0;
    while (await page.locator('.tour-card').count()) {
      if (steps === 2) await shot(page, 'tour-step');
      await page.locator('.tour-card .btn.primary').click();
      await page.waitForTimeout(200);
      steps += 1;
      if (steps > 15) break;
    }
    check('New people get a step-by-step welcome tour that can be finished', steps >= 6 && !(await page.locator('.tour').count()), `steps ${steps}`);
    await page.reload(); await page.waitForSelector('.sidebar'); await page.waitForTimeout(500);
    check('The tour does not reappear once finished', !(await page.locator('.tour').count()));
  } else {
    await page.getByRole('button', { name: 'Skip tour' }).click();
    await page.locator('.tour').waitFor({ state: 'detached' });
  }
  return page;
}
let toured = false;
const shot = async (page, label) => { await page.waitForTimeout(350); return page.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${label}.png` }); };
async function pick(page, buttonLabel, text) {
  await page.getByRole('button', { name: new RegExp(`^${buttonLabel}`) }).click();
  await page.locator('.picker-pop input').waitFor();
  await page.locator('.picker-pop input').fill(text);
  await page.keyboard.press('Enter');
}
const panelText = (page) => page.locator('.panel').innerText();
const waitPanel = (page, re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector('.panel')?.innerText || ''), re.source, { timeout: 8000 });

try {
  console.log('\n1. Kabir creates the task');
  const kabir = await as('kabir');
  await kabir.getByRole('button', { name: 'New task' }).click();
  await kabir.fill('input[aria-label="Task title"]', 'Product launch reel');
  await kabir.selectOption('#nt-project', { label: 'Halden Audio · Aurora headphones launch (sample)' });
  await kabir.fill('#nt-brief', '30s launch reel for the Aurora headphones. Hero product turn, end on the tagline.');
  // A typed name that matches nobody offers no account creation to non-admins.
  await kabir.getByRole('button', { name: /^Assigned to/ }).click();
  await kabir.locator('.picker-pop input').fill('Zoe Newperson');
  check('Typing an unknown name does not create a person (non-admin sees "ask an administrator")', await kabir.getByText('Ask an administrator to invite them').isVisible());
  await kabir.keyboard.press('Escape');
  await kabir.locator('.picker-pop').waitFor({ state: 'detached' });
  await pick(kabir, 'Assigned to', 'Roh');
  await pick(kabir, 'Final recipient', 'Nis');
  await pick(kabir, 'Step 1 approver', 'Aan');
  await shot(kabir, 'kabir-new-task');
  await kabir.getByRole('button', { name: 'Create task' }).click();
  await waitPanel(kabir, /Created by Kabir/);
  const t1 = await panelText(kabir);
  check('Panel shows "Created by Kabir" and next action Rohan', /Created by Kabir/.test(t1) && /Next action: Rohan/.test(t1));
  const taskUrl = kabir.url();
  const taskId = new URL(taskUrl.replace('#', '')).searchParams.get('task') || taskUrl.split('task=')[1];

  console.log('\n2. Rohan submits v1');
  const rohan = await as('rohan');
  await rohan.goto(`${BASE}#/my-work`);
  await rohan.getByText('Product launch reel').first().waitFor();
  await shot(rohan, 'rohan-my-work');
  await rohan.getByText('Product launch reel').first().click();
  await rohan.fill('#sb-link', 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view');
  check('Drive sharing warning is shown when submitting', await rohan.getByText('Drive sharing is separate from this app.').isVisible());
  await shot(rohan, 'rohan-submit');
  await rohan.getByRole('button', { name: 'Submit for review' }).click();
  await waitPanel(rohan, /Waiting for Aanya's approval/);
  const t2 = await panelText(rohan);
  check('Shows "Waiting for Aanya\'s approval" and Rohan is not the creator', /Waiting for Aanya's approval/.test(t2) && /Created by Kabir/.test(t2));

  console.log('\n   Rohan tries to bypass approval');
  await rohan.goto(`${BASE}#/board`);
  const card = rohan.locator('.card', { hasText: 'Product launch reel' });
  await card.dragTo(rohan.locator('section.column', { hasText: 'Ready to Deliver' }));
  await card.getByRole('button', { name: /Change status/ }).click();
  const deliveredItem = rohan.getByRole('menuitem', { name: /Delivered/ });
  check('Status menu disables Delivered and Ready to Deliver', await deliveredItem.isDisabled() && await rohan.getByRole('menuitem', { name: /Ready to Deliver/ }).isDisabled());
  await shot(rohan, 'rohan-locked-stages');
  await rohan.keyboard.press('Escape');
  await rohan.reload();
  await rohan.locator('section.column', { hasText: 'In Review' }).locator('.card', { hasText: 'Product launch reel' }).waitFor();
  check('After dragging and refreshing, the card is still In Review', true);

  console.log('\n3–4. Aanya requests changes; Rohan sees it live');
  const aanya = await as('aanya');
  await aanya.goto(`${BASE}#/approvals`);
  await aanya.getByText('Product launch reel').first().waitFor();
  await shot(aanya, 'aanya-approvals');
  await aanya.getByText('Product launch reel').first().click();
  await aanya.getByRole('button', { name: 'Request changes' }).click();
  await aanya.fill('#rv-fb', 'Open on the product turn and trim the end card by a second.');
  await shot(aanya, 'aanya-request-changes');
  await aanya.getByRole('button', { name: 'Send change request' }).click();
  await waitPanel(aanya, /Changes requested · Next action: Rohan/);
  await rohan.waitForFunction(() => /Changes requested · Next action: Rohan/.test(document.body.innerText), null, { timeout: 8000 });
  check('Rohan\'s open board updated live without refreshing', true);
  await rohan.goto(`${BASE}#/board?task=${taskId}`);
  await waitPanel(rohan, /Your turn: revise/);

  console.log('\n5. Rohan submits v2, Aanya approves v2');
  await rohan.fill('#sb-link', 'https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHgF/view');
  await rohan.fill('#sb-n', 'Opens on the product turn now.');
  await rohan.getByRole('button', { name: 'Submit for review' }).click();
  await waitPanel(rohan, /v2/);
  await aanya.goto(`${BASE}#/approvals?task=${taskId}`);
  await waitPanel(aanya, /Approve v2/);
  await shot(aanya, 'aanya-review-v2');
  await aanya.getByRole('button', { name: 'Approve v2' }).click();
  await waitPanel(aanya, /Deliver to Nisha/);
  const t5 = await panelText(aanya);
  check('v1 decision preserved and v2 approved', /Changes requested/.test(t5) && /Approved/.test(t5));

  console.log('\n6–7. Kabir delivers to Nisha');
  await kabir.goto(`${BASE}#/my-work?task=${taskId}`);
  await waitPanel(kabir, /Your turn: deliver to Nisha/);
  await shot(kabir, 'kabir-ready-to-deliver');
  check('Approval did not mark it Delivered', /Ready to Deliver/.test(await panelText(kabir)));
  await kabir.getByRole('button', { name: 'Record delivery to Nisha' }).click();
  await waitPanel(kabir, /Manual record/);
  await shot(kabir, 'kabir-delivered');
  await kabir.reload();
  await waitPanel(kabir, /Delivered to Nisha/);
  check('After refresh, the task is Delivered with a manual delivery record', /Manual record/.test(await panelText(kabir)));

  const nisha = await as('nisha');
  await nisha.goto(`${BASE}#/my-work`);
  await nisha.getByText('Product launch reel').first().click();
  await waitPanel(nisha, /delivered to you/);
  const tn = await panelText(nisha);
  check('Nisha sees the delivered v2 only (no drafts or comments)', /v2/.test(tn) && !/Versions and decisions/.test(tn) && !/Comments/.test(tn));
  await shot(nisha, 'nisha-deliverable');

  const meera = await as('meera');
  await meera.goto(`${BASE}#/board`);
  await meera.waitForSelector('.column');
  check('Meera (not involved) does not see the task', !(await meera.locator('.card', { hasText: 'Product launch reel' }).count()));
  await meera.goto(`${BASE}#/board?task=${taskId}`);
  await meera.waitForTimeout(500);
  check('Meera opening the task link gets "Task not found"', /Task not found/.test(await meera.locator('.panel').innerText()));

  const admin = await as('studio');
  await admin.goto(`${BASE}#/team`);
  await admin.getByText('Kabir Sethi').first().waitFor();
  await shot(admin, 'admin-team');
  await admin.getByText('Kabir Sethi').first().click();
  await shot(admin, 'admin-edit-person');
  await admin.keyboard.press('Escape');
  await admin.goto(`${BASE}#/planner`);
  await admin.waitForSelector('.planner');
  await shot(admin, 'admin-planner');
  await admin.goto(`${BASE}#/board`);
  await admin.waitForSelector('.card');
  await shot(admin, 'admin-board');

  // Saved folders: save a task from its panel into a new folder, add a link, see both.
  await admin.locator('.card').first().click();
  await admin.getByRole('button', { name: 'Save', exact: true }).click();
  await admin.getByLabel('New folder name').fill('Client refs');
  await admin.getByRole('button', { name: 'Add', exact: true }).click();
  await admin.getByRole('button', { name: 'Saved', exact: true }).waitFor();
  await admin.keyboard.press('Escape');
  await admin.goto(`${BASE}#/saved`);
  await admin.getByPlaceholder('Paste a link (https://…)').fill('https://example.com/brand-guide');
  await admin.getByPlaceholder('Name (optional)').fill('Brand guide');
  await admin.getByRole('button', { name: 'Save link' }).click();
  await admin.getByText('Brand guide').waitFor();
  check('A task and a link can be saved into a folder', (await admin.locator('.saved-row').count()) === 2);
  await shot(admin, 'saved-folders');
} catch (e) {
  check('Walkthrough completed without errors', false, e.message);
  for (const c of browser.contexts()) for (const pg of c.pages()) await pg.screenshot({ path: `${OUT}/zz-failure-${++n}.png` }).catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed. Screenshots in ${OUT}/`);
process.exit(failed ? 1 : 0);
