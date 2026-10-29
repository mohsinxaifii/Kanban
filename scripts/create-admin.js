// Creates (or resets) a real administrator account.
// Usage: npm run create-admin -- "Full Name" email@company.com
import readline from 'node:readline/promises';
import { one, run } from '../server/db.js';
import { roleDefaults } from '../server/permissions.js';
import { hashPasswordSync } from '../server/passwords.js';

const [name, email] = process.argv.slice(2);
if (!name || !email) {
  console.error('Usage: npm run create-admin -- "Full Name" email@company.com');
  process.exit(1);
}
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const pw = process.env.ADMIN_PASSWORD || (await rl.question('Password (min 10 characters): '));
rl.close();
if (pw.length < 10) { console.error('Password must be at least 10 characters.'); process.exit(1); }

const existing = one('SELECT id FROM users WHERE email = ?', email.toLowerCase());
const perms = JSON.stringify(roleDefaults('admin'));
if (existing) {
  run("UPDATE users SET name = ?, role = 'admin', permissions = ?, status = 'active', password_hash = ?, invite_token = NULL, is_demo = 0 WHERE id = ?", name, perms, hashPasswordSync(pw), existing.id);
  console.log(`Updated ${email} as an administrator.`);
} else {
  run(`INSERT INTO users (name, email, title, role, permissions, project_access, status, password_hash, is_demo, color)
    VALUES (?,?,?,'admin',?,'"all"','active',?,0,'#111827')`, name, email.toLowerCase(), 'Administrator', perms, hashPasswordSync(pw));
  console.log(`Created administrator ${email}.`);
}
