import { Page, expect } from '@playwright/test';

const STUDENT_PHONE = '3333333333';
const STUDENT_PASS = 'stud123';

let phoneCounter = 0;
export function uniquePhone(): string {
  phoneCounter++;
  const stamp = String(Date.now()).slice(-6);
  const seq = String(phoneCounter % 100).padStart(2, '0');
  return `+790${stamp}${seq}`;
}

export interface TariffInfo {
  id: number;
  name: string;
  tariff_type: string;
  price_per_person: number;
  split_total_price: number;
  is_active: boolean;
  is_subscription_available: boolean;
  subscription_price: number;
  subscription_sessions_count: number | null;
  subscription_validity_days: number | null;
  group_id: number | null;
}

export async function getTariffs(page: Page): Promise<TariffInfo[]> {
  const r = await page.request.get('/api/auth/test/tariffs/');
  if (!r.ok) throw new Error(`getTariffs: HTTP ${r.status}`);
  const data = await r.json();
  return data.tariffs as TariffInfo[];
}

export interface ResolvedTestTariffs {
  group: TariffInfo;
  split: TariffInfo;
  forbidden: TariffInfo;
  lite: TariffInfo;
  pro: TariffInfo;
  groupId: number;
  splitId: number;
  forbiddenId: number;
  liteId: number;
  proId: number;
  groupSessions: number;
  groupSessionPrice: number;
  groupSubPrice: number;
  liteSessions: number;
  liteSessionPrice: number;
  liteSubPrice: number;
}

let _resolved: ResolvedTestTariffs | null = null;

export async function getResolvedTestTariffs(page: Page): Promise<ResolvedTestTariffs> {
  if (_resolved) return _resolved;

  const all = await getTariffs(page);
  const active = all.filter((t) => t.is_active);

  // «Групповой» — групповой non-split тариф с абонементом, вне TariffGroup.
  // Роль экс-тарифа «Йога»: 700 ₽ за занятие, абонемент 4500/8 занятий.
  const group =
    active.find((t) => t.tariff_type === 'group' && t.is_subscription_available && t.group_id === null) ||
    active.find((t) => t.tariff_type === 'group' && t.is_subscription_available) ||
    active[0];

  const split = active.find((t) => t.tariff_type === 'split') || group;

  // «Недоступный» — тариф без абонемента (не может быть выдан студенту).
  const forbidden =
    active.find((t) => !t.is_subscription_available && t.id !== group.id) ||
    active.find((t) => t.id !== group.id && t.id !== split.id) ||
    group;

  const grouped = active.filter((t) => t.group_id !== null);
  const lite =
    active.find((t) => /lite/i.test(t.name)) ||
    (grouped.length
      ? grouped.reduce((a, b) =>
          (a.subscription_sessions_count ?? 0) <= (b.subscription_sessions_count ?? 0) ? a : b,
        )
      : group);
  const pro =
    active.find((t) => /pro/i.test(t.name)) ||
    (grouped.length
      ? grouped.reduce((a, b) =>
          (a.subscription_sessions_count ?? 0) >= (b.subscription_sessions_count ?? 0) ? a : b,
        )
      : group);

  _resolved = {
    group,
    split,
    forbidden,
    lite,
    pro,
    groupId: group.id,
    splitId: split.id,
    forbiddenId: forbidden.id,
    liteId: lite.id,
    proId: pro.id,
    groupSessions: group.subscription_sessions_count ?? 0,
    groupSessionPrice: group.price_per_person,
    groupSubPrice: group.subscription_price,
    liteSessions: lite.subscription_sessions_count ?? 0,
    liteSessionPrice: lite.price_per_person,
    liteSubPrice: lite.subscription_price,
  };
  return _resolved;
}

export async function loginAsStudent(
  page: Page,
  phone: string = STUDENT_PHONE,
  password: string = STUDENT_PASS,
): Promise<void> {
  await page.goto('/login/');
  await fillPhoneField(page, '[data-test-id="login-username"]', phone);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL('**/dashboard/');
}

export async function fillPhoneField(page: Page, selector: string, phone: string): Promise<void> {
  await page.evaluate(({ selector, phone }) => {
    const input = document.querySelector(selector) as HTMLInputElement;
    if (input) {
      input.value = phone;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, { selector, phone });
}

export async function fillRegisterForm(
  page: Page,
  fields: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    password1?: string;
    password2?: string;
  } = {},
): Promise<void> {
  const {
    firstName = 'Тест',
    lastName = 'Тестов',
    phone = '+79001234567',
    password1 = 'Test1234!',
    password2 = 'Test1234!',
  } = fields;
  await page.getByTestId('register-first-name').fill(firstName);
  await page.getByTestId('register-last-name').fill(lastName);

  await fillPhoneField(page, '[data-test-id="register-phone"]', phone);

  await page.getByTestId('register-password1').fill(password1);
  await page.getByTestId('register-password2').fill(password2);
}

async function getCsrf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const m = document.cookie.match(/csrftoken=([^;]+)/);
    return m ? m[1] : '';
  });
}

export interface UserInfo {
  exists: boolean;
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  balance?: string;
  vk_user_id?: string;
  booking_count?: number;
  subscription_count?: number;
}

export async function getUserInfo(page: Page, phone: string): Promise<UserInfo> {
  const csrf = await getCsrf(page);
  return page.evaluate(async ({ phone, csrf }) => {
    const r = await fetch('/api/auth/test/user-info/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ phone }),
    });
    if (!r.ok) {
      throw new Error(`getUserInfo: HTTP ${r.status} — ${await r.text()}`);
    }
    return r.json();
  }, { phone, csrf });
}

export async function deleteTestUser(page: Page, phone: string): Promise<void> {
  const csrf = await getCsrf(page);
  await page.evaluate(async ({ phone, csrf }) => {
    const r = await fetch('/api/auth/test/delete-user/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ phone }),
    });
    if (!r.ok) {
      throw new Error(`deleteTestUser: HTTP ${r.status} — ${await r.text()}`);
    }
  }, { phone, csrf });
}

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/admin/login/');
  await page.locator('#id_username').fill('admin');
  await page.locator('#id_password').fill('admin123');
  await page.locator('input[type="submit"]').click();
  await page.waitForURL('**/admin/**');
}

export async function loginAsModerator(page: Page): Promise<void> {
  for (const password of ['mod123', 'admin123']) {
    await page.goto('/admin/login/');
    await page.locator('#id_username').fill('moderator');
    await page.locator('#id_password').fill(password);
    await page.locator('input[type="submit"]').click();
    try {
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 5000 });
      return;
    } catch {
      /* неверный пароль — пробуем следующий */
    }
  }
  throw new Error('loginAsModerator: все пароли отклонены');
}

export async function getCsrfToken(page: Page): Promise<string> {
  return getCsrf(page);
}

export interface CalendarEventOptions {
  class_type_id: number;
  start: string;
  duration?: number;
  hall_id?: number;
  tariff_id: number;
  max_participants_override?: number;
  is_recurring?: boolean;
  recurring_count?: number;
}

export interface CalendarEventResponse {
  success: boolean;
  event?: { id: number; title: string; start: string; end: string };
  recurring_events?: Array<{ id: number; title: string; start: string }> | null;
  error?: string;
}

export async function createCalendarEvent(
  page: Page,
  options: CalendarEventOptions,
): Promise<CalendarEventResponse> {
  const csrf = await getCsrf(page);
  return page.evaluate(async ({ options, csrf }) => {
    const r = await fetch('/api/calendar/events/create/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify(options),
    });
    return r.json();
  }, { options, csrf });
}

export interface UpdateCalendarEventOptions {
  class_type_id?: number;
  start?: string;
  duration?: number;
  hall_id?: number;
  tariff_id?: number;
  max_participants_override?: number;
  is_recurring?: boolean;
  recurring_count?: number;
}

export async function updateCalendarEvent(
  page: Page,
  eventId: number,
  options: UpdateCalendarEventOptions,
): Promise<any> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ eventId, options, csrf }) => {
    const r = await fetch(`/api/calendar/events/${eventId}/`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify(options),
    });
    const data = await r.json();
    if (!r.ok) {
      throw new Error(`updateCalendarEvent: HTTP ${r.status}: ${data.error || r.statusText}`);
    }
    return data;
  }, { eventId, options, csrf });
  return result;
}

export async function deleteCalendarEvent(
  page: Page,
  eventId: number,
): Promise<{ success: boolean; error?: string }> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ eventId, csrf }) => {
    const r = await fetch(`/api/calendar/events/${eventId}/delete/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    });
    if (r.status === 404) return { success: true }; // уже удалено
    const data = await r.json();
    if (!r.ok) {
      if (r.status === 400 && (data.error || '').includes('No ClassSession')) {
        return { success: true }; // уже удалено каскадом серии
      }
      return { success: false, error: `HTTP ${r.status}: ${data.error || r.statusText}` };
    }
    return data;
  }, { eventId, csrf });
  if (!result.success) {
    console.error(`deleteCalendarEvent(${eventId}):`, result.error);
    throw new Error(result.error);
  }
  return result;
}

export async function deleteAllFutureEvents(page: Page): Promise<void> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ csrf }) => {
    const r = await fetch('/api/calendar/events/?start=2026-07-01&end=2026-08-31');
    if (!r.ok) return { error: `fetch events: ${r.status}` };
    const events = await r.json();
    let deleted = 0;
    for (const ev of events) {
      const start = new Date(ev.start);
      if (start > new Date()) {
        const dr = await fetch(`/api/calendar/events/${ev.id}/delete/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
          credentials: 'same-origin',
          body: JSON.stringify({}),
        });
        const data = await dr.json();
        if (!data.success) return { error: `delete ${ev.id}: ${data.error || 'unknown'}` };
        deleted++;
      }
    }
    return { deleted };
  }, { csrf });
  if (result.error) {
    console.error('deleteAllFutureEvents failed:', result.error);
    throw new Error(result.error);
  }
}

export interface MyInfo {
  balance: string;
  subscription: {
    id: number;
    sessions_total: number;
    sessions_remaining: number;
    tariff_id: number;
    tariff_name: string;
    status: string;
    expires_at: string | null;
  } | null;
}

export async function getCurrentUserInfo(page: Page): Promise<MyInfo> {
  const csrf = await getCsrf(page);
  return page.evaluate(async ({ csrf }) => {
    const r = await fetch('/api/auth/test/my-info/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    });
    if (!r.ok) throw new Error(`getCurrentUserInfo: HTTP ${r.status}`);
    return r.json();
  }, { csrf });
}

export async function purchaseSubscription(
  page: Page,
  tariffId: number,
): Promise<{ success: boolean; balance_used?: boolean; error?: string }> {
  const csrf = await getCsrf(page);
  return page.evaluate(async ({ tariffId, csrf }) => {
    const r = await fetch('/api/purchase-subscription/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ tariff_id: tariffId }),
    });
    const data = await r.json();
    if (!r.ok && !data.success) {
      throw new Error(`purchaseSubscription: HTTP ${r.status} — ${data.error || ''}`);
    }
    return data;
  }, { tariffId, csrf });
}

export async function enrollToEvent(
  page: Page,
  sessionId: number,
): Promise<{ success: boolean; error?: string }> {
  const csrf = await getCsrf(page);
  return page.evaluate(async ({ sessionId, csrf }) => {
    const r = await fetch(`/api/calendar/events/${sessionId}/enroll/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    });
    const data = await r.json();
    if (!r.ok && !data.success) {
      throw new Error(`enrollToEvent: HTTP ${r.status} — ${data.error || ''}`);
    }
    return data;
  }, { sessionId, csrf });
}

export async function cancelEnrollment(
  page: Page,
  sessionId: number,
): Promise<{ success: boolean; error?: string }> {
  const csrf = await getCsrf(page);
  return page.evaluate(async ({ sessionId, csrf }) => {
    const r = await fetch(`/api/calendar/events/${sessionId}/cancel-enrollment/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({}),
    });
    const data = await r.json();
    if (!r.ok && !data.success) {
      throw new Error(`cancelEnrollment: HTTP ${r.status} — ${data.error || ''}`);
    }
    return data;
  }, { sessionId, csrf });
}

export async function setAllowedTariffs(page: Page, userId: number, tariffIds: number[]): Promise<void> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ userId, tariffIds, csrf }) => {
    const r = await fetch('/api/auth/test/set-allowed-tariffs/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: userId, tariff_ids: tariffIds }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`setAllowedTariffs: HTTP ${r.status}, url: ${r.url}, body: ${text}`);
    }
    return r.json();
  }, { userId, tariffIds, csrf });
}

export async function deleteUserSubscriptions(page: Page, userId: number): Promise<number> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ userId, csrf }) => {
    const r = await fetch('/api/auth/test/delete-subscriptions/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: userId }),
    });
    if (!r.ok) throw new Error(`deleteUserSubscriptions: HTTP ${r.status}`);
    return r.json();
  }, { userId, csrf });
  return result.deleted;
}

export interface HallColors {
  id: number;
  color: string;
  text_color: string;
  effective_text_color: string;
}

// Установка цвета фона/текста зала (DEBUG, staff). Пустой объект options — чтение текущих значений
export async function setHallColors(
  page: Page,
  hallId: number,
  options: { color?: string; text_color?: string } = {},
): Promise<HallColors> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ hallId, options, csrf }) => {
    const r = await fetch('/api/auth/test/set-hall-colors/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ hall_id: hallId, ...options }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(`setHallColors: HTTP ${r.status}, body: ${JSON.stringify(data)}`);
    return data.hall;
  }, { hallId, options, csrf });
  return result;
}

export async function setBalance(page: Page, userId: number, balance: number): Promise<void> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ userId, balance, csrf }) => {
    const r = await fetch('/api/auth/test/set-balance/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: userId, balance: balance }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`setBalance: HTTP ${r.status}, body: ${text}`);
    }
    return r.json();
  }, { userId, balance, csrf });
}

// Имитация успешного платежа ЮKassa (action=topup) — создаёт реальную транзакцию deposit
export async function topupViaWebhook(page: Page, userId: number, amount: number): Promise<void> {
  const paymentId = `topup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const result = await page.evaluate(async ({ userId, amount, paymentId }) => {
    const r = await fetch('/api/yookassa/callback/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        type: 'notification',
        event: 'payment.succeeded',
        object: {
          id: paymentId,
          status: 'succeeded',
          metadata: { action: 'topup', user_id: String(userId), amount: String(amount) },
        },
      }),
    });
    if (r.status !== 200) throw new Error(`topupViaWebhook: HTTP ${r.status} — ${await r.text()}`);
    return r.text();
  }, { userId, amount, paymentId });
}

export async function moveSessionToPast(page: Page, sessionId: number, minutes = 60): Promise<void> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ sessionId, minutes, csrf }) => {
    const r = await fetch('/api/auth/test/move-session-to-past/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ session_id: sessionId, minutes }),
    });
    if (!r.ok) throw new Error(`moveSessionToPast: HTTP ${r.status} — ${await r.text()}`);
    return r.json();
  }, { sessionId, minutes, csrf });
}

export async function expireSubscription(page: Page, subscriptionId: number): Promise<void> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ subscriptionId, csrf }) => {
    const r = await fetch('/api/auth/test/expire-subscription/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ subscription_id: subscriptionId }),
    });
    if (!r.ok) throw new Error(`expireSubscription: HTTP ${r.status} — ${await r.text()}`);
    return r.json();
  }, { subscriptionId, csrf });
}

// Привязка VK к ТЕКУЩЕМУ авторизованному пользователю (DEBUG-эндпоинт без VK API).
// Вызывать пока залогинен нужный пользователь.
export async function attachVk(page: Page, vkId: string): Promise<void> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ vkId, csrf }) => {
    const r = await fetch('/api/auth/vk/test/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: vkId, first_name: 'ВК', last_name: 'Тест' }),
    });
    const data = await r.json();
    if (!r.ok || !data.success) {
      throw new Error(`attachVk: HTTP ${r.status} — ${JSON.stringify(data)}`);
    }
    return data;
  }, { vkId, csrf });
}

// Создание прошлой посещаемости для тестов истории/тепловой карты профиля.
// Занятие переносится в прошлое и помечается посещённым.
export async function createPastAttendance(
  page: Page,
  userId: number,
  sessionId: number,
  minutes = 1440,
): Promise<void> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ userId, sessionId, minutes, csrf }) => {
    const r = await fetch('/api/auth/test/set-attendance/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ user_id: userId, session_id: sessionId, minutes }),
    });
    const data = await r.json();
    if (!r.ok || !data.success) {
      throw new Error(`createPastAttendance: HTTP ${r.status} — ${JSON.stringify(data)}`);
    }
    return data;
  }, { userId, sessionId, minutes, csrf });
}

export async function cleanupEventsOnDate(page: Page, dateStr: string): Promise<void> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ csrf, dateStr }) => {
    const r = await fetch(`/api/calendar/events/?start=${dateStr}&end=${dateStr}`);
    if (!r.ok) return { error: `fetch events: ${r.status}` };
    const events = await r.json();
    let deleted = 0;
    for (const ev of events) {
      const dr = await fetch(`/api/calendar/events/${ev.id}/delete/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      });
      const data = await dr.json();
      if (!data.success) return { error: `delete ${ev.id}: ${data.error || 'unknown'}` };
      deleted++;
    }
    return { deleted };
  }, { csrf, dateStr });
  if (result.error) {
    console.error('cleanupEventsOnDate failed:', result.error);
    throw new Error(result.error);
  }
}

export async function createNotifications(page: Page, phone: string, count: number): Promise<number> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ phone, count, csrf }) => {
    const r = await fetch('/api/auth/test/create-notifications/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ phone, count }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`createNotifications: HTTP ${r.status}, body: ${text}`);
    }
    return r.json();
  }, { phone, count, csrf });
  return result.created ?? 0;
}

export async function deleteNotifications(page: Page, phone: string): Promise<number> {
  const csrf = await getCsrf(page);
  const result = await page.evaluate(async ({ phone, csrf }) => {
    const r = await fetch('/api/auth/test/delete-notifications/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
      credentials: 'same-origin',
      body: JSON.stringify({ phone }),
    });
    if (!r.ok) {
      const text = await r.text();
      throw new Error(`deleteNotifications: HTTP ${r.status}, body: ${text}`);
    }
    return r.json();
  }, { phone, csrf });
  return result.deleted ?? 0;
}

export async function getUnreadNotificationCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const r = await fetch('/api/notifications/unread-count/', { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`getUnreadNotificationCount: HTTP ${r.status}`);
    const data = await r.json();
    return data.count ?? 0;
  });
}

export async function registerNewUser(page: Page, phone: string): Promise<void> {
  await page.context().clearCookies();
  await page.goto('/register/');
  await fillRegisterForm(page, { phone, password1: STUDENT_PASS, password2: STUDENT_PASS });
  await page.getByTestId('register-submit').click();
  await page.waitForURL('**/dashboard/');
}

const PNG_TINY_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const PNG_AVATAR_VALID = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAMgAAADICAIAAAAiOjnJAAACFUlEQVR4nO3UMQ0AIADEQEAX/oMsTNCB5E7AT83Ps/eA19bzRRAWFY9FQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWCSERUJYJIRFQlgkhEVCWAiLf3gsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCIiEsEsIiISwSwiIhLBLCYhQux8kC0NKskPIAAAAASUVORK5CYII=',
  'base64',
);

export async function uploadAvatar(page: Page): Promise<void> {
  await page.setInputFiles('[data-test-id="avatar-input"]', {
    name: 'avatar.png',
    mimeType: 'image/png',
    buffer: PNG_AVATAR_VALID,
  });
  await expect(page.locator('.profile-avatar-img')).toBeVisible();
}

export async function setAvatarFile(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  await page.setInputFiles('[data-test-id="avatar-input"]', file);
}
