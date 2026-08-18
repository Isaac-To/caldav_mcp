import { describe, expect, it } from 'vitest';
import { createICalendar, updateICalendar } from '../src/calendar';

describe('iCalendar helpers', () => {
  it('creates a valid event with escaped fields', () => {
    const ics = createICalendar({
      summary: 'Planning, phase 1',
      start: '2026-08-20T10:00:00Z',
      end: '2026-08-20T11:00:00Z',
      description: 'Line one\nLine two',
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Planning\\, phase 1');
    expect(ics).toContain('DESCRIPTION:Line one\\nLine two');
    expect(ics).toContain('DTSTART:20260820T100000Z');
  });

  it('updates an existing event while preserving its UID', () => {
    const original = createICalendar({ summary: 'Old', start: '2026-08-20T10:00:00Z', end: '2026-08-20T11:00:00Z', uid: 'fixed@example.test' });
    const updated = updateICalendar(original, { summary: 'New', location: 'Room 2' });
    expect(updated).toContain('UID:fixed@example.test');
    expect(updated).toContain('SUMMARY:New');
    expect(updated).toContain('LOCATION:Room 2');
  });
});