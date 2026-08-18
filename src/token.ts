import { z } from 'zod';

export const connectionSchema = z.object({
  serverUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
  calendarUrl: z.string().url().optional(),
  expiresAt: z.number().int().positive().optional(),
});

export type Connection = z.infer<typeof connectionSchema>;

const decode = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(normalized), (character) => character.charCodeAt(0));
};

const encode = (value: Uint8Array): string => {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

export async function importTokenKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', decode(secret).buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
}

export async function decodeConnectionToken(token: string, secret?: string): Promise<Connection> {
  let value: unknown;
  if (token.startsWith('v1.')) {
    if (!secret) throw new Error('Encrypted connection tokens require CONNECTION_TOKEN_KEY.');
    const [, iv, ciphertext] = token.split('.');
    const key = await importTokenKey(secret);
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: decode(iv).buffer as ArrayBuffer }, key, decode(ciphertext).buffer as ArrayBuffer);
    value = JSON.parse(new TextDecoder().decode(plaintext));
  } else {
    value = JSON.parse(new TextDecoder().decode(decode(token)));
  }
  const connection = connectionSchema.parse(value);
  if (connection.expiresAt && connection.expiresAt <= Math.floor(Date.now() / 1000)) {
    throw new Error('Connection token has expired.');
  }
  return connection;
}

export async function createEncryptedToken(connection: Connection, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', decode(secret).buffer as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(connection)));
  return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
}

export function createDevelopmentToken(connection: Connection): string {
  return encode(new TextEncoder().encode(JSON.stringify(connection)));
}