import { test, expect, BASE_URL } from '../fixtures/base';
import {
  loginAsStudent,
  loginAsAdmin,
  createCalendarEvent,
  deleteCalendarEvent,
  cleanupEventsOnDate,
  cancelEnrollment,
  getCurrentUserInfo,
  getUserInfo,
  setAllowedTariffs,
  deleteUserSubscriptions,
  setBalance,
  purchaseSubscription,
  enrollToEvent,
  createNotifications,
  deleteNotifications,
  getUnreadNotificationCount,
  registerNewUser,
  uniquePhone,
  deleteTestUser,
} from '../fixtures/helpers';
import { installWidgetStub, getWidgetLog } from '../fixtures/widget-stub';
import { getResolvedTestTariffs } from '../fixtures/helpers';

// Резолвим тарифы из каталога БД при старте — без хардкода id.
let GROUP_ID = 0;
let LITE_ID = 0;
let LITE_SESSIONS = 0;
let LITE_SUBSCRIPTION_PRICE = 0;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    const t = await getResolvedTestTariffs(page);
    GROUP_ID = t.groupId;
    LITE_ID = t.liteId;
    LITE_SESSIONS = t.liteSessions;
    LITE_SUBSCRIPTION_PRICE = t.liteSubPrice;
  } finally {
    await page.close();
  }
});

function formatRu(n: number): string {
  return n.toFixed(2).replace('.', ',');
}

function futureDay(daysFromNow: number, hour = 10): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(hour, 0, 0, 0);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  return `${Y}-${M}-${D}T${String(hour).padStart(2, '0')}:00`;
}

test.describe('Главная страница (дашборд)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
  });

  test.describe('Отображение', () => {
    test('открывается главная страница', async ({ page }) => {
      await expect(page).toHaveURL(`${BASE_URL}dashboard/`);
    });

    test('отображается приветствие', async ({ page }) => {
      const info = await getUserInfo(page, '+73333333333');
      await expect(page.locator('.greeting-text')).toBeVisible();
      await expect(page.locator('.greeting-text')).toContainText(info.first_name || 'Тест');
    });

    test('отображается баланс', async ({ page }) => {
      const info = await getCurrentUserInfo(page);
      await expect(page.locator('.balance-value').first()).toBeVisible();
      // Баланс на странице локализован (запятая), API отдаёт точку — сравниваем по цифрам
      const shown = (await page.locator('.balance-value').first().textContent()) || '';
      expect(shown.replace(/[^\d]/g, '')).toBe(info.balance.replace(/[^\d]/g, ''));
    });

    test('отображается кнопка "Пополнить баланс"', async ({ page }) => {
      await expect(page.getByTestId('topup-btn')).toBeVisible();
    });

    test('отображается иконка уведомлений', async ({ page }) => {
      await expect(page.getByTestId('notification-bell')).toBeVisible();
    });
  });

  test.describe('Навигация — нижняя панель', () => {
    test('кнопка "Расписание" ведёт на календарь', async ({ page }) => {
      await page.getByTestId('nav-calendar').click();
      await expect(page).toHaveURL(`${BASE_URL}calendar/`);
    });

    test('кнопка "Магазин" ведёт в магазин', async ({ page }) => {
      await page.getByTestId('nav-shop').click();
      await expect(page).toHaveURL(`${BASE_URL}shop/`);
    });

    test('кнопка "Профиль" ведёт на профиль', async ({ page }) => {
      await page.getByTestId('nav-profile').click();
      await expect(page).toHaveURL(`${BASE_URL}profile/`);
    });
  });

  test.describe('Модалка пополнения баланса', () => {
    test('кнопка "Пополнить баланс" открывает модалку', async ({ page }) => {
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
      await expect(page.getByTestId('topup-modal')).toBeHidden();
    });

    test('крестик закрывает модалку', async ({ page }) => {
      await page.getByTestId('topup-btn').click();
      await page.getByTestId('topup-close').click();
      await expect(page.getByTestId('topup-modal')).toBeHidden();
    });

    test('пустая сумма показывает ошибку', async ({ page }) => {
      await page.getByTestId('topup-btn').click();
      await page.getByTestId('topup-amount').fill('0');
      await page.getByTestId('topup-confirm').click();
      await expect(page.locator('#topupError')).toBeVisible();
    });

    test('отрицательная сумма показывает ошибку', async ({ page }) => {
      await page.getByTestId('topup-btn').click();
      await page.getByTestId('topup-amount').fill('-100');
      await page.getByTestId('topup-confirm').click();
      await expect(page.locator('#topupError')).toBeVisible();
    });

    test('клик по оверлею закрывает модалку', async ({ page }) => {
      await page.getByTestId('topup-btn').click();
      await expect(page.getByTestId('topup-modal')).toBeVisible();
      await page.getByTestId('topup-modal').click({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('topup-modal')).toBeHidden();
    });
  });

  test.describe('Модалка истории посещений', () => {
    test('кнопка "Все" открывает модалку истории', async ({ page }) => {
      await page.getByTestId('history-btn').click();
      await expect(page.getByTestId('history-modal')).toBeVisible();
    });

    test('крестик закрывает модалку истории', async ({ page }) => {
      await page.getByTestId('history-btn').click();
      await expect(page.getByTestId('history-modal')).toBeVisible();
      await page.getByTestId('history-close').click();
      await expect(page.getByTestId('history-modal')).toBeHidden();
    });
  });

  test.describe('Модалка покупки абонемента', () => {
    test('модалка покупки скрыта по умолчанию', async ({ page }) => {
      await expect(page.getByTestId('purchase-modal')).toBeHidden();
    });

    test('при нехватке средств показывается предупреждение и скрывается кнопка покупки', async ({ page }) => {
      // Setup: свежий пользователь с нулевым балансом и доступными тарифами
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      const uid = (await getUserInfo(page, phone)).id!;
      try {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await setAllowedTariffs(page, uid, [GROUP_ID, 3]);
        await setBalance(page, uid, 0);

        await page.context().clearCookies();
        await loginAsStudent(page, phone);

        const activeCard = page.locator('[data-test-id="subscription-card"][data-allowed="true"]').first();
        const firstBtn = activeCard.locator('.purchase-subscription-btn');
        const price = parseFloat((await firstBtn.getAttribute('data-price')) || '0');
        const name = await firstBtn.getAttribute('data-tariff-name');
        const sessionsDetails = await activeCard.locator('.subscription-details').textContent();
        const sessionsCount = (sessionsDetails || '').match(/\d+/)?.[0] || '';
        await firstBtn.click();

        await expect(page.getByTestId('purchase-modal')).toBeVisible();
        await expect(page.locator('#modalTariffName')).toHaveText(name || '');
        await expect(page.locator('#modalPrice')).toHaveText(String(price));
        await expect(page.locator('#modalSessionsCount')).toHaveText(sessionsCount);
        await expect(page.locator('#modalBalance')).toHaveText('0');
        await expect(page.locator('#modalWarning')).toBeVisible();
        await expect(page.locator('#modalWarning')).toContainText('Недостаточно средств. Для покупки пополните баланс на');
        await expect(page.locator('#modalNeededAmount')).toHaveText(String(price));
        await expect(page.getByTestId('confirm-purchase-btn')).toBeHidden();
        await expect(page.getByTestId('topup-from-purchase-btn')).toBeVisible();
      } finally {
        await deleteTestUser(page, phone);
      }
    });
  });

  test.describe('Модалка продления абонемента', () => {
    test('модалка продления скрыта по умолчанию', async ({ page }) => {
      await expect(page.getByTestId('renew-modal')).toBeHidden();
    });

    test('кнопка продления скрыта, когда нет абонемента', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      const uid = (await getUserInfo(page, phone)).id!;
      try {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await deleteUserSubscriptions(page, uid);

        await page.context().clearCookies();
        await loginAsStudent(page, phone);
        await expect(page.getByTestId('renew-btn')).toHaveCount(0);
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('продление: кнопка, модалка, нехватка средств и успешное продление', async ({ page }) => {
      // Setup: свежий пользователь покупает абонемент на Lite (LITE_SESSIONS занятий за LITE_SUBSCRIPTION_PRICE)
      // и посещает LITE_SESSIONS−1 занятий, оставляя 1 занятие — появляется кнопка продления
      const enrollCount = LITE_SESSIONS - 1;
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      const uid = (await getUserInfo(page, phone)).id!;
      const eventIds: number[] = [];
      try {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await setAllowedTariffs(page, uid, [LITE_ID]);
        await setBalance(page, uid, 10000);

        for (let day = 1; day <= enrollCount; day++) {
          const res = await createCalendarEvent(page, {
            class_type_id: 1,
            start: futureDay(day),
            duration: 60,
            hall_id: 2,
            tariff_id: LITE_ID,
            max_participants_override: 10,
          });
          expect(res.success).toBe(true);
          eventIds.push(res.event!.id);
        }

        await page.context().clearCookies();
        await loginAsStudent(page, phone);

        const purchase = await purchaseSubscription(page, LITE_ID);
        expect(purchase.success).toBe(true);
        for (const id of eventIds) {
          const res = await enrollToEvent(page, id);
          expect(res.success).toBe(true);
        }

        // Проверяем состояние через API: осталось 1 занятие, баланс 10000 − цена абонемента
        await page.goto('/dashboard/');
        const state = await getCurrentUserInfo(page);
        expect(state.subscription).not.toBeNull();
        expect(state.subscription!.sessions_remaining).toBe(1);
        expect(parseFloat(state.balance)).toBe(10000 - LITE_SUBSCRIPTION_PRICE);

        // Кнопка продления видна, модалка заполнена данными абонемента
        await expect(page.getByTestId('renew-btn')).toBeVisible();
        await page.getByTestId('renew-btn').click();
        await expect(page.getByTestId('renew-modal')).toBeVisible();
        await expect(page.locator('#renewTariffName')).not.toBeEmpty();
        await expect(page.locator('#renewRemaining')).toHaveText('1');
        await expect(page.locator('#renewPrice')).toHaveText(formatRu(LITE_SUBSCRIPTION_PRICE));
        await expect(page.locator('#renewBalance')).toHaveText(formatRu(10000 - LITE_SUBSCRIPTION_PRICE));
        await expect(page.locator('#renewSessionsCount')).toHaveText(String(LITE_SESSIONS));
        await expect(page.locator('#renewExpires')).not.toHaveText('—');
        await expect(page.locator('#renewWarning')).toBeHidden();
        await expect(page.getByTestId('confirm-renew-btn')).toBeVisible();
        await page.getByTestId('renew-close').click();
        await expect(page.getByTestId('renew-modal')).toBeHidden();

        // Недостаточно средств: предупреждение с суммой, кнопка продления скрыта
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await setBalance(page, uid, 1000);
        await page.context().clearCookies();
        await loginAsStudent(page, phone);
        await expect(page.getByTestId('renew-btn')).toBeVisible();
        await page.getByTestId('renew-btn').click();
        await expect(page.getByTestId('renew-modal')).toBeVisible();
        await expect(page.locator('#renewWarning')).toBeVisible();
        await expect(page.locator('#renewNeededAmount')).toHaveText(String(LITE_SUBSCRIPTION_PRICE - 1000));
        await expect(page.getByTestId('confirm-renew-btn')).toBeHidden();
        await expect(page.getByTestId('topup-from-renew-btn')).toBeVisible();
        await page.getByTestId('renew-close').click();

        // Пополняем баланс и продлеваем абонемент через кнопку
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await setBalance(page, uid, 10000);
        await page.context().clearCookies();
        await loginAsStudent(page, phone);
        await page.getByTestId('renew-btn').click();
        await expect(page.getByTestId('renew-modal')).toBeVisible();
        await page.getByTestId('confirm-renew-btn').click();
        await expect(page.getByTestId('notification-modal')).toBeVisible();
        await expect(page.getByTestId('notification-message')).toContainText('Абонемент продлён');

        // Ждём автоматическую перезагрузку после успешного продления
        await expect(page.getByTestId('notification-modal')).toBeHidden({ timeout: 5000 });
        await page.waitForLoadState('load');
        const after = await getCurrentUserInfo(page);
        expect(after.subscription).not.toBeNull();
        expect(after.subscription!.sessions_remaining).toBe(LITE_SESSIONS * 2 - enrollCount);
        expect(parseFloat(after.balance)).toBe(10000 - LITE_SUBSCRIPTION_PRICE);
        await expect(page.getByTestId('renew-btn')).toHaveCount(0);
      } finally {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        for (const id of eventIds) {
          await deleteCalendarEvent(page, id);
        }
        await deleteTestUser(page, phone);
      }
    });
  });

  test.describe('Stories (новости)', () => {
    test('оверлей stories скрыт по умолчанию', async ({ page }) => {
      await expect(page.getByTestId('stories-overlay')).toBeHidden();
    });

    test('клик по карточке открывает сторис с её заголовком', async ({ page }) => {
      const cards = page.locator('[data-test-id="news-card"]');
      expect(await cards.count()).toBeGreaterThan(0);
      const titles = await cards.locator('.carousel-card-title').allTextContents();

      await cards.first().click();
      await expect(page.getByTestId('stories-overlay')).toBeVisible();
      await expect(page.locator('.story-title')).toHaveText(titles[0]);
    });

    test('навигация влево/вправо переключает сторис', async ({ page }) => {
      const cards = page.locator('[data-test-id="news-card"]');
      expect(await cards.count()).toBeGreaterThan(1);
      const titles = await cards.locator('.carousel-card-title').allTextContents();

      await cards.first().click();
      await expect(page.getByTestId('stories-overlay')).toBeVisible();
      await page.getByTestId('stories-nav-right').click();
      await expect(page.locator('.story-title')).toHaveText(titles[1]);
      await page.getByTestId('stories-nav-left').click();
      await expect(page.locator('.story-title')).toHaveText(titles[0]);
    });

    test('сторис закрывается кнопкой и кликом по фону', async ({ page }) => {
      await page.locator('[data-test-id="news-card"]').first().click();
      await expect(page.getByTestId('stories-overlay')).toBeVisible();
      await page.getByTestId('stories-close').click();
      await expect(page.getByTestId('stories-overlay')).toBeHidden();

      await page.locator('[data-test-id="news-card"]').first().click();
      await expect(page.getByTestId('stories-overlay')).toBeVisible();
      await page.getByTestId('stories-overlay').click({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('stories-overlay')).toBeHidden();
    });
  });

  test.describe('Уведомления', () => {
    test('иконка колокольчика видна', async ({ page }) => {
      await expect(page.getByTestId('notification-bell')).toBeVisible();
    });

    test('клик по колокольчику открывает dropdown', async ({ page }) => {
      await page.getByTestId('notification-bell').click();
      await expect(page.locator('.notification-dropdown.show')).toBeVisible();
    });

    test('клик вне dropdown закрывает его', async ({ page }) => {
      await page.getByTestId('notification-bell').click();
      await expect(page.locator('.notification-dropdown.show')).toBeVisible();
      await page.locator('.topbar-greeting').click();
      await expect(page.locator('.notification-dropdown.show')).toBeHidden();
    });

    test('кнопка "Прочитать все" отмечает все уведомления прочитанными', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await createNotifications(page, phone, 2);
        await page.reload();
        await expect(page.getByTestId('notification-badge')).toHaveText('2');

        await page.getByTestId('notification-bell').click();
        await expect(page.locator('.notification-dropdown.show')).toBeVisible();
        await expect(page.locator('.nd-item.unread')).toHaveCount(2);

        await page.getByTestId('notification-mark-all-read').click();
        await expect(page.locator('.nd-item.unread')).toHaveCount(0);
        await expect(page.getByTestId('notification-badge')).toBeHidden();

        expect(await getUnreadNotificationCount(page)).toBe(0);

        await deleteNotifications(page, phone);
      } finally {
        await deleteTestUser(page, phone);
      }
    });
  });

  test.describe('Модалка ближайших занятий', () => {
    test('модалка скрыта по умолчанию', async ({ page }) => {
      await expect(page.getByTestId('available-sessions-modal')).toBeHidden();
    });

    test('кнопка открывает модалку, запись снимает занятие из списка', async ({ page }) => {
      // Setup: будущее занятие с тарифом свежего пользователя (split, тариф 3)
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      const uid = (await getUserInfo(page, phone)).id!;
      const eventDate = futureDay(1).split('T')[0];
      let eventId = 0;
      try {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await cleanupEventsOnDate(page, eventDate);
        await setAllowedTariffs(page, uid, [3]);
        await setBalance(page, uid, 10000);
        const res = await createCalendarEvent(page, {
          class_type_id: 1,
          start: futureDay(1),
          duration: 60,
          hall_id: 2,
          tariff_id: 3,
          max_participants_override: 10,
        });
        expect(res.success).toBe(true);
        eventId = res.event!.id;

        await page.context().clearCookies();
        await loginAsStudent(page, phone);

        const myCard = page.locator(`.avail-session-card[data-session-id="${eventId}"]`);
        await expect(page.getByTestId('show-available-sessions-btn')).toBeVisible();
        await page.getByTestId('show-available-sessions-btn').click();
        await expect(page.getByTestId('available-sessions-modal')).toBeVisible();
        await expect(myCard).toBeVisible();
        await expect(myCard.locator('.avail-enroll-btn')).toBeEnabled();

        // Закрытие крестиком и кликом по фону
        await page.getByTestId('avail-sessions-close').click();
        await expect(page.getByTestId('available-sessions-modal')).toBeHidden();
        await page.getByTestId('show-available-sessions-btn').click();
        await expect(page.getByTestId('available-sessions-modal')).toBeVisible();
        await page.getByTestId('available-sessions-modal').click({ position: { x: 5, y: 5 } });
        await expect(page.getByTestId('available-sessions-modal')).toBeHidden();

        // Запись через модалку → авто-перезагрузка → занятие пропадает из списка
        await page.getByTestId('show-available-sessions-btn').click();
        const reloadPromise = page.waitForResponse(
          (r) => r.url().includes('/dashboard/') && r.request().method() === 'GET' && r.status() === 200,
        );
        await myCard.locator('.avail-enroll-btn').click();
        await reloadPromise;
        await expect(page.locator(`.avail-session-card[data-session-id="${eventId}"]`)).toHaveCount(0);

        // Занятие появилось в "Предстоящих занятиях"
        const [y, m, d] = eventDate.split('-');
        const formatted = `${d}.${m}.${y}`;
        await expect(page.locator('.sessions-list .session-card', { hasText: formatted })).toHaveCount(1);

        // Очистка: отменяем запись
        const cancel = await cancelEnrollment(page, eventId);
        expect(cancel.success).toBe(true);
      } finally {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        if (eventId) {
          await deleteCalendarEvent(page, eventId);
        }
        await deleteTestUser(page, phone);
      }
    });
  });

  test.describe('YooKassa виджет', () => {
    test('YooKassa модалка скрыта по умолчанию', async ({ page }) => {
      await expect(page.getByTestId('yookassa-widget-modal')).toBeHidden();
    });

    test('пополнение баланса открывает виджет ЮKassa', async ({ page }) => {
      await installWidgetStub(page);
      await page.route('**/api/balance/top-up/', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, confirmation_token: 'fake-token', payment_id: 'fake-payment' }),
        }),
      );
      await page.goto('/dashboard/');

      await page.getByTestId('topup-btn').click();
      await page.getByTestId('topup-amount').fill('1000');
      await page.getByTestId('topup-confirm').click();

      await expect(page.getByTestId('topup-modal')).toBeHidden();
      await expect(page.getByTestId('yookassa-widget-modal')).toBeVisible();

      const log = await getWidgetLog(page);
      expect(log).toContainEqual(
        expect.objectContaining({
          type: 'new',
          opts: expect.objectContaining({ confirmation_token: 'fake-token' }),
        }),
      );
      expect(log).toContainEqual({ type: 'render', id: 'yookassaWidgetContainer' });
    });

    test('виджет получает токен и return_url', async ({ page }) => {
      await installWidgetStub(page);
      await page.goto('/dashboard/');

      await page.evaluate(() =>
        (window as any).openYooKassaWidget('test-token', 'https://alenaproyoga.ru/shop/'),
      );
      await expect(page.getByTestId('yookassa-widget-modal')).toBeVisible();

      const log = await getWidgetLog(page);
      const created = log.find((e) => e.type === 'new');
      expect(created).toBeDefined();
      expect(created!.opts!.confirmation_token).toBe('test-token');
      expect(created!.opts!.return_url).toBe('https://alenaproyoga.ru/shop/');
    });

    test('крестик закрывает модалку и уничтожает виджет', async ({ page }) => {
      await installWidgetStub(page);
      await page.goto('/dashboard/');

      await page.evaluate(() =>
        (window as any).openYooKassaWidget('test-token', 'https://alenaproyoga.ru/shop/'),
      );
      await expect(page.getByTestId('yookassa-widget-modal')).toBeVisible();

      await page.getByTestId('yookassa-widget-close').click();
      await expect(page.getByTestId('yookassa-widget-modal')).toBeHidden();
      const log = await getWidgetLog(page);
      expect(log).toContainEqual({ type: 'destroy' });
    });

    test('клик по фону закрывает модалку и уничтожает виджет', async ({ page }) => {
      await installWidgetStub(page);
      await page.goto('/dashboard/');

      await page.evaluate(() =>
        (window as any).openYooKassaWidget('test-token', 'https://alenaproyoga.ru/shop/'),
      );
      await expect(page.getByTestId('yookassa-widget-modal')).toBeVisible();

      await page.getByTestId('yookassa-widget-modal').click({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('yookassa-widget-modal')).toBeHidden();
      const log = await getWidgetLog(page);
      expect(log).toContainEqual({ type: 'destroy' });
    });

    test('error_callback показывает уведомление об ошибке платежа', async ({ page }) => {
      await installWidgetStub(page);
      await page.goto('/dashboard/');

      await page.evaluate(() =>
        (window as any).openYooKassaWidget('test-token', 'https://alenaproyoga.ru/shop/'),
      );

      await page.evaluate(() => {
        const entry = (window as any).__widgetLog.find((e: any) => e.type === 'new');
        entry.opts.error_callback({ code: 'error' });
      });

      await expect(page.getByTestId('notification-modal')).toBeVisible();
      await expect(page.getByTestId('notification-message')).toContainText('Ошибка платежа');
    });
  });
});
