import ICAL from 'ical.js';
import { DAVCalendar, DAVCalendarObject, DAVClient } from 'tsdav';

export type EventInput = {
  uid?: string;
  summary: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  status?: string;
  attendees?: string[];
  recurrenceRule?: string;
};

function utc(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function createICalendar(input: EventInput): string {
  const uid = input.uid ?? `${crypto.randomUUID()}@caldav-mcp-forwarder`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//caldav-mcp-forwarder//EN', 'BEGIN:VEVENT',
    `UID:${escape(uid)}`, `DTSTAMP:${utc(new Date().toISOString())}`, `DTSTART:${utc(input.start)}`,
    `DTEND:${utc(input.end)}`, `SUMMARY:${escape(input.summary)}`,
  ];
  if (input.description) lines.push(`DESCRIPTION:${escape(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escape(input.location)}`);
  if (input.status) lines.push(`STATUS:${escape(input.status.toUpperCase())}`);
  for (const attendee of input.attendees ?? []) lines.push(`ATTENDEE:${escape(attendee)}`);
  if (input.recurrenceRule) lines.push(`RRULE:${escape(input.recurrenceRule)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

export function updateICalendar(data: string, input: Partial<EventInput>): string {
  const component = ICAL.Component.fromString(data);
  const eventComponent = component.getFirstSubcomponent('vevent');
  if (!eventComponent) throw new Error('Calendar object does not contain a VEVENT.');
  const set = (name: string, value: string | undefined) => {
    if (value === undefined) return;
    const property = eventComponent.getFirstProperty(name);
    if (property) property.setValue(value);
    else eventComponent.addPropertyWithValue(name, value);
  };
  set('summary', input.summary);
  set('description', input.description);
  set('location', input.location);
  set('status', input.status?.toUpperCase());
  if (input.start) set('dtstart', ICAL.Time.fromJSDate(new Date(input.start), true).toICALString());
  if (input.end) set('dtend', ICAL.Time.fromJSDate(new Date(input.end), true).toICALString());
  if (input.recurrenceRule) set('rrule', input.recurrenceRule);
  if (!eventComponent.getFirstPropertyValue('uid')) throw new Error('Calendar object does not contain a UID.');
  return component.toString();
}

export async function calendarFor(client: DAVClient, requested?: string, configured?: string): Promise<DAVCalendar> {
  const calendars = await client.fetchCalendars();
  const url = requested ?? configured;
  const calendar = calendars.find((item) => item.url === url) ?? (url ? undefined : calendars[0]);
  if (!calendar) throw new Error('Calendar not found. Call list_calendars or provide calendarUrl.');
  return calendar;
}

export function objectResult(object: DAVCalendarObject): { content: [{ type: 'text'; text: string }] } {
  return { content: [{ type: 'text', text: JSON.stringify(object) }] };
}