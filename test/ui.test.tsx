import { describe, expect, it } from 'vitest';
import { homePage } from '../src/ui';

describe('setup page', () => {
  it('renders the connection workflow and security headers', async () => {
    const response = homePage('https://example.test');
    const html = await response.text();
    expect(html).toContain('Test connection');
    expect(html).toContain('Download configuration');
    expect(html).toContain('Start over');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'unsafe-inline'");
    expect(response.headers.get('cache-control')).toBe('no-store');
  });
});