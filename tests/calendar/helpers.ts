import { Page, Locator, expect } from '@playwright/test';
import {
  loginAsAdmin,
  createCalendarEvent,
  deleteCalendarEvent,
  cleanupEventsOnDate,
} from '../fixtures/helpers';
export { getResolvedTestTariffs, ResolvedTestTariffs } from '../fixtures/helpers';

export function futureDate(hoursAhead: number, hour = 10): string {
  // Событие создаём ~на год вперёд, чтобы не пересекаться с реальным расписанием студии
  const d = new Date();
  d.setDate(d.getDate() + 365 + Math.ceil(hoursAhead / 24));
  d.setHours(hour, 0, 0, 0);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  return `${Y}-${M}-${D}T${String(hour).padStart(2, '0')}:00`;
}

export function nextMonthDay(day: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, day);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  return `${Y}-${M}-${D}`;
}

export async function waitForEvents(page: Page): Promise<void> {
  try {
    await page.waitForResponse(
      (r: any) => r.url().includes('/api/calendar/events/') && r.status() === 200,
      { timeout: 5000 },
    );
  } catch {
    /* события могут быть уже загружены */
  }
}

const _base = new Date();
_base.setFullYear(_base.getFullYear() + 1);
export const CLEAN_EVENT_DATE = _base.toISOString().slice(0, 10);
export const CLEAN_EVENT_START = `${CLEAN_EVENT_DATE}T10:00`;

export function cleanDateEvents(page: Page): Locator {
  return page.locator(`.fc-daygrid-day[data-date="${CLEAN_EVENT_DATE}"] .fc-event`);
}

export async function getEventProp(
  page: Page,
  eventId: number,
  prop: string,
  timeout = 5000,
): Promise<number | null> {
  return page.evaluate(async ({ eventId, prop, timeout }) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const evs = (window as any).calendar?.getEvents() || [];
      const ev = evs.find((e: any) => Number(e.id) === eventId);
      if (ev) {
        const val = ev?.extendedProps?.[prop];
        return typeof val === 'number' ? val : null;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return null;
  }, { eventId, prop, timeout });
}

export async function navigateToCleanDate(page: Page): Promise<void> {
  await navigateToDate(page, CLEAN_EVENT_DATE);
}

export async function navigateToDate(page: Page, date: string): Promise<void> {
  await page.evaluate((d) => {
    const cal = (window as any).calendar;
    if (cal && cal.gotoDate) {
      cal.gotoDate(d);
    }
  }, date);
  await waitForEvents(page);
}

export async function switchView(page: Page, view: string): Promise<void> {
  await page.getByTestId(`fc-view-${view}`).click();
  await waitForEvents(page);
}

export async function openCreateModal(page: Page, day: number): Promise<void> {
  const targetDate = nextMonthDay(day);
  let cell = page.locator(
    `.fc-daygrid-day[data-date="${targetDate}"]`,
  );
  if ((await cell.count()) === 0) {
    await page.locator('.fc-next-button').click();
  }
  cell = page.locator(`.fc-daygrid-day[data-date="${targetDate}"]`);
  await cell.click();
  await expect(page.locator('#eventModal')).toBeVisible();
}

export async function enroll(page: Page): Promise<void> {
  await page.getByTestId('enroll-btn').click();
  await expect(page.getByTestId('notification-modal')).toBeVisible();
  await expect(page.getByTestId('notification-message')).toContainText('Ждем вас');
  await page.getByTestId('notification-ok-btn').click();
  await expect(page.getByTestId('cancel-enrollment-btn')).toBeVisible();
}

export async function cancelEnrollment(page: Page): Promise<void> {
  await page.getByTestId('cancel-enrollment-btn').click();
  await expect(page.locator('#confirmModal')).toBeVisible();
  await page.getByTestId('confirm-ok-btn').click();
  await expect(page.getByTestId('notification-modal')).toBeVisible();
  await expect(page.getByTestId('notification-message')).toContainText('отменена');
  await page.getByTestId('notification-ok-btn').click();
}

export interface SetupEventOptions {
  class_type_id?: number;
  start?: string;
  duration?: number;
  hall_id?: number;
  tariff_id?: number;
  max_participants_override?: number;
}

export async function setupEvent(
  page: Page,
  options: SetupEventOptions = {},
): Promise<number> {
  await loginAsAdmin(page);
  await page.goto('/calendar/');
  await cleanupEventsOnDate(page, CLEAN_EVENT_DATE);
  const result = await createCalendarEvent(page, {
    class_type_id: options.class_type_id ?? 1,
    start: options.start ?? CLEAN_EVENT_START,
    duration: options.duration ?? 60,
    hall_id: options.hall_id ?? 2,
    tariff_id: options.tariff_id ?? 3,
    max_participants_override: options.max_participants_override ?? 10,
  });
  return result.event!.id;
}

export async function teardownEvent(page: Page, eventId: number): Promise<void> {
  await page.context().clearCookies();
  await loginAsAdmin(page);
  await page.goto('/calendar/');
  await deleteCalendarEvent(page, eventId);
}

export async function getAttendance(page: Page, sessionId: number): Promise<any> {
  return page.evaluate(async (sessionId) => {
    const r = await fetch(`/api/calendar/events/${sessionId}/attendance/`);
    if (!r.ok) throw new Error(`getAttendance: HTTP ${r.status}`);
    return r.json();
  }, sessionId);
}

export async function fetchEventsOnDate(page: Page, date: string): Promise<any[]> {
  return page.evaluate(async (date) => {
    const r = await fetch(`/api/calendar/events/?start=${date}&end=${date}`);
    if (!r.ok) throw new Error(`fetchEventsOnDate: HTTP ${r.status}`);
    return r.json();
  }, date);
}
