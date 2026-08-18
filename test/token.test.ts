import { describe, expect, it } from 'vitest';
import { createDevelopmentToken, createEncryptedToken, decodeConnectionToken } from '../src/token';

const connection = { serverUrl: 'https://caldav.example.test', username: 'user', password: 'app-password', expiresAt: Math.floor(Date.now() / 1000) + 3600 };

describe('connection tokens', () => {
  it('round-trips development tokens', async () => {
    await expect(decodeConnectionToken(createDevelopmentToken(connection))).resolves.toEqual(connection);
  });

  it('rejects expired tokens', async () => {
    const token = createDevelopmentToken({ ...connection, expiresAt: 1 });
    await expect(decodeConnectionToken(token)).rejects.toThrow('expired');
  });

  it('rejects malformed tokens', async () => {
    await expect(decodeConnectionToken('not-a-token')).rejects.toThrow();
  });

  it('round-trips encrypted tokens', async () => {
    const secret = 'AAAAAAAAAAAAAAAAAAAAAA';
    const token = await createEncryptedToken(connection, secret);
    expect(token.startsWith('v1.')).toBe(true);
    await expect(decodeConnectionToken(token, secret)).resolves.toEqual(connection);
  });

  it('requires a key for encrypted tokens and rejects the wrong key', async () => {
    const token = await createEncryptedToken(connection, 'AAAAAAAAAAAAAAAAAAAAAA');
    await expect(decodeConnectionToken(token)).rejects.toThrow('CONNECTION_TOKEN_KEY');
    await expect(decodeConnectionToken(token, 'BBBBBBBBBBBBBBBBBBBBBB')).rejects.toThrow();
  });

  it('rejects invalid connection data', async () => {
    const token = createDevelopmentToken({ ...connection, serverUrl: 'not-a-url' });
    await expect(decodeConnectionToken(token)).rejects.toThrow();
  });

  it('supports URL-safe base64 payloads', async () => {
    const value = { ...connection, username: 'user+tag@example.test' };
    await expect(decodeConnectionToken(createDevelopmentToken(value))).resolves.toEqual(value);
  });
});