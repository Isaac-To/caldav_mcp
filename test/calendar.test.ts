import { describe, expect, it, vi } from 'vitest';
import { calendarFor, calendarsFor, createICalendar, objectResult, simpleCalendar, simpleEvent, simpleFreeBusy, updateICalendar } from '../src/calendar';

const baseEvent = { summary: 'Planning', start: '2026-08-20T10:00:00Z', end: '2026-08-20T11:00:00Z' };

describe('iCalendar helpers', () => {
  it('creates a valid event with escaped and optional fields', () => {
    const ics = createICalendar({
      ...baseEvent,
      uid: 'fixed@example.test',
      description: 'Line one\nLine two',
      location: 'Room 1, East',
      status: 'confirmed',
      attendees: ['mailto:a@example.test'],
      recurrenceRule: 'FREQ=WEEKLY;COUNT=2',
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('UID:fixed@example.test');
    expect(ics).toContain('SUMMARY:Planning');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
    expect(ics).toContain('LOCATION:Room 1\\, East');
    expect(ics).toContain('STATUS:CONFIRMED');
    expect(ics).toContain('ATTENDEE:mailto:a@example.test');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;COUNT=2');
  });

  it('creates a generated UID when one is omitted', () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('generated');
    expect(createICalendar(baseEvent)).toContain('UID:generated@caldav-mcp-forwarder');
    vi.restoreAllMocks();
  });

  it('rejects invalid dates', () => {
    expect(() => createICalendar({ ...baseEvent, start: 'not-a-date' })).toThrow('Invalid date');
  });

  it('updates an existing event while preserving its UID', () => {
    const original = createICalendar({ ...baseEvent, uid: 'fixed@example.test' });
    const updated = updateICalendar(original, { summary: 'New', location: 'Room 2', start: '2026-08-20T12:00:00Z', end: '2026-08-20T13:00:00Z', status: 'tentative', recurrenceRule: 'FREQ=DAILY' });
    expect(updated).toContain('UID:fixed@example.test');
    expect(updated).toContain('SUMMARY:New');
    expect(updated).toContain('LOCATION:Room 2');
    expect(updated).toContain('DTSTART:20260820T120000Z');
    expect(updated).toContain('STATUS:TENTATIVE');
    expect(updated).toContain('RRULE:FREQ=DAILY');
  });

  it('preserves fields when updates are omitted', () => {
    const original = createICalendar({ ...baseEvent, uid: 'fixed@example.test', description: 'Keep me' });
    expect(updateICalendar(original, {})).toContain('DESCRIPTION:Keep me');
  });

  it('rejects calendars without a VEVENT or UID', () => {
    expect(() => updateICalendar('BEGIN:VCALENDAR\r\nEND:VCALENDAR', {})).toThrow('VEVENT');
    expect(() => updateICalendar('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:No UID\r\nEND:VEVENT\r\nEND:VCALENDAR', {})).toThrow('UID');
  });
});

describe('calendar selection', () => {
  it('selects requested, configured, or first calendar', async () => {
    const calendars = [{ url: 'https://example.test/one/' }, { url: 'https://example.test/two/' }] as never[];
    const client = { fetchCalendars: vi.fn().mockResolvedValue(calendars) } as never;
    await expect(calendarFor(client, calendars[1].url)).resolves.toBe(calendars[1]);
    await expect(calendarFor(client, undefined, calendars[1].url)).resolves.toBe(calendars[1]);
    await expect(calendarFor(client)).resolves.toBe(calendars[0]);
  });

  it('rejects an unavailable calendar', async () => {
    const client = { fetchCalendars: vi.fn().mockResolvedValue([{ url: 'https://example.test/one/' }]) } as never;
    await expect(calendarFor(client, 'https://example.test/missing/')).rejects.toThrow('Calendar not found');
  });

  it('returns all calendars when no calendar is selected', async () => {
    const calendars = [{ url: 'https://example.test/one/' }, { url: 'https://example.test/two/' }] as never[];
    const client = { fetchCalendars: vi.fn().mockResolvedValue(calendars) } as never;
    await expect(calendarsFor(client)).resolves.toEqual(calendars);
    await expect(calendarsFor(client, calendars[1].url)).resolves.toEqual([calendars[1]]);
  });

  it('rejects an unavailable selected calendar', async () => {
    const client = { fetchCalendars: vi.fn().mockResolvedValue([{ url: 'https://example.test/one/' }]) } as never;
    await expect(calendarsFor(client, 'https://example.test/missing/')).rejects.toThrow('Calendar not found');
  });

  it('formats a calendar object result', () => {
    expect(objectResult({ url: 'https://example.test/event.ics', data: 'DATA' })).toEqual({ content: [{ type: 'text', text: JSON.stringify({ url: 'https://example.test/event.ics', data: 'DATA' }) }] });
  });

  it('simplifies calendar, event, and free/busy responses', () => {
    expect(simpleCalendar({ url: 'https://example.test/work/', displayName: 'Work', description: 'Work calendar', timezone: 'UTC', calendarColor: '#fff' })).toEqual({ url: 'https://example.test/work/', displayName: 'Work', description: 'Work calendar', timezone: 'UTC', color: '#fff' });
    expect(simpleCalendar({ url: 'https://example.test/personal/', displayName: { value: 'Personal' } })).toEqual({ url: 'https://example.test/personal/', displayName: undefined, description: undefined, timezone: undefined, color: undefined });
    expect(simpleEvent({ url: 'https://example.test/event.ics', etag: 'abc', data: 'DATA' })).toEqual({ url: 'https://example.test/event.ics', etag: 'abc', data: 'DATA' });
    expect(simpleEvent({ url: 'https://example.test/empty.ics' })).toEqual({ url: 'https://example.test/empty.ics', etag: undefined, data: '' });
    expect(simpleFreeBusy({ raw: 'FREEBUSY' })).toEqual({ data: 'FREEBUSY' });
    expect(simpleFreeBusy({})).toEqual({ data: '' });
  });
});