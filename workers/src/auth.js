// auth.js — JWT + Password hashing using Web Crypto API (edge-compatible)

// ─── JWT Helpers ─────────────────────────────────────────────────────────────

function base64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

async function getHmacKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign', 'verify']
  );
}

/**
 * Creates a signed HS256 JWT.
 * @param {Object} payload
 * @param {string} secret
 * @param {number} expiresInSeconds - default 8 hours
 */
export async function createToken(payload, secret, expiresInSeconds = 28800) {
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const claims = { ...payload, iat: now, exp: now + expiresInSeconds };
  const body = base64urlEncode(JSON.stringify(claims));
  const signingInput = `${header}.${body}`;

  const key = await getHmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
  const sigB64 = base64urlEncode(String.fromCharCode(...new Uint8Array(sig)));

  return `${signingInput}.${sigB64}`;
}

/**
 * Verifies a JWT and returns its payload. Throws on invalid/expired token.
 */
export async function verifyToken(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid token format');

  const [header, body, sig] = parts;
  const signingInput = `${header}.${body}`;

  const key = await getHmacKey(secret);
  const sigBytes = Uint8Array.from(base64urlDecode(sig), c => c.charCodeAt(0));
  const valid = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(signingInput));

  if (!valid) throw new Error('Invalid token signature');

  const payload = JSON.parse(base64urlDecode(body));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error('Token expired');
  }
  return payload;
}

// ─── Password Hashing (PBKDF2 / SHA-256) ─────────────────────────────────────

/**
 * Hashes a password using PBKDF2 with a random salt.
 * Output format: base64(salt):base64(hash)
 */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, 256
  );
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...new Uint8Array(bits)));
  return `${saltB64}:${hashB64}`;
}

/**
 * Verifies a password against a stored hash.
 */
export async function verifyPassword(password, storedHash) {
  try {
    const [saltB64, hashB64] = storedHash.split(':');
    if (!saltB64 || !hashB64) return false;
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial, 256
    );
    const computed = btoa(String.fromCharCode(...new Uint8Array(bits)));
    return computed === hashB64;
  } catch {
    return false;
  }
}

// ─── Auth Middleware ──────────────────────────────────────────────────────────

/**
 * Extracts and verifies the Bearer token from an incoming request.
 * Returns { user, error }.
 */
export async function authMiddleware(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return { user: null, error: 'Missing Authorization header' };
  }
  const token = authHeader.slice(7);
  try {
    const user = await verifyToken(token, env.JWT_SECRET);
    return { user, error: null };
  } catch (err) {
    return { user: null, error: err.message };
  }
}
