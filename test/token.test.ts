import { describe, expect, it } from 'vitest';
import { createDevelopmentToken, decodeConnectionToken } from '../src/token';

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
});