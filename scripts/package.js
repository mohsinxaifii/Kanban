// Builds release/team-studio.zip: the whole site, ready to upload to cPanel and extract
// into the subdomain's folder. Run: npm run package
// Contents: the built front end (dist/) at the top level, and the PHP app in api/.
// api/config.php is never included, so uploading a new version keeps your settings.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const files = [];
const walk = (dir, prefix) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const name = prefix + e.name;
    if (e.isDirectory()) walk(full, `${name}/`);
    else files.push([name, full]);
  }
};
if (!fs.existsSync('dist/index.html')) { console.error('Run "npm run build" first.'); process.exit(1); }
walk('dist', '');
walk('api', 'api/');
const skip = new Set(['api/config.php', 'api/router.php']);
const entries = files.filter(([n]) => !skip.has(n));

// Minimal ZIP writer (deflate), so no zip tool is needed.
const local = [];
const central = [];
let offset = 0;
const dosTime = (() => { const d = new Date(); return [((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)), (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate())]; })();
for (const [name, full] of entries) {
  const data = fs.readFileSync(full);
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const crc = zlib.crc32(data);
  const nameBuf = Buffer.from(name, 'utf8');
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
  h.writeUInt16LE(dosTime[0], 10); h.writeUInt16LE(dosTime[1], 12); h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
  local.push(h, nameBuf, comp);
  const c = Buffer.alloc(46);
  c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x031e, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
  c.writeUInt16LE(dosTime[0], 12); c.writeUInt16LE(dosTime[1], 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20);
  c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nameBuf.length, 28); c.writeUInt32LE((0o100644 << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
  central.push(c, nameBuf);
  offset += 30 + nameBuf.length + comp.length;
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
fs.mkdirSync('release', { recursive: true });
fs.writeFileSync('release/team-studio.zip', Buffer.concat([...local, cd, end]));
console.log(`release/team-studio.zip: ${entries.length} files`);
