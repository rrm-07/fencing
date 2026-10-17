// Organiser keys and membership-number encryption (Web Crypto, no libraries).
//
// Names are public, but membership / student numbers are encrypted on the
// member's phone with the organiser's RSA public key, so only the organiser
// can read them. The organiser's private key is stored on the server
// encrypted with a key derived from their passphrase (PBKDF2), so it can be
// unlocked on any device. The same passphrase also derives the organiser's
// admin secret, which the server's rules check for organiser actions.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();
const ITERATIONS = 210_000;

const b64 = (buf) => {
  let s = '';
  for (const byte of new Uint8Array(buf)) s += String.fromCharCode(byte);
  return btoa(s);
};
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

async function derive(passphrase, salt) {
  const base = await subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
  const params = (info) => ({
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations: ITERATIONS,
    salt: new Uint8Array([...salt, ...enc.encode(info)]),
  });
  const secret = hex(await subtle.deriveBits(params('admin'), base, 256));
  const aes = await subtle.deriveKey(params('key'), base, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  return { secret, aes };
}

/** First-time setup: a key pair, the private key wrapped with the passphrase, and the admin secret. */
export async function createOrganiserKeys(passphrase) {
  const pair = await subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['encrypt', 'decrypt'],
  );
  const salt = random(16);
  const iv = random(12);
  const { secret, aes } = await derive(passphrase, salt);
  const pkcs8 = await subtle.exportKey('pkcs8', pair.privateKey);
  return {
    publicKey: b64(await subtle.exportKey('spki', pair.publicKey)),
    privateKey: {
      v: 1,
      salt: b64(salt),
      iv: b64(iv),
      data: b64(await subtle.encrypt({ name: 'AES-GCM', iv }, aes, pkcs8)),
    },
    secret,
  };
}

/** Unlock with the passphrase. Throws if it's wrong. Returns { secret, privateKey }. */
export async function unlockOrganiser(passphrase, wrapped) {
  const { secret, aes } = await derive(passphrase, unb64(wrapped.salt));
  let pkcs8;
  try {
    pkcs8 = await subtle.decrypt({ name: 'AES-GCM', iv: unb64(wrapped.iv) }, aes, unb64(wrapped.data));
  } catch {
    throw new Error('Wrong passphrase');
  }
  const privateKey = await subtle.importKey('pkcs8', pkcs8, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
  return { secret, privateKey };
}

export async function encryptFor(publicKeyB64, text) {
  const key = await subtle.importKey('spki', unb64(publicKeyB64), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, [
    'encrypt',
  ]);
  return b64(await subtle.encrypt({ name: 'RSA-OAEP' }, key, enc.encode(text)));
}

export async function decryptWith(privateKey, data) {
  try {
    return dec.decode(await subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, unb64(data)));
  } catch {
    return '?';
  }
}

/** Random key proving "I made this booking", kept on the member's phone. */
export function randomKey() {
  return hex(random(16));
}
