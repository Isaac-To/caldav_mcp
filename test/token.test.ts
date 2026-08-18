import { describe, expect, it } from 'vitest';
import { createDevelopmentToken, createEncryptedToken, decodeConnectionToken, sameSecureOrigin } from '../src/token';

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

  it('requires HTTPS connection URLs', async () => {
    const token = createDevelopmentToken({ ...connection, serverUrl: 'http://caldav.example.test' });
    await expect(decodeConnectionToken(token)).rejects.toThrow('HTTPS URL required');
  });

  it('can disable legacy plaintext tokens', async () => {
    await expect(decodeConnectionToken(createDevelopmentToken(connection), undefined, false)).rejects.toThrow('Legacy connection tokens');
  });

  it('supports URL-safe base64 payloads', async () => {
    const value = { ...connection, username: 'user+tag@example.test' };
    await expect(decodeConnectionToken(createDevelopmentToken(value))).resolves.toEqual(value);
  });

  it('rejects invalid AES key lengths', async () => {
    await expect(createEncryptedToken(connection, 'AAAA')).rejects.toThrow('valid AES key');
  });

  it('rejects invalid AES key lengths when importing a decryption key', async () => {
    const token = await createEncryptedToken(connection, 'AAAAAAAAAAAAAAAAAAAAAA');
    await expect(decodeConnectionToken(token, 'AAAA')).rejects.toThrow('valid AES key');
  });

  it('matches only the configured secure origin', () => {
    expect(sameSecureOrigin('https://caldav.example.test/events/1.ics', connection.serverUrl)).toBe(true);
    expect(sameSecureOrigin('https://other.example.test/events/1.ics', connection.serverUrl)).toBe(false);
    expect(sameSecureOrigin('http://caldav.example.test/events/1.ics', connection.serverUrl)).toBe(false);
  });
});