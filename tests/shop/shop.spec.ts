import { test, expect, BASE_URL } from '../fixtures/base';
import type { Page } from '@playwright/test';
import {
  loginAsStudent,
  loginAsAdmin,
  registerNewUser,
  uniquePhone,
  getUserInfo,
  deleteTestUser,
  setAllowedTariffs,
  setBalance,
  getCsrfToken,
  purchaseSubscription,
  createCalendarEvent,
  deleteCalendarEvent,
  cleanupEventsOnDate,
  enrollToEvent,
  getCurrentUserInfo,
} from '../fixtures/helpers';
import { installWidgetStub, getWidgetLog } from '../fixtures/widget-stub';
import { getResolvedTestTariffs } from '../fixtures/helpers';
// Отдельная от calendar-сьюта «чистая дата», чтобы события shop-тестов не пересекались
// с тестами, считающими события на CLEAN_EVENT_DATE при параллельном прогоне.
const SHOP_EVENT_DATE = '2030-08-22';

// Резолвим тарифы из каталога БД при старте — тесты не должны хардкодить id.
let GROUP_ID = 0;
let FORBIDDEN_ID = 0;
let LITE_ID = 0;
let GROUP_SUB_PRICE = 0;
let GROUP_SESSIONS = 0;
let LITE_SUBSCRIPTION_PRICE = 0;
let LITE_SESSIONS = 0;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    const t = await getResolvedTestTariffs(page);
    GROUP_ID = t.groupId;
    FORBIDDEN_ID = t.forbiddenId;
    LITE_ID = t.liteId;
    GROUP_SUB_PRICE = t.groupSubPrice;
    GROUP_SESSIONS = t.groupSessions;
    LITE_SUBSCRIPTION_PRICE = t.liteSubPrice;
    LITE_SESSIONS = t.liteSessions;
  } finally {
    await page.close();
  }
});

let webhookSeq = 0;
function uniquePaymentId(): string {
  webhookSeq++;
  return `pay-test-${Date.now()}-${webhookSeq}`;
}

// Регистрирует свежего пользователя, возвращает телефон и id
async function registerFreshUser(page: Page): Promise<{ phone: string; id: number }> {
  const phone = uniquePhone();
  await registerNewUser(page, phone);
  const info = await getUserInfo(page, phone);
  if (!info.id) throw new Error(`registerFreshUser: id not returned for ${phone}`);
  return { phone, id: info.id };
}

// Свежий пользователь с балансом и allowed-тарифами (входит под ним)
async function freshUserWithBalance(page: Page, balance: number, tariffs: number[]): Promise<string> {
  const { phone, id } = await registerFreshUser(page);
  await page.context().clearCookies();
  await loginAsAdmin(page);
  await setAllowedTariffs(page, id, tariffs);
  await setBalance(page, id, balance);
  await page.context().clearCookies();
  await loginAsStudent(page, phone);
  return phone;
}

// POST на /api/yookassa/callback/ (csrf_exempt, без подписи)
async function postWebhook(page: Page, body: object): Promise<{ status: number; text: string }> {
  return page.evaluate(async (body) => {
    const r = await fetch('/api/yookassa/callback/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    return { status: r.status, text: await r.text() };
  }, body);
}

function webhookBody(
  paymentId: string,
  metadata: Record<string, unknown>,
  status: string = 'succeeded',
): object {
  return {
    type: 'notification',
    event: 'payment.succeeded',
    object: { id: paymentId, status, metadata },
  };
}

// POST на /api/purchase-subscription/ → { status, body }
async function postPurchase(page: Page, tariffId: number | null): Promise<{ status: number; body: any }> {
  const csrf = await getCsrfToken(page);
  return page.evaluate(
    async ({ tariffId, csrf }) => {
      const r = await fetch('/api/purchase-subscription/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
        credentials: 'same-origin',
        body: JSON.stringify(tariffId === null ? {} : { tariff_id: tariffId }),
      });
      return { status: r.status, body: await r.json() };
    },
    { tariffId, csrf },
  );
}

// Создаёт событие на чистой будущей дате и возвращает его id
async function createCleanEvent(page: Page, hour: number): Promise<number> {
  const res = await createCalendarEvent(page, {
    class_type_id: 1,
    start: `${SHOP_EVENT_DATE}T${String(hour).padStart(2, '0')}:00`,
    duration: 60,
    hall_id: 2,
    tariff_id: LITE_ID,
    max_participants_override: 20,
  });
  if (!res.event) throw new Error(`createCleanEvent: ${JSON.stringify(res)}`);
  return res.event.id;
}


test.describe('Магазин (Shop)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/shop/');
  });

  test.describe('Отображение', () => {
    test('открывается страница магазина', async ({ page }) => {
      await expect(page).toHaveURL(`${BASE_URL}shop/`);
    });

    test('отображается заголовок "Магазин"', async ({ page }) => {
      await expect(page.locator('h2, h1').filter({ hasText: 'Магазин' })).toBeVisible();
    });

    test('отображается баланс пользователя', async ({ page }) => {
      await expect(page.locator('[data-test-id="topup-btn"]').first()).toBeVisible();
    });

    test('кнопка "Пополнить баланс" видна', async ({ page }) => {
      await expect(page.getByTestId('topup-btn')).toBeVisible();
    });

    test('секция абонементов отображается', async ({ page }) => {
      await expect(page.locator('text=Доступные абонементы')).toBeVisible();
    });
  });

  test.describe('Навигация — нижняя панель', () => {
    test('кнопка "Главная" ведёт на главную', async ({ page }) => {
      await page.getByTestId('nav-home').click();
      await expect(page).toHaveURL(`${BASE_URL}dashboard/`);
    });

    test('кнопка "Расписание" ведёт на календарь', async ({ page }) => {
      await page.getByTestId('nav-calendar').click();
      await expect(page).toHaveURL(`${BASE_URL}calendar/`);
    });

    test('кнопка "Профиль" ведёт на профиль', async ({ page }) => {
      await page.getByTestId('nav-profile').click();
      await expect(page).toHaveURL(`${BASE_URL}profile/`);
    });

    test('кнопка "Магазин" активна', async ({ page }) => {
      const shopNav = page.getByTestId('nav-shop');
      await expect(shopNav).toHaveAttribute('class', /active/);
    });
  });

  test.describe('Модалка пополнения', () => {
    test('модалка скрыта по умолчанию', async ({ page }) => {
      await expect(page.getByTestId('topup-modal')).not.toBeVisible();
    });

    test('кнопка "Пополнить" открывает модалку', async ({ page }) => {
      await page.getByTestId('topup-btn').click();
      await expect(page.getByTestId('topup-modal')).toBeVisible();
    });

    test('модалка содержит поле суммы', async ({ page }) => {
      await page.getByTestId('topup-btn').click();
      await expect(page.getByTestId('topup-amount')).toBeVisible();
    });

    test('кнопка "Отмена" закрывает модалку', async ({ page }) => {
      await page.getByTestId('topup-btn').click();
      await page.getByTestId('topup-cancel').click();
      await expect(page.getByTestId('topup-modal')).not.toBeVisible();
    });

    test('крестик закрывает модалку', async ({ page }) => {
      await page.getByTestId('topup-btn').click();
      await page.getByTestId('topup-close').click();
      await expect(page.getByTestId('topup-modal')).not.toBeVisible();
    });

    test('клик по оверлею закрывает модалку', async ({ page }) => {
      await page.getByTestId('topup-btn').click();
      await page.getByTestId('topup-modal').click({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('topup-modal')).not.toBeVisible();
    });

    test('пустая сумма показывает ошибку', async ({ page }) => {
      await page.getByTestId('topup-btn').click();
      await page.getByTestId('topup-amount').fill('');
      await page.getByTestId('topup-confirm').click();
      await expect(page.locator('#topupError')).toBeVisible();
    });

    test('отрицательная сумма показывает ошибку', async ({ page }) => {
      await page.getByTestId('topup-btn').click();
      await page.getByTestId('topup-amount').fill('-100');
      await page.getByTestId('topup-confirm').click();
      await expect(page.locator('#topupError')).toBeVisible();
    });
  });

  test.describe('Модалка покупки абонемента', () => {
    test('модалка скрыта по умолчанию', async ({ page }) => {
      await expect(page.getByTestId('purchase-modal')).not.toBeVisible();
    });

    test('модалка содержит название, цену и количество занятий выбранного абонемента', async ({ page }) => {
      const activeCard = page.locator('[data-test-id="subscription-card"][data-allowed="true"]').first();
      const firstBtn = activeCard.locator('.purchase-subscription-btn');
      const name = await firstBtn.getAttribute('data-tariff-name');
      const price = parseFloat((await firstBtn.getAttribute('data-price')) || '0');
      const sessionsDetails = await activeCard.locator('.subscription-details').textContent();
      const sessionsCount = (sessionsDetails || '').match(/\d+/)?.[0] || '';

      await firstBtn.click();
      await expect(page.getByTestId('purchase-modal')).toBeVisible();
      await expect(page.locator('#modalTariffName')).toHaveText(name || '');
      await expect(page.locator('#modalPrice')).toHaveText(String(price));
      await expect(page.locator('#modalSessionsCount')).toHaveText(sessionsCount);
      await expect(page.locator('#modalSessionsCount')).not.toBeEmpty();
    });
  });

  test.describe('Отображение недоступных тарифов', () => {
    test('недоступные тарифы отображаются серыми с кнопкой запроса к администратору', async ({ page }) => {
      const locked = page.locator('[data-test-id="subscription-card-locked"]');
      const active = page.locator('[data-test-id="subscription-card"][data-allowed="true"]');

      await expect(locked.first()).toBeVisible();
      await expect(locked.first().locator('[data-test-id="tariff-request-btn"]')).toContainText('Обратитесь к администратору для покупки тарифа');
      await expect(locked.first().locator('.purchase-subscription-btn')).toHaveCount(0);

      // Все абонементные тарифы видны: серые + активные = общее число карточек
      const total = await page.locator('[data-test-id="subscription-card-locked"], [data-test-id="subscription-card"]').count();
      const lockedCount = await locked.count();
      const activeCount = await active.count();
      expect(total).toBe(lockedCount + activeCount);
      expect(activeCount).toBe(1); // у s5 доступен только тариф 3
      expect(lockedCount).toBe(total - 1);
    });

    test('кнопка запроса доступа отправляет уведомление администратору и деактивируется', async ({ page }) => {
      // Подключаем VK администратору, чтобы запрос имел получателя
      await page.context().clearCookies();
      await loginAsAdmin(page);
      const vkLink = await page.request.post('/api/auth/vk/test/', {
        data: { user_id: `9900${Date.now()}` },
      });
      expect(vkLink.ok()).toBe(true);

      await page.context().clearCookies();
      await loginAsStudent(page);
      await page.goto('/shop/');

      const requestBtn = page.locator('[data-test-id="tariff-request-btn"]').first();
      await requestBtn.click();

      await expect(page.getByTestId('notification-modal')).toBeVisible();
      await expect(page.getByTestId('notification-message')).toContainText('Запрос отправлен');
      await expect(requestBtn).toBeDisabled();
      await expect(requestBtn).toHaveText('Запрос отправлен');
    });

    test('доступный тариф остаётся покупаемым', async ({ page }) => {
      const activeCard = page.locator('[data-test-id="subscription-card"][data-allowed="true"]').first();
      await activeCard.locator('.purchase-subscription-btn').click();
      await expect(page.getByTestId('purchase-modal')).toBeVisible();
    });
  });

  test.describe('YooKassa виджет', () => {
    test('YooKassa модалка скрыта по умолчанию', async ({ page }) => {
      await expect(page.getByTestId('yookassa-widget-modal')).not.toBeVisible();
    });
  });

  test.describe('Покупка абонемента', () => {
    test('покупка абонемента через UI списывает баланс и показывает абонемент', async ({ page }) => {
      const phone = await freshUserWithBalance(page, 10000, [GROUP_ID, 3]);
      await page.goto('/shop/');

      await page.locator(`.purchase-subscription-btn[data-tariff-id="${GROUP_ID}"]`).click();
      await expect(page.getByTestId('purchase-modal')).toBeVisible();
      await expect(page.locator('#modalPrice')).toHaveText(String(GROUP_SUB_PRICE));
      await page.getByTestId('confirm-purchase-btn').click();

      await expect(page.getByTestId('notification-modal')).toBeVisible();
      await expect(page.getByTestId('notification-message')).toContainText('Абонемент куплен');

      // Страница перезагружается через 1.5 с
      await expect(page.locator('.balance-value').first()).toContainText(String(10000 - GROUP_SUB_PRICE), { timeout: 6000 });
      await expect(page.locator('.subs-remaining')).toHaveText(`${GROUP_SESSIONS} занятий`);
      await expect(page.locator('.subs-name')).not.toBeEmpty();

      const info = await getCurrentUserInfo(page);
      expect(info.balance).toBe((10000 - GROUP_SUB_PRICE).toFixed(2));
      expect(info.subscription).not.toBeNull();
      expect(info.subscription!.sessions_total).toBe(GROUP_SESSIONS);
      expect(info.subscription!.sessions_remaining).toBe(GROUP_SESSIONS);
      expect(info.subscription!.status).toBe('active');

      await deleteTestUser(page, phone);
    });

    test('повторная покупка при активном абонементе возвращает ошибку', async ({ page }) => {
      const phone = await freshUserWithBalance(page, 10000, [GROUP_ID, 3]);
      await purchaseSubscription(page, GROUP_ID);

      const api = await postPurchase(page, GROUP_ID);
      expect(api.status).toBe(400);
      expect(api.body.error).toContain('активный абонемент');

      // UI: подтверждение покупки показывает тост с той же ошибкой
      await page.goto('/shop/');
      await page.locator(`.purchase-subscription-btn[data-tariff-id="${GROUP_ID}"]`).click();
      await page.getByTestId('confirm-purchase-btn').click();
      await expect(page.getByTestId('notification-modal')).toBeVisible();
      await expect(page.getByTestId('notification-message')).toContainText('активный абонемент');

      await deleteTestUser(page, phone);
    });

    test('тариф без абонементов возвращает ошибку', async ({ page }) => {
      const phone = await freshUserWithBalance(page, 10000, [GROUP_ID, 3, FORBIDDEN_ID]);

      const api = await postPurchase(page, FORBIDDEN_ID);
      expect(api.status).toBe(400);
      expect(api.body.error).toContain('недоступны абонементы');

      await deleteTestUser(page, phone);
    });

    test('покупка тарифа вне списка доступных возвращает 403', async ({ page }) => {
      const phone = await freshUserWithBalance(page, 10000, [GROUP_ID]);

      const api = await postPurchase(page, 3);
      expect(api.status).toBe(403);
      expect(api.body.error).toContain('нет доступа');

      await deleteTestUser(page, phone);
    });

    test('покупка без ID тарифа возвращает ошибку', async ({ page }) => {
      const phone = await freshUserWithBalance(page, 10000, [GROUP_ID, 3]);

      const api = await postPurchase(page, null);
      expect(api.status).toBe(400);
      expect(api.body.error).toContain('ID тарифа обязателен');

      await deleteTestUser(page, phone);
    });
  });

  test.describe('Пополнение баланса (валидация)', () => {
    test('API: пополнение на сумму 0 возвращает ошибку', async ({ page }) => {
      const phone = await freshUserWithBalance(page, 0, []);
      const csrf = await getCsrfToken(page);

      const res = await page.evaluate(
        async ({ csrf }) => {
          const r = await fetch('/api/balance/top-up/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
            credentials: 'same-origin',
            body: JSON.stringify({ amount: 0 }),
          });
          return { status: r.status, body: await r.json() };
        },
        { csrf },
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('больше 0');

      await deleteTestUser(page, phone);
    });

    test('UI: сумма больше 100 000 показывает ошибку в модалке', async ({ page }) => {
      const phone = await freshUserWithBalance(page, 0, []);
      await page.goto('/shop/');

      await page.getByTestId('topup-btn').click();
      await page.getByTestId('topup-amount').fill('100001');
      await page.getByTestId('topup-confirm').click();

      await expect(page.locator('#topupError')).toBeVisible();
      await expect(page.locator('#topupError')).toContainText('Сумма не может превышать 100 000 ₽');

      await deleteTestUser(page, phone);
    });

    test('API: пополнение на сумму больше 100 000 возвращает ошибку', async ({ page }) => {
      const phone = await freshUserWithBalance(page, 0, []);
      const csrf = await getCsrfToken(page);

      const res = await page.evaluate(
        async ({ csrf }) => {
          const r = await fetch('/api/balance/top-up/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf },
            credentials: 'same-origin',
            body: JSON.stringify({ amount: 100001 }),
          });
          return { status: r.status, body: await r.json() };
        },
        { csrf },
      );
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Сумма не может превышать 100 000 ₽');

      await deleteTestUser(page, phone);
    });
  });

  test.describe('Вебхук YooKassa', () => {
    test('topup зачисляет баланс', async ({ page }) => {
      const { id, phone } = await registerFreshUser(page);
      const paymentId = uniquePaymentId();

      const res = await postWebhook(page, webhookBody(paymentId, { action: 'topup', user_id: String(id), amount: '1000' }));
      expect(res.status).toBe(200);
      expect(res.text).toBe('200 OK');

      const info = await getUserInfo(page, phone);
      expect(parseFloat(info.balance || '0')).toBe(1000);

      await deleteTestUser(page, phone);
    });

    test('purchase_subscription создаёт абонемент и списывает баланс', async ({ page }) => {
      const phone = await freshUserWithBalance(page, 10000, [GROUP_ID, 3]);
      const info = await getUserInfo(page, phone);
      const id = info.id!;
      const paymentId = uniquePaymentId();

      const res = await postWebhook(
        page,
        webhookBody(paymentId, { action: 'purchase_subscription', user_id: String(id), tariff_id: GROUP_ID }),
      );
      expect(res.status).toBe(200);

      const my = await getCurrentUserInfo(page);
      expect(my.balance).toBe((10000 - GROUP_SUB_PRICE).toFixed(2));
      expect(my.subscription).not.toBeNull();
      expect(my.subscription!.sessions_remaining).toBe(GROUP_SESSIONS);
      expect(my.subscription!.tariff_id).toBe(GROUP_ID);

      await deleteTestUser(page, phone);
    });

    test('renew_subscription добавляет занятия и продлевает срок', async ({ page }) => {
      // Lite — LITE_SESSIONS занятий за LITE_SUBSCRIPTION_PRICE. Покупаем, тратим LITE_SESSIONS-1 занятий
      // → остаётся 1 → продление доступно.
      const phone = await freshUserWithBalance(page, 10000, [LITE_ID]);
      const info = await getUserInfo(page, phone);
      const id = info.id!;
      const enrollCount = LITE_SESSIONS - 1;

      await purchaseSubscription(page, LITE_ID);

      // Создаём события на чистой дате (создание событий — только модератор/админ)
      const eventIds: number[] = [];
      await page.context().clearCookies();
      await loginAsAdmin(page);
      await cleanupEventsOnDate(page, SHOP_EVENT_DATE);
      try {
        for (let i = 0; i < enrollCount; i++) {
          const eventId = await createCleanEvent(page, 10 + i);
          eventIds.push(eventId);
        }

        // Записываемся на все занятия (студент)
        await page.context().clearCookies();
        await loginAsStudent(page, phone);
        for (const eventId of eventIds) {
          await enrollToEvent(page, eventId);
        }

        const before = await getCurrentUserInfo(page);
        expect(before.subscription!.sessions_remaining).toBe(1);

        const paymentId = uniquePaymentId();
        const res = await postWebhook(
          page,
          webhookBody(paymentId, { action: 'renew_subscription', user_id: String(id), subscription_id: before.subscription!.id }),
        );
        expect(res.status).toBe(200);

        const after = await getCurrentUserInfo(page);
        expect(after.balance).toBe((10000 - 2 * LITE_SUBSCRIPTION_PRICE).toFixed(2));
        expect(after.subscription!.sessions_remaining).toBe(LITE_SESSIONS * 2 - enrollCount);
        expect(after.subscription!.sessions_total).toBe(LITE_SESSIONS * 2);
      } finally {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        for (const eventId of eventIds) {
          await deleteCalendarEvent(page, eventId);
        }
      }

      await deleteTestUser(page, phone);
    });

    test('дубликат payment_id не зачисляет средства дважды', async ({ page }) => {
      const { id, phone } = await registerFreshUser(page);
      const paymentId = uniquePaymentId();
      const body = webhookBody(paymentId, { action: 'topup', user_id: String(id), amount: '1000' });

      const r1 = await postWebhook(page, body);
      expect(r1.text).toBe('200 OK');

      const r2 = await postWebhook(page, body);
      expect(r2.text).toBe('duplicate');

      const info = await getUserInfo(page, phone);
      expect(parseFloat(info.balance || '0')).toBe(1000);

      await deleteTestUser(page, phone);
    });

    test('вебхук со статусом pending игнорируется', async ({ page }) => {
      const { id, phone } = await registerFreshUser(page);
      const paymentId = uniquePaymentId();

      const res = await postWebhook(page, webhookBody(paymentId, { action: 'topup', user_id: String(id), amount: '1000' }, 'pending'));
      expect(res.text).toBe('ignored');

      const info = await getUserInfo(page, phone);
      expect(parseFloat(info.balance || '0')).toBe(0);

      await deleteTestUser(page, phone);
    });
  });

  test.describe('Пополнение из модалки покупки', () => {
    test('кнопка "Пополнить баланс" открывает виджет с суммой = цена − баланс', async ({ page }) => {
      await installWidgetStub(page);
      await page.route('**/api/balance/top-up/', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, confirmation_token: 'fake-token', payment_id: 'fake-payment' }),
        }),
      );

      const phone = await freshUserWithBalance(page, 1000, [GROUP_ID, 3]);
      await page.goto('/shop/');

      await page.locator(`.purchase-subscription-btn[data-tariff-id="${GROUP_ID}"]`).click();
      await expect(page.getByTestId('purchase-modal')).toBeVisible();
      await expect(page.locator('#modalWarning')).toBeVisible();
      await expect(page.locator('#modalNeededAmount')).toHaveText(String(GROUP_SUB_PRICE - 1000));
      await expect(page.getByTestId('confirm-purchase-btn')).toBeHidden();
      await expect(page.getByTestId('topup-from-purchase-btn')).toBeVisible();

      const reqPromise = page.waitForRequest((req) => req.url().includes('/api/balance/top-up/') && req.method() === 'POST');
      await page.getByTestId('topup-from-purchase-btn').click();
      const req = await reqPromise;
      const body = JSON.parse(req.postData() || '{}');
      expect(body.amount).toBe(GROUP_SUB_PRICE - 1000);

      await expect(page.getByTestId('yookassa-widget-modal')).toBeVisible();
      const log = await getWidgetLog(page);
      expect(log).toContainEqual({ type: 'render', id: 'yookassaWidgetContainer' });

      await deleteTestUser(page, phone);
    });
  });
});
