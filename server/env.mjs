// Nạp .env.local cho prototype Node thuần, không cần cài thêm dotenv.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const text = readFileSync(join(root, '.env.local'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const clean = line.trim();
    if (!clean || clean.startsWith('#')) continue;
    const at = clean.indexOf('=');
    if (at < 1) continue;
    const key = clean.slice(0, at).trim();
    let value = clean.slice(at + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] == null) process.env[key] = value;
  }
} catch { /* .env.local không bắt buộc khi chưa dùng tích hợp ngoài */ }
