import jwt from 'jsonwebtoken';
import fs from 'fs';

function resolveKey(value?: string): string {
  if (!value) throw new Error('JWT key not provided');
  // If it looks like PEM, return as-is
  if (value.includes('BEGIN') && value.includes('KEY')) return value;
  // If it's a path to a file, read it
  if (fs.existsSync(value)) {
    return fs.readFileSync(value, 'utf8');
  }
  // If looks like a filesystem path but does not exist, fail loudly
  if (value.startsWith('/') || value.includes('\\') || value.includes('/')) {
    throw new Error(`JWT key file not found at path: ${value}`);
  }
  // Otherwise, assume the env contains the PEM inline
  return value;
}

export function signJwt(payload: object, options?: jwt.SignOptions) {
  const privateKey = resolveKey(process.env.JWT_PRIVATE_KEY);
  const expiresIn = (process.env.JWT_EXPIRES_IN as any) ?? '15m';
  return jwt.sign(payload, privateKey, { algorithm: 'RS256', expiresIn, ...(options || {}) });
}

export function verifyJwt(token: string) {
  const publicKey = resolveKey(process.env.JWT_PUBLIC_KEY);
  return jwt.verify(token, publicKey, { algorithms: ['RS256'] });
}
