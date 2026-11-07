// Šifrování dat heslem (AES-256-GCM, klíč z hesla přes PBKDF2). Heslo se bere z proměnné SITE_PASSWORD.
//   node scripts/crypt.mjs encrypt                  public/data/data.json -> public/data/data.enc.json (data.json se smaže)
//   node scripts/crypt.mjs decrypt <vstup> <výstup> opačný směr (workflow s tím načte předchozí data z webu)
// Formát souboru: {"v":1,"iter":200000,"salt":"base64","iv":"base64","ct":"base64"}  (ct = šifrovaný text + GCM tag)
// Stejný postup dešifruje prohlížeč (public/js/app.js) přes WebCrypto.
import { webcrypto as crypto } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLAIN = join(ROOT, 'public', 'data', 'data.json');
const ENC = join(ROOT, 'public', 'data', 'data.enc.json');
const ITER = 200000;
const b64 = (u8) => Buffer.from(u8).toString('base64');
const unb64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

async function key(password, salt, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(password, salt, ITER), new TextEncoder().encode(text));
  return { v: 1, iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

export async function decrypt(obj, password) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(obj.iv) }, await key(password, unb64(obj.salt), obj.iter), unb64(obj.ct));
  return new TextDecoder().decode(pt);
}

async function main() {
  const [cmd, a, b] = process.argv.slice(2);
  const password = process.env.SITE_PASSWORD;
  if (!password) { console.error('Chybí proměnná SITE_PASSWORD.'); process.exit(1); }
  if (cmd === 'encrypt') {
    const enc = await encrypt(await readFile(PLAIN, 'utf8'), password);
    await writeFile(ENC, JSON.stringify(enc));
    await rm(PLAIN); // nešifrovaná data se nesmí nasadit
    console.log('Data zašifrována -> public/data/data.enc.json');
  } else if (cmd === 'decrypt') {
    const text = await decrypt(JSON.parse(await readFile(a, 'utf8')), password);
    await writeFile(b, text);
    console.log('Data dešifrována.');
  } else {
    console.error('Použití: encrypt | decrypt <vstup> <výstup>');
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error('Chyba:', e.message); process.exit(1); });
