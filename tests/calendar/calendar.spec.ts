import { test, expect, BASE_URL } from '../fixtures/base';
import {
  loginAsStudent,
  loginAsAdmin,
  loginAsModerator,
  createCalendarEvent,
  deleteCalendarEvent,
  updateCalendarEvent,
  getCurrentUserInfo,
  getUserInfo,
  setAllowedTariffs,
  deleteUserSubscriptions,
  setBalance,
  cleanupEventsOnDate,
  enrollToEvent,
  registerNewUser,
  uniquePhone,
  getCsrfToken,
  deleteTestUser,
  purchaseSubscription,
  moveSessionToPast,
  expireSubscription,
  cancelEnrollment as cancelEnrollmentApi,
  setHallColors,
} from '../fixtures/helpers';
import {
  futureDate,
  waitForEvents,
  CLEAN_EVENT_DATE,
  navigateToCleanDate,
  navigateToDate,
  switchView,
  enroll,
  cancelEnrollment,
  setupEvent,
  teardownEvent,
  cleanDateEvents,
  getEventProp,
  openCreateModal,
  getAttendance,
  fetchEventsOnDate,
} from './helpers';
import {
  TARGET_DATE,
  navigateToView,
  assertForbidden,
  assertEventMovedTo,
  dragTimegridLater,
} from './drag-helpers';
import { getResolvedTestTariffs } from './helpers';

// Резолвимся на реальные тарифы БД при старте, чтобы тесты не зависели от
// конкретных id (тарифы в админке меняются/удаляются).
let TARIFF_GROUP_ID = 0;
let TARIFF_FORBIDDEN_ID = 0;
let LITE_ID = 0;
let PRO_ID = 0;
let LITE_SESSIONS = 0;
let PRO_SESSIONS = 0;
let LITE_SUBSCRIPTION_PRICE = 0;
let LITE_SESSION_PRICE = 0;
let GROUP_SESSIONS = 0;
let GROUP_SESSION_PRICE = 0;
let SPLIT_PRICE_FULL = 0;
let SPLIT_PRICE_HALF = 0;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  try {
    const t = await getResolvedTestTariffs(page);
    TARIFF_GROUP_ID = t.groupId;
    TARIFF_FORBIDDEN_ID = t.forbiddenId;
    LITE_ID = t.liteId;
    PRO_ID = t.proId;
    LITE_SESSIONS = t.liteSessions;
    PRO_SESSIONS = t.pro.subscription_sessions_count ?? 0;
    LITE_SUBSCRIPTION_PRICE = t.liteSubPrice;
    LITE_SESSION_PRICE = t.liteSessionPrice;
    GROUP_SESSIONS = t.groupSessions;
    GROUP_SESSION_PRICE = t.groupSessionPrice;
    SPLIT_PRICE_FULL = t.split.split_total_price;
    SPLIT_PRICE_HALF = t.split.price_per_person;
  } finally {
    await page.close();
  }
});

test.describe('Календарь — отображение и навигация', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/calendar/');
  });

  test.describe('Отображение', () => {
    test('страница календаря открывается', async ({ page }) => {
      await expect(page).toHaveURL(`${BASE_URL}calendar/`);
    });

    test('контейнер FullCalendar виден', async ({ page }) => {
      await expect(page.locator('#calendar')).toBeVisible();
    });

    test('легенда залов видна', async ({ page }) => {
      await expect(page.locator('.hall-legend')).toBeVisible();
    });

    test('панель инструментов FullCalendar видна', async ({ page }) => {
      await expect(page.locator('.fc-toolbar')).toBeVisible();
    });

    test('кнопка "Сегодня" видна', async ({ page }) => {
      await expect(page.locator('.fc-today-button')).toBeVisible();
    });

    test('кнопки переключения вида видны', async ({ page }) => {
      await expect(
        page.locator('.fc-button').filter({ hasText: /месяц|неделя|день/i }).first(),
      ).toBeVisible();
    });

    test('кнопки вперёд/назад видны', async ({ page }) => {
      await expect(page.locator('.fc-prev-button')).toBeVisible();
      await expect(page.locator('.fc-next-button')).toBeVisible();
    });
  });

  test.describe('Нижняя панель навигации', () => {
    test('кнопка "Главная" ведёт на дашборд', async ({ page }) => {
      await page.getByTestId('nav-home').click();
      await expect(page).toHaveURL(`${BASE_URL}dashboard/`);
    });

    test('кнопка "Магазин" ведёт в магазин', async ({ page }) => {
      await page.getByTestId('nav-shop').click();
      await expect(page).toHaveURL(`${BASE_URL}shop/`);
    });

    test('кнопка "Профиль" ведёт на профиль', async ({ page }) => {
      await page.getByTestId('nav-profile').click();
      await expect(page).toHaveURL(`${BASE_URL}profile/`);
    });

    test('кнопка "Расписание" активна', async ({ page }) => {
      await expect(page.getByTestId('nav-calendar')).toHaveClass(/active/);
    });
  });

  test.describe('Навигация по датам', () => {
    test('кнопка "Сегодня" подсвечивает текущую дату', async ({ page }) => {
      const todayCell = page.locator('.fc-day-today');
      if ((await todayCell.count()) > 0) {
        await expect(todayCell).toBeVisible();
      }
    });

    test('кнопка "Вперёд" кликабельна', async ({ page }) => {
      const nextBtn = page.locator('.fc-next-button');
      await expect(nextBtn).toBeEnabled();
      await nextBtn.click();
      await expect(nextBtn).toBeVisible();
    });

    test('кнопка "Назад" кликабельна после перехода вперёд', async ({ page }) => {
      await page.locator('.fc-next-button').click();
      const prevBtn = page.locator('.fc-prev-button');
      await expect(prevBtn).toBeEnabled();
      await prevBtn.click();
      await expect(prevBtn).toBeVisible();
    });
  });

  test.describe('Переключение вида', () => {
    test('кнопка "Месяц" показывает месячный вид', async ({ page }) => {
      const monthBtn = page.locator('.fc-button').filter({ hasText: /месяц/i });
      if (await monthBtn.isVisible()) {
        await monthBtn.click();
        await expect(page.locator('.fc-daygrid')).toBeVisible();
      }
    });

    test('кнопка "Неделя" показывает недельный вид', async ({ page }) => {
      const weekBtn = page.locator('.fc-button').filter({ hasText: /неделя/i });
      if (await weekBtn.isVisible()) {
        await weekBtn.click();
        await expect(page.locator('.fc-timegrid')).toBeVisible();
        await expect(page.locator('.fc-timegrid-col')).toHaveCount(8);
      }
    });

    test('кнопка "День" показывает дневной вид', async ({ page }) => {
      const dayBtn = page.locator('.fc-button').filter({ hasText: /день/i });
      if (await dayBtn.isVisible()) {
        await dayBtn.click();
        await expect(page.locator('.fc-timegrid')).toBeVisible();
        await expect(page.locator('.fc-timegrid-col')).toHaveCount(2);
      }
    });
  });

  test.describe('Модальные окна — скрыты по умолчанию', () => {
    test('модалка занятия скрыта', async ({ page }) => {
      await expect(page.locator('#eventModal')).toBeHidden();
    });

    test('модалка подтверждения удаления скрыта', async ({ page }) => {
      await expect(page.locator('#deleteConfirmModal')).toBeHidden();
    });

    test('модалка уведомлений скрыта', async ({ page }) => {
      await expect(page.getByTestId('notification-modal')).toBeHidden();
    });

    test('модалка подтверждения скрыта', async ({ page }) => {
      await expect(page.locator('#confirmModal')).toBeHidden();
    });
  });

  test.describe('Вкладки модального окна', () => {
    test('вкладки "Занятие" и "Запись" существуют в DOM', async ({ page }) => {
      await expect(page.getByTestId('tab-class')).toBeAttached();
      await expect(page.getByTestId('tab-attendance')).toBeAttached();
    });
  });
});



test.describe('Студент — взаимодействие с календарём', () => {
  let testEventId: number;

  test.beforeEach(async ({ page }) => {
    testEventId = await setupEvent(page);
    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await navigateToCleanDate(page);
  });

  test.afterEach(async ({ page }) => {
    await teardownEvent(page, testEventId);
  });

  test('событие отображается на календаре', async ({ page }) => {
    await expect(page.locator('.fc-event')).not.toHaveCount(0);
  });

  test('кликаю по событию — открывается модалка записи', async ({ page }) => {
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await expect(page.getByTestId('tab-class')).toBeHidden();
    await expect(page.getByTestId('tab-attendance')).toHaveClass(/active/);
  });

  test('модалка содержит информацию о занятии', async ({ page }) => {
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await expect(page.locator('#modalTitle')).toHaveText('Запись на занятие');
    await expect(page.getByTestId('tab-attendance')).toBeVisible();
    await expect(page.getByTestId('tab-attendance')).toHaveClass(/active/);
    await expect(page.locator('.attendance-list')).toContainText('Записанные клиенты');
    await expect(page.locator('.free-slots-info')).toBeVisible();
  });

  test('вкладка посещаемости доступна для студента', async ({ page }) => {
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await expect(page.getByTestId('tab-attendance')).toBeVisible();
    await expect(page.getByTestId('tab-attendance')).toHaveClass(/active/);
    await expect(page.getByTestId('save-attendance-btn')).toHaveCount(0);
    await expect(page.getByTestId('client-search-input')).toHaveCount(0);
    await expect(page.getByTestId('enroll-btn')).toBeVisible();
  });

  test('поиск клиентов недоступен студенту', async ({ page }) => {
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await expect(page.getByTestId('client-search-input')).toHaveCount(0);
    await expect(page.getByTestId('client-search-result')).toHaveCount(0);
    await expect(page.locator('.add-client-section')).toHaveCount(0);
  });

  test('студент не видит телефоны в списке посещаемости', async ({ page }) => {
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await enroll(page);

    await page.getByTestId('event-modal-close').click();
    await expect(page.locator('#eventModal')).toBeHidden();
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();

    await expect(page.locator('.attendance-item')).toHaveCount(1);
    await expect(page.locator('.client-phone')).toHaveCount(0);
  });

  test('повторное открытие модалки после записи показывает статус и счётчик мест', async ({ page }) => {
    // Короткое имя как для студента-зрителя: "Имя Ф." (views.py)
    const info = await getUserInfo(page, '+73333333333');
    const first = info.first_name || '';
    const last = info.last_name ? info.last_name[0] + '.' : '';
    const shortName = `${first} ${last}`.trim();

    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();

    // До записи: 10 свободных мест
    await expect(page.locator('.free-slots-info')).toContainText('10 из 10');

    // Запись
    await enroll(page);

    // Закрыть и открыть модалку снова
    await page.getByTestId('event-modal-close').click();
    await expect(page.locator('#eventModal')).toBeHidden();
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();

    // Статус "записан": отмена видна, запись скрыта, имя в списке, 9 из 10
    await expect(page.getByTestId('cancel-enrollment-btn')).toBeVisible();
    await expect(page.getByTestId('enroll-btn')).toBeHidden();
    await expect(page.locator('.attendance-item', { hasText: shortName })).toBeVisible();
    await expect(page.locator('.free-slots-info')).toContainText('9 из 10');

    // Отмена
    await cancelEnrollment(page);

    // Закрыть и открыть модалку снова
    await page.getByTestId('event-modal-close').click();
    await expect(page.locator('#eventModal')).toBeHidden();
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();

    // Статус "не записан": запись видна, отмена скрыта, 10 из 10
    await expect(page.getByTestId('enroll-btn')).toBeVisible();
    await expect(page.getByTestId('cancel-enrollment-btn')).toBeHidden();
    await expect(page.locator('.free-slots-info')).toContainText('10 из 10');
  });

  test('отмена отмены записи (кнопка Нет)', async ({ page }) => {
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await enroll(page);

    await page.getByTestId('cancel-enrollment-btn').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.getByTestId('confirm-cancel-btn').click();
    await expect(page.locator('#confirmModal')).toBeHidden();

    // Запись осталась: отмена видна, запись скрыта
    await expect(page.getByTestId('cancel-enrollment-btn')).toBeVisible();
    await expect(page.getByTestId('enroll-btn')).toBeHidden();
  });

  test('студент не видит форму редактирования', async ({ page }) => {
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await expect(page.getByTestId('tab-class')).toBeHidden();
    await expect(page.getByTestId('event-class-type')).toBeHidden();
    await expect(page.getByTestId('event-tariff')).toBeHidden();
    await expect(page.getByTestId('event-hall')).toBeHidden();
    await expect(page.getByTestId('event-save-btn')).toBeHidden();
    await expect(page.getByTestId('event-delete-btn')).toBeHidden();
  });


  test('кликаю по дате — модалка создания НЕ открывается для студента', async ({
    page,
  }) => {
    const dayCell = page.locator('.fc-daygrid-day').last();
    await dayCell.click({ force: true });
    await expect(page.locator('#eventModal')).toBeHidden();
  });
});

test.describe('Студент — несколько событий', () => {
  test('два события на одной дате отображаются', async ({ page }) => {
    const firstEventId = await setupEvent(page);
    const second = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${CLEAN_EVENT_DATE}T12:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: 3,
      max_participants_override: 10,
    });
    const secondEventId = second.event!.id;

    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await navigateToCleanDate(page);

    await expect(cleanDateEvents(page)).toHaveCount(2);

    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, firstEventId);
    await deleteCalendarEvent(page, secondEventId);
  });
});



test.describe('Студент — запись/отмена по представлениям', () => {
  let eventId: number;

  test.beforeEach(async ({ page }) => {
    eventId = await setupEvent(page);
    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
  });

  test.afterEach(async ({ page }) => {
    await teardownEvent(page, eventId);
  });

  test('запись на занятие и отмена записи в месячном виде', async ({ page }) => {
    await navigateToCleanDate(page);
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await enroll(page);
    await cancelEnrollment(page);
  });

  test('запись на занятие и отмена записи в недельном виде', async ({ page }) => {
    await switchView(page, 'неделя');
    await navigateToCleanDate(page);
    await page.locator(`.fc-timegrid-col[data-date="${CLEAN_EVENT_DATE}"] .fc-event`).first().click({ force: true });
    await expect(page.locator('#eventModal')).toBeVisible();
    await enroll(page);
    await cancelEnrollment(page);
  });

  test('запись на занятие и отмена записи в дневном виде', async ({ page }) => {
    await switchView(page, 'день');
    await navigateToCleanDate(page);
    await page.locator('.fc-timegrid-event').first().click({ force: true });
    await expect(page.locator('#eventModal')).toBeVisible();
    await enroll(page);
    await cancelEnrollment(page);
  });
});

test.describe('Студент — ограничения и граничные случаи', () => {

  test('запись при нулевом балансе показывает ошибку', async ({ page }) => {
    const eventId = await setupEvent(page, { tariff_id: TARIFF_GROUP_ID }); // групповой тариф, non-split → проверка баланса

    // Студент 3 (+72222222222): выдаём групповой тариф, обнуляем баланс (баланс и allowed в сид-данных нестабильны)
    const s3 = await getUserInfo(page, '+72222222222');
    await setAllowedTariffs(page, s3.id!, [TARIFF_GROUP_ID, 3]);
    await setBalance(page, s3.id!, 0);

    await page.context().clearCookies();
    await loginAsStudent(page, '2222222222');
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await navigateToCleanDate(page);

    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();

    await page.getByTestId('enroll-btn').click();
    await expect(page.getByTestId('notification-modal')).toBeVisible();
    await expect(page.getByTestId('notification-message')).toContainText('Недостаточно средств');

    await page.getByTestId('notification-ok-btn').click();
    await teardownEvent(page, eventId);
  });

  test('уведомление о недоступном тарифе отображается по центру экрана', async ({ page }) => {
    const eventId = await setupEvent(page, { tariff_id: TARIFF_FORBIDDEN_ID }); // тариф отсутствует в allowed_tariffs=[1,2,3] у студента

    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await navigateToCleanDate(page);

    await cleanDateEvents(page).first().click();

    const overlay = page.getByTestId('notification-modal');
    await expect(overlay).toBeVisible();

    await expect.poll(async () => {
      return overlay.evaluate(el => getComputedStyle(el).display);
    }).toBe('flex');

    await expect.poll(async () => {
      return overlay.evaluate(el => getComputedStyle(el).alignItems);
    }).toBe('center');

    await expect.poll(async () => {
      return overlay.evaluate(el => getComputedStyle(el).justifyContent);
    }).toBe('center');

    await expect(overlay.locator('.modal-card')).toBeVisible();

    await page.getByTestId('notification-ok-btn').click();
    await teardownEvent(page, eventId);
  });

  test('повторная запись на то же занятие недоступна', async ({ page }) => {
    const eventId = await setupEvent(page);

    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await navigateToCleanDate(page);

    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await page.getByTestId('enroll-btn').click();
    await expect(page.getByTestId('notification-modal')).toBeVisible();
    await expect(page.getByTestId('notification-message')).toContainText('Ждем вас');
    await page.getByTestId('notification-ok-btn').click();

    // После записи: кнопка отмены видна, кнопка записи скрыта
    await expect(page.getByTestId('cancel-enrollment-btn')).toBeVisible();
    await expect(page.getByTestId('enroll-btn')).toBeHidden();

    // Повторная запись через API отклоняется на бэке (unique session+client)
    const cookies = await page.context().cookies();
    const csrf = cookies.find((c) => c.name === 'csrftoken')?.value || '';
    const dup = await page.request.post(`/api/calendar/events/${eventId}/enroll/`, {
      data: {},
      headers: { 'X-CSRFToken': csrf },
    });
    expect(dup.status()).toBe(400);
    const dupData = await dup.json();
    expect(dupData.error).toContain('Вы уже записаны на это занятие');

    await teardownEvent(page, eventId);
  });

  test('запись при заполненных местах показывает "нет свободных мест"', async ({ page }) => {
    const eventId = await setupEvent(page, { max_participants_override: 1 });

    // Тестовый студент занимает единственное место
    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await navigateToCleanDate(page);

    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await page.getByTestId('enroll-btn').click();
    await expect(page.getByTestId('notification-modal')).toBeVisible();
    await expect(page.getByTestId('notification-message')).toContainText('Ждем вас');
    await page.getByTestId('notification-ok-btn').click();

    // Студент 4 пытается записаться, когда мест нет
    await page.context().clearCookies();
    await loginAsStudent(page, '2222222222');
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await navigateToCleanDate(page);

    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();

    await expect(page.getByTestId('enroll-btn')).toBeHidden();
    await expect(page.locator('.no-free-slots')).toBeVisible();

    await teardownEvent(page, eventId);
  });

  test('отмена не видна в UI и отклоняется API, если студент не записан', async ({ page }) => {
    const eventId = await setupEvent(page);

    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await navigateToCleanDate(page);

    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();

    await expect(page.getByTestId('cancel-enrollment-btn')).toBeHidden();
    await expect(page.getByTestId('enroll-btn')).toBeVisible();

    // Отмена через API тоже отклоняется на бэке (записи нет)
    const cookies = await page.context().cookies();
    const csrf = cookies.find((c) => c.name === 'csrftoken')?.value || '';
    const cancelRes = await page.request.post(`/api/calendar/events/${eventId}/cancel-enrollment/`, {
      data: {},
      headers: { 'X-CSRFToken': csrf },
    });
    expect(cancelRes.status()).toBe(400);
    const cancelData = await cancelRes.json();
    expect(cancelData.error).toContain('Вы не записаны на это занятие');

    await teardownEvent(page, eventId);
  });

  test('запись и отмена недоступны менее чем за 4 часа до занятия', async ({ page }) => {
    const soonStart = (() => {
      const d = new Date();
      d.setHours(d.getHours() + 1, 0, 0, 0);
      const Y = d.getFullYear();
      const M = String(d.getMonth() + 1).padStart(2, '0');
      const D = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${Y}-${M}-${D}T${h}:${m}`;
    })();

    const eventId = await setupEvent(page, { start: soonStart });

    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });

    // Переходим к дате события
    const eventDate = soonStart.slice(0, 10);
    await page.evaluate((date) => {
      const cal = (window as any).calendar;
      if (cal && cal.gotoDate) cal.gotoDate(date);
    }, eventDate);
    await waitForEvents(page);

    // Кликаем по событию по уникальному времени начала
    const eventTime = soonStart.slice(11, 16); // "ЧЧ:ММ"
    await page.locator(`.fc-daygrid-day[data-date="${eventDate}"] .fc-event`).filter({ hasText: eventTime }).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();

    // Переключаемся на вкладку посещаемости
    await page.getByTestId('tab-attendance').click();

    // Кнопка записи должна быть скрыта — ограничение 4 часа
    await expect(page.getByTestId('enroll-btn')).toBeHidden();
    await expect(page.getByTestId('cancel-enrollment-btn')).toBeHidden();

    // Очистка
    await teardownEvent(page, eventId);
  });

  test.describe('Списание и возврат средств', () => {
    const STUDENT_ID = 5;

    test('списание с баланса при записи и возврат при отмене', async ({ page }) => {
      // Setup: админ создаёт событие с групповым тарифом, добавляет тариф студенту
      const eventId = await setupEvent(page, { tariff_id: TARIFF_GROUP_ID });
      // Убираем подписки, оставшиеся от прерванных прогонов
      await deleteUserSubscriptions(page, STUDENT_ID);
      await setAllowedTariffs(page, STUDENT_ID, [TARIFF_GROUP_ID, 3]);

      // Логинимся как студент, проверяем исходный баланс
      await page.context().clearCookies();
      await loginAsStudent(page);
      await page.goto('/calendar/');
      await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
      await waitForEvents(page);
      await navigateToCleanDate(page);

      const before = await getCurrentUserInfo(page);
      const initialBalance = parseFloat(before.balance);

      // Стоимость занятия берём с бэка (столько и спишет API)
      const sessionPrice = await getEventProp(page, eventId, 'price');
      expect(sessionPrice).not.toBeNull();

      // Запись
      await cleanDateEvents(page).first().click();
      await expect(page.locator('#eventModal')).toBeVisible();
      await page.getByTestId('enroll-btn').click();
      await expect(page.getByTestId('notification-modal')).toBeVisible();
      await expect(page.getByTestId('notification-message')).toContainText('Ждем вас');
      await page.getByTestId('notification-ok-btn').click();

      // Проверяем: баланс уменьшился на стоимость занятия
      const afterEnroll = await getCurrentUserInfo(page);
      const balanceAfterEnroll = parseFloat(afterEnroll.balance);
      expect(balanceAfterEnroll).toBe(initialBalance - sessionPrice!);

      // Отмена записи
      await expect(page.getByTestId('cancel-enrollment-btn')).toBeVisible();
      await page.getByTestId('cancel-enrollment-btn').click();
      await expect(page.locator('#confirmModal')).toBeVisible();
      await page.getByTestId('confirm-ok-btn').click();
      await expect(page.getByTestId('notification-modal')).toBeVisible();
      await expect(page.getByTestId('notification-message')).toContainText('отменена');
      await page.getByTestId('notification-ok-btn').click();

      // Проверяем: баланс возвращён
      const afterCancel = await getCurrentUserInfo(page);
      const balanceAfterCancel = parseFloat(afterCancel.balance);
      expect(balanceAfterCancel).toBe(initialBalance);

      // Очистка: сброс allowed_tariffs, удаление события
      await page.context().clearCookies();
      await loginAsAdmin(page);
      await page.goto('/calendar/');
      await setAllowedTariffs(page, STUDENT_ID, [3]);
      await deleteCalendarEvent(page, eventId);
    });

    test('списание из абонемента при записи и возврат при отмене', async ({ page }) => {
      // Setup: админ создаёт событие с групповым тарифом, добавляет тариф студенту
      const eventId = await setupEvent(page, { tariff_id: TARIFF_GROUP_ID });
      // Убираем подписки, оставшиеся от прерванных прогонов
      await deleteUserSubscriptions(page, STUDENT_ID);
      await setAllowedTariffs(page, STUDENT_ID, [TARIFF_GROUP_ID, 3]);
      // Обеспечиваем достаточный баланс для покупки абонемента (4500 руб)
      await setBalance(page, STUDENT_ID, 10000);

      // Логинимся как студент
      await page.context().clearCookies();
      await loginAsStudent(page);
      await page.goto('/calendar/');
      await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
      await waitForEvents(page);
      await navigateToCleanDate(page);

      const before = await (await page.request.post('/api/auth/test/my-info/', { data: {} })).json();
      const initialBalance = parseFloat(before.balance);
      expect(initialBalance).toBe(10000);
      expect(before.subscription).toBeNull();

      // Стоимость абонемента берём с бэка (столько и спишет API при покупке)
      const subscriptionPrice = await getEventProp(page, eventId, 'subscription_price');
      expect(subscriptionPrice).not.toBeNull();

      // Идём в shop и покупаем абонемент на групповой тариф
      await page.goto('/shop/');
      await page.waitForSelector('.subscription-card', { timeout: 10000 });
      const purchaseBtn = page.locator('[data-test-id="purchase-subscription-btn"]').first();
      await purchaseBtn.click();
      await expect(page.getByTestId('purchase-modal')).toBeVisible();
      const purchaseResponse = page.waitForResponse(
        (r) => r.url().includes('/api/purchase-subscription/') && r.request().method() === 'POST',
        { timeout: 10000 },
      );
      await page.getByTestId('confirm-purchase-btn').click();
      const purchaseData = await (await purchaseResponse).json();
      expect(purchaseData.success).toBe(true);

      // Проверяем: баланс уменьшился на стоимость абонемента (читаем через API, не зависит от перезагрузки)
      const afterPurchase = await (await page.request.post('/api/auth/test/my-info/', { data: {} })).json();
      const balanceAfterPurchase = parseFloat(afterPurchase.balance);
      expect(balanceAfterPurchase).toBe(initialBalance - subscriptionPrice!);
      expect(afterPurchase.subscription).not.toBeNull();
      expect(afterPurchase.subscription!.sessions_total).toBeGreaterThan(0);
      expect(afterPurchase.subscription!.sessions_remaining).toBe(afterPurchase.subscription!.sessions_total);

      const initialSessions = afterPurchase.subscription!.sessions_remaining;

      // Идём в календарь и записываемся
      await page.goto('/calendar/');
      await waitForEvents(page);
      await navigateToCleanDate(page);

      await cleanDateEvents(page).first().click();
      await expect(page.locator('#eventModal')).toBeVisible();
      await page.getByTestId('enroll-btn').click();
      await expect(page.getByTestId('notification-modal')).toBeVisible();
      await expect(page.getByTestId('notification-message')).toContainText('Ждем вас');
      await page.getByTestId('notification-ok-btn').click();

      // Проверяем: баланс не изменился, занятий в абонементе стало на 1 меньше
      const afterEnroll = await (await page.request.post('/api/auth/test/my-info/', { data: {} })).json();
      expect(parseFloat(afterEnroll.balance)).toBe(balanceAfterPurchase);
      expect(afterEnroll.subscription!.sessions_remaining).toBe(initialSessions - 1);

      // Отмена записи
      await expect(page.getByTestId('cancel-enrollment-btn')).toBeVisible();
      await page.getByTestId('cancel-enrollment-btn').click();
      await expect(page.locator('#confirmModal')).toBeVisible();
      await page.getByTestId('confirm-ok-btn').click();
      await expect(page.getByTestId('notification-modal')).toBeVisible();
      await expect(page.getByTestId('notification-message')).toContainText('отменена');
      await page.getByTestId('notification-ok-btn').click();

      // Проверяем: баланс всё ещё не изменился, занятия в абонементе восстановлены
      const afterCancel = await (await page.request.post('/api/auth/test/my-info/', { data: {} })).json();
      expect(parseFloat(afterCancel.balance)).toBe(balanceAfterPurchase);
      expect(afterCancel.subscription!.sessions_remaining).toBe(initialSessions);

      // Очистка: удаление подписки, сброс тарифов, удаление события
      await page.context().clearCookies();
      await loginAsAdmin(page);
      await page.goto('/calendar/');
      await deleteUserSubscriptions(page, STUDENT_ID);
      await setAllowedTariffs(page, STUDENT_ID, [3]);
      await deleteCalendarEvent(page, eventId);
    });
  });
});

test.describe('Удаление занятия возвращает средства', () => {
  const STUDENT_ID = 5;

  test('удаление одиночного занятия возвращает средства записанному студенту', async ({ page }) => {
    const eventId = await setupEvent(page, { tariff_id: TARIFF_GROUP_ID });
    await deleteUserSubscriptions(page, STUDENT_ID);
    await setAllowedTariffs(page, STUDENT_ID, [TARIFF_GROUP_ID, 3]);

    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await navigateToCleanDate(page);

    const before = await getCurrentUserInfo(page);
    const initialBalance = parseFloat(before.balance);
    const sessionPrice = await getEventProp(page, eventId, 'price');
    expect(sessionPrice).not.toBeNull();

    // Запись — списание с баланса
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await page.getByTestId('enroll-btn').click();
    await expect(page.getByTestId('notification-modal')).toBeVisible();
    await expect(page.getByTestId('notification-message')).toContainText('Ждем вас');
    await page.getByTestId('notification-ok-btn').click();

    const afterEnroll = await getCurrentUserInfo(page);
    expect(parseFloat(afterEnroll.balance)).toBe(initialBalance - sessionPrice!);

    // Админ удаляет занятие
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, eventId);

    // Средства вернулись на баланс
    await page.context().clearCookies();
    await loginAsStudent(page);
    const afterDelete = await getCurrentUserInfo(page);
    expect(parseFloat(afterDelete.balance)).toBe(initialBalance);

    // Очистка: сброс разрешённых тарифов
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await setAllowedTariffs(page, STUDENT_ID, [3]);
  });

  test('удаление серии возвращает средства со всех занятий', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/calendar/');

    // Серия из 2 занятий с интервалом в неделю
    const start = futureDate(48, 9);
    const baseDate = start.slice(0, 10);
    const nextDate = (() => {
      const d = new Date(start);
      d.setDate(d.getDate() + 7);
      const Y = d.getFullYear();
      const M = String(d.getMonth() + 1).padStart(2, '0');
      const D = String(d.getDate()).padStart(2, '0');
      return `${Y}-${M}-${D}`;
    })();
    await cleanupEventsOnDate(page, baseDate);
    await cleanupEventsOnDate(page, nextDate);

    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
      is_recurring: true,
      recurring_count: 2,
    });
    const ids = result.recurring_events!.map((e) => Number(e.id));
    expect(ids).toHaveLength(2);
    const mainId = ids[0];
    const secondId = ids[1];

    await deleteUserSubscriptions(page, STUDENT_ID);
    await setAllowedTariffs(page, STUDENT_ID, [TARIFF_GROUP_ID, 3]);

    // Студент записывается на оба занятия серии
    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await page.evaluate((d) => {
      const cal = (window as any).calendar;
      if (cal && cal.gotoDate) cal.gotoDate(d);
    }, baseDate);
    await waitForEvents(page);

    const before = await getCurrentUserInfo(page);
    const initialBalance = parseFloat(before.balance);
    const price = await getEventProp(page, mainId, 'price');
    expect(price).not.toBeNull();

    await enrollToEvent(page, mainId);
    await enrollToEvent(page, secondId);

    const afterEnroll = await getCurrentUserInfo(page);
    expect(parseFloat(afterEnroll.balance)).toBe(initialBalance - 2 * price!);

    // Админ удаляет всю серию
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, mainId);

    // Средства вернулись со всех занятий серии
    await page.context().clearCookies();
    await loginAsStudent(page);
    const afterDelete = await getCurrentUserInfo(page);
    expect(parseFloat(afterDelete.balance)).toBe(initialBalance);

    // Очистка: сброс разрешённых тарифов
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await setAllowedTariffs(page, STUDENT_ID, [3]);
  });
});

test.describe('Запись других пользователей', () => {

  test('отмена своей записи не отменяет запись другого студента', async ({ page }) => {
    const eventId = await setupEvent(page, { tariff_id: TARIFF_GROUP_ID });

    // Студент A
    const phoneA = uniquePhone();
    await registerNewUser(page, phoneA);
    const infoA = await getUserInfo(page, phoneA);
    expect(infoA.id).toBeDefined();
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await setAllowedTariffs(page, infoA.id!, [TARIFF_GROUP_ID]);
    await setBalance(page, infoA.id!, 5000);

    await page.context().clearCookies();
    await loginAsStudent(page, phoneA);
    await enrollToEvent(page, eventId);

    // Студент B
    const phoneB = uniquePhone();
    await page.context().clearCookies();
    await registerNewUser(page, phoneB);
    const infoB = await getUserInfo(page, phoneB);
    expect(infoB.id).toBeDefined();
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await setAllowedTariffs(page, infoB.id!, [TARIFF_GROUP_ID]);
    await setBalance(page, infoB.id!, 5000);

    await page.context().clearCookies();
    await loginAsStudent(page, phoneB);
    await enrollToEvent(page, eventId);
    const balanceB = parseFloat((await getUserInfo(page, phoneB)).balance!);
    expect(balanceB).toBeLessThan(5000);

    // A отменяет СВОЮ запись
    await page.context().clearCookies();
    await loginAsStudent(page, phoneA);
    const csrf = await getCsrfToken(page);
    const cancelRes = await page.request.post(`/api/calendar/events/${eventId}/cancel-enrollment/`, {
      data: {},
      headers: { 'X-CSRFToken': csrf },
    });
    expect(cancelRes.status()).toBe(200);
    expect((await cancelRes.json()).success).toBe(true);

    // Запись B не затронута: он всё ещё в списке с оплаченным статусом
    const att = await page.request.get(`/api/calendar/events/${eventId}/attendance/`);
    const attData = await att.json();
    const bEntry = attData.attendances.find((a: any) => a.client_id === infoB.id);
    expect(bEntry).toBeDefined();
    expect(['paid', 'confirmed']).toContain(bEntry.status);
    expect(attData.attendances.some((a: any) => a.client_id === infoA.id)).toBe(false);

    // Баланс B не изменился — возврат не задел чужую запись
    const balanceB2 = parseFloat((await getUserInfo(page, phoneB)).balance!);
    expect(balanceB2).toBe(balanceB);

    // Очистка
    await deleteTestUser(page, phoneA);
    await deleteTestUser(page, phoneB);
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, eventId);
  });
});

test.describe('Сплит-тариф', () => {
  test('запись на сплит не списывает средства, отмена до дедлайна без штрафа', async ({ page }) => {
    const eventId = await setupEvent(page); // дефолтный тариф 3 — сплит

    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await navigateToCleanDate(page);

    const before = await getCurrentUserInfo(page);
    const initialBalance = parseFloat(before.balance);

    // Запись на сплит — средства не списываются
    await cleanDateEvents(page).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await page.getByTestId('enroll-btn').click();
    await expect(page.getByTestId('notification-modal')).toBeVisible();
    await expect(page.getByTestId('notification-message')).toContainText('Ждем вас');
    await page.getByTestId('notification-ok-btn').click();

    const afterEnroll = await getCurrentUserInfo(page);
    expect(parseFloat(afterEnroll.balance)).toBe(initialBalance);

    // Отмена до дедлайна — без штрафа
    await expect(page.getByTestId('cancel-enrollment-btn')).toBeVisible();
    await page.getByTestId('cancel-enrollment-btn').click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.getByTestId('confirm-ok-btn').click();
    await expect(page.getByTestId('notification-modal')).toBeVisible();
    await expect(page.getByTestId('notification-message')).toContainText('отменена');
    await page.getByTestId('notification-ok-btn').click();

    const afterCancel = await getCurrentUserInfo(page);
    expect(parseFloat(afterCancel.balance)).toBe(initialBalance);

    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, eventId);
  });
});

test.describe('Админ — краевые случаи посещаемости', () => {
  const STUDENT_ID = 5;
  const STUDENT_PHONE = '+73333333333';

  test('повторное удаление уже отменённой записи возвращает ошибку', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/calendar/');

    const start = futureDate(48, 9);
    const startDate = start.slice(0, 10);
    await cleanupEventsOnDate(page, startDate);
    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
    });
    const eventId = result.event!.id;

    await deleteUserSubscriptions(page, STUDENT_ID);
    await setAllowedTariffs(page, STUDENT_ID, [TARIFF_GROUP_ID, 3]);
    const preBalance = parseFloat((await getUserInfo(page, STUDENT_PHONE)).balance!);
    await setBalance(page, STUDENT_ID, 10000);

    const csrf = await getCsrfToken(page);

    // Создаём запись
    const addRes = await page.request.post(`/api/calendar/events/${eventId}/attendance/add/`, {
      data: { client_id: STUDENT_ID },
      headers: { 'X-CSRFToken': csrf },
    });
    expect((await addRes.json()).success).toBe(true);

    // Первое удаление — успех
    const firstRemove = await page.request.post(`/api/calendar/events/${eventId}/attendance/remove/`, {
      data: { client_id: STUDENT_ID },
      headers: { 'X-CSRFToken': csrf },
    });
    expect((await firstRemove.json()).success).toBe(true);

    // Второе удаление — ошибка
    const secondRemove = await page.request.post(`/api/calendar/events/${eventId}/attendance/remove/`, {
      data: { client_id: STUDENT_ID },
      headers: { 'X-CSRFToken': csrf },
    });
    expect(secondRemove.status()).toBe(400);
    const errData = await secondRemove.json();
    expect(errData.error).toContain('уже отменена');

    // Очистка: сброс тарифов, удаление события, возврат исходного баланса
    await setAllowedTariffs(page, STUDENT_ID, [3]);
    await deleteCalendarEvent(page, eventId);
    await setBalance(page, STUDENT_ID, preBalance);
  });

  test('после удаления администратором можно записать клиента снова (повторное списание)', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/calendar/');

    const start = futureDate(48, 10);
    const startDate = start.slice(0, 10);
    await cleanupEventsOnDate(page, startDate);
    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
    });
    const eventId = result.event!.id;

    await deleteUserSubscriptions(page, STUDENT_ID);
    await setAllowedTariffs(page, STUDENT_ID, [TARIFF_GROUP_ID, 3]);
    const preBalance = parseFloat((await getUserInfo(page, STUDENT_PHONE)).balance!);
    await setBalance(page, STUDENT_ID, 10000);

    const csrf = await getCsrfToken(page);
    const initialBalance = parseFloat((await getUserInfo(page, STUDENT_PHONE)).balance!);

    // Добавление: списание
    await page.request.post(`/api/calendar/events/${eventId}/attendance/add/`, {
      data: { client_id: STUDENT_ID },
      headers: { 'X-CSRFToken': csrf },
    });
    const balanceAfterAdd = parseFloat((await getUserInfo(page, STUDENT_PHONE)).balance!);
    const price = initialBalance - balanceAfterAdd;
    expect(price).toBeGreaterThan(0);

    // Удаление: возврат
    await page.request.post(`/api/calendar/events/${eventId}/attendance/remove/`, {
      data: { client_id: STUDENT_ID },
      headers: { 'X-CSRFToken': csrf },
    });
    const balanceAfterRemove = parseFloat((await getUserInfo(page, STUDENT_PHONE)).balance!);
    expect(balanceAfterRemove).toBe(initialBalance);

    // Повторное добавление: снова списание
    await page.request.post(`/api/calendar/events/${eventId}/attendance/add/`, {
      data: { client_id: STUDENT_ID },
      headers: { 'X-CSRFToken': csrf },
    });
    const balanceAfterReAdd = parseFloat((await getUserInfo(page, STUDENT_PHONE)).balance!);
    expect(balanceAfterReAdd).toBe(initialBalance - price);

    // Очистка: удаление события возвращает средства за повторную запись, сброс тарифов и баланса
    await setAllowedTariffs(page, STUDENT_ID, [3]);
    await deleteCalendarEvent(page, eventId);
    await setBalance(page, STUDENT_ID, preBalance);
  });

  test('обновление посещаемости не меняет отменённые записи', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/calendar/');

    const start = futureDate(48, 11);
    const startDate = start.slice(0, 10);
    await cleanupEventsOnDate(page, startDate);
    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
    });
    const eventId = result.event!.id;

    await deleteUserSubscriptions(page, STUDENT_ID);
    await setAllowedTariffs(page, STUDENT_ID, [TARIFF_GROUP_ID, 3]);
    const preBalance = parseFloat((await getUserInfo(page, STUDENT_PHONE)).balance!);
    await setBalance(page, STUDENT_ID, 10000);

    const csrf = await getCsrfToken(page);

    // Запись + отмена
    const addRes = await page.request.post(`/api/calendar/events/${eventId}/attendance/add/`, {
      data: { client_id: STUDENT_ID },
      headers: { 'X-CSRFToken': csrf },
    });
    expect((await addRes.json()).success).toBe(true);

    const removeRes = await page.request.post(`/api/calendar/events/${eventId}/attendance/remove/`, {
      data: { client_id: STUDENT_ID },
      headers: { 'X-CSRFToken': csrf },
    });
    expect((await removeRes.json()).success).toBe(true);

    // Отменённая запись не видна в списке посещаемости
    let att = await getAttendance(page, eventId);
    expect(att.attendances).toHaveLength(0);

    // Повторная запись — новая активная запись
    const reAddRes = await page.request.post(`/api/calendar/events/${eventId}/attendance/add/`, {
      data: { client_id: STUDENT_ID },
      headers: { 'X-CSRFToken': csrf },
    });
    expect((await reAddRes.json()).success).toBe(true);

    // update с пустым списком: активная запись → no_show, отменённая остаётся отменённой
    const updateRes = await page.request.post(`/api/calendar/events/${eventId}/attendance/update/`, {
      data: { attended_clients: [] },
      headers: { 'X-CSRFToken': csrf },
    });
    expect(updateRes.status()).toBe(200);
    expect((await updateRes.json()).success).toBe(true);

    att = await getAttendance(page, eventId);
    expect(att.attendances).toHaveLength(1);
    expect(att.attendances[0].status).toBe('no_show');

    // Очистка: сброс тарифов, удаление события, возврат исходного баланса
    await setAllowedTariffs(page, STUDENT_ID, [3]);
    await deleteCalendarEvent(page, eventId);
    await setBalance(page, STUDENT_ID, preBalance);
  });
});

test.describe('Администратор — управление календарём', () => {
  const createdIds: number[] = [];
  const STUDENT_ID = 5; // тестовый студент 3333333333

  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
  });

  test.afterEach(async ({ page }) => {
    for (const id of createdIds) {
      await deleteCalendarEvent(page, id);
    }
    createdIds.length = 0;
  });

  test('кликаю по дате — открывается модалка создания', async ({ page }) => {
    await openCreateModal(page, 15);
    await expect(page.locator('#modalTitle')).toHaveText('Новое занятие');
    await expect(page.getByTestId('event-save-btn')).toBeVisible();
    await expect(page.getByTestId('event-delete-btn')).toBeHidden();
  });

  test('создание занятия через форму', async ({ page }) => {
    await openCreateModal(page, 16);

    await page.getByTestId('event-class-type').selectOption('1');
    await page.getByTestId('event-start-hour').selectOption('10');
    await page.getByTestId('event-start-minute').selectOption('00');
    await page.getByTestId('event-hall').selectOption('2');
    await page.getByTestId('event-tariff').selectOption(String(TARIFF_GROUP_ID));
    await page.getByTestId('event-save-btn').click();
    await expect(page.locator('#eventModal')).toBeHidden();
    createdIds.push(
      ...((await page.evaluate(() => {
        const evts = (window as any).calendar?.getEvents();
        return evts ? evts.map((e: any) => parseInt(e.id)) : [];
      })) || []),
    );
  });

  test('предупреждение при сохранении без тарифа', async ({ page }) => {
    await openCreateModal(page, 17);

    await page.getByTestId('event-class-type').selectOption('1');
    await page.getByTestId('event-tariff').selectOption('');
    await expect(page.locator('#tariffWarning')).toBeHidden();

    const createRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/calendar/events/create/') && req.method() === 'POST') {
        createRequests.push(req.url());
      }
    });

    await page.getByTestId('event-save-btn').click();

    // Модалка остаётся открытой, предупреждение видно, у тарифа красная рамка
    await expect(page.locator('#eventModal')).toBeVisible();
    await expect(page.locator('#tariffWarning')).toBeVisible();
    await expect(page.locator('#tariffWarning')).toContainText('Тариф не выбран');
    await expect(page.getByTestId('event-tariff')).toHaveCSS('border-color', 'rgb(220, 53, 69)');

    // Запрос на создание не отправлялся
    expect(createRequests).toHaveLength(0);

    // После выбора тарифа предупреждение и красная рамка исчезают
    await page.getByTestId('event-tariff').selectOption(String(TARIFF_GROUP_ID));
    await expect(page.locator('#tariffWarning')).toBeHidden();
    await expect(page.getByTestId('event-tariff')).not.toHaveCSS('border-color', 'rgb(220, 53, 69)');
  });

  test('дефолты формы создания занятия', async ({ page }) => {
    await openCreateModal(page, 19);

    // Селекты непустые: плейсхолдер + хотя бы одна реальная опция
    await expect(page.getByTestId('event-class-type')).toContainText('Выберите тип занятия');
    await expect(page.getByTestId('event-hall')).toContainText('Не выбран');
    await expect(page.getByTestId('event-tariff')).toContainText('Выберите тариф');
    expect(await page.getByTestId('event-class-type').locator('option').count()).toBeGreaterThan(1);
    expect(await page.getByTestId('event-hall').locator('option').count()).toBeGreaterThan(1);
    expect(await page.getByTestId('event-tariff').locator('option').count()).toBeGreaterThan(1);

    // Время: часы 08-20, минуты 00-50 с шагом 10
    const hours = await page.getByTestId('event-start-hour').locator('option').evaluateAll(
      (opts) => opts.map((o) => (o as HTMLOptionElement).value),
    );
    expect(hours).toEqual(['08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20']);
    const minutes = await page.getByTestId('event-start-minute').locator('option').evaluateAll(
      (opts) => opts.map((o) => (o as HTMLOptionElement).value),
    );
    expect(minutes).toEqual(['00', '10', '20', '30', '40', '50']);

    // Дефолтные значения полей
    await expect(page.getByTestId('event-duration')).toHaveValue('60');
    await expect(page.getByTestId('event-max-participants')).toHaveValue('10');

    // Кнопки вместимости 2-10
    await expect(page.getByTestId('capacity-btn')).toHaveCount(9);
    await expect(page.getByTestId('capacity-btn').first()).toHaveAttribute('data-value', '2');

    // Повторение выключено по умолчанию
    await expect(page.getByTestId('event-recurring')).not.toBeChecked();
    await expect(page.locator('#recurringCountGroup')).toBeHidden();
  });

  test('кнопки вместимости 2-10 меняют значение в поле', async ({ page }) => {
    await openCreateModal(page, 20);

    const maxParticipantsInput = page.getByTestId('event-max-participants');
    for (let v = 2; v <= 10; v++) {
      const btn = page.locator(`[data-test-id="capacity-btn"][data-value="${v}"]`);
      await btn.click();
      await expect(maxParticipantsInput).toHaveValue(String(v));
      await expect(btn).toHaveClass(/active/);
    }

    // Активна ровно одна кнопка
    await page.locator('[data-test-id="capacity-btn"][data-value="5"]').click();
    await expect(page.locator('[data-test-id="capacity-btn"][data-value="5"]')).toHaveClass(/active/);
    await expect(page.locator('[data-test-id="capacity-btn"][data-value="3"]')).not.toHaveClass(/active/);

    // Ручной ввод в поле снимает активный класс со всех кнопок
    await maxParticipantsInput.fill('7');
    await expect(maxParticipantsInput).toHaveValue('7');
    await expect(page.locator('[data-test-id="capacity-btn"][data-value="5"]')).not.toHaveClass(/active/);
  });

  test('создание серии занятий', async ({ page }) => {
    await openCreateModal(page, 18);

    await page.getByTestId('event-class-type').selectOption('1');
    await page.getByTestId('event-start-hour').selectOption('10');
    await page.getByTestId('event-start-minute').selectOption('00');
    await page.getByTestId('event-hall').selectOption('2');
    await page.getByTestId('event-tariff').selectOption(String(TARIFF_GROUP_ID));

    await page.getByTestId('event-recurring').check();
    await expect(page.locator('#recurringCountGroup')).toBeVisible();

    const createResponse = page.waitForResponse(
      (r) => r.url().includes('/api/calendar/events/create/') && r.request().method() === 'POST',
      { timeout: 10000 },
    );
    await page.getByTestId('event-save-btn').click();
    await expect(page.locator('#eventModal')).toBeHidden();

    const data = await (await createResponse).json();
    expect(data.success).toBe(true);
    expect(data.recurring_events).toHaveLength(4);
    const ids = data.recurring_events.map((e: any) => Number(e.id));
    expect(new Set(ids).size).toBe(4);
    // Основное событие в ответе не содержит recurrence_id — только последующие недельные
    for (const e of data.recurring_events.slice(1)) {
      expect(e.recurrence_id).toBeTruthy();
      expect(e.is_recurring).toBe(true);
    }
    // Достаточно главного события — удаление каскадом зачистит всю серию
    createdIds.push(ids[0]);
  });

  test('кликаю по событию — открывается модалка редактирования', async ({ page }) => {
    const start = futureDate(48, 10);
    const startDate = start.slice(0, 10);
    await cleanupEventsOnDate(page, startDate);
    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
    });
    createdIds.push(result.event!.id);
    await navigateToDate(page, startDate);

    await page.locator(`.fc-daygrid-day[data-date="${startDate}"] .fc-event`).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await expect(page.locator('#modalTitle')).toHaveText('Редактировать занятие');
    await expect(page.getByTestId('event-save-btn')).toBeVisible();
    await expect(page.getByTestId('event-delete-btn')).toBeVisible();
  });

  test('редактирование занятия через форму сохраняется на бэке', async ({ page }) => {
    const start = futureDate(48, 14);
    const startDate = start.slice(0, 10);
    await cleanupEventsOnDate(page, startDate);
    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
    });
    const eventId = result.event!.id;
    createdIds.push(eventId);

    await navigateToDate(page, startDate);

    await page.locator(`.fc-daygrid-day[data-date="${startDate}"] .fc-event`).first().click();
    await expect(page.locator('#modalTitle')).toHaveText('Редактировать занятие');

    await page.getByTestId('event-duration').fill('90');
    await page.locator('[data-test-id="capacity-btn"][data-value="5"]').click();

    const updateResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/calendar/events/${eventId}/`) && r.request().method() === 'PUT',
      { timeout: 10000 },
    );
    await page.getByTestId('event-save-btn').click();
    await expect(page.locator('#eventModal')).toBeHidden();

    const updateData = await (await updateResponse).json();
    expect(updateData.success).toBe(true);

    await waitForEvents(page);
    expect(await getEventProp(page, eventId, 'duration')).toBe(90);
    expect(await getEventProp(page, eventId, 'max_participants_override')).toBe(5);
  });

  test('удаление занятия через интерфейс', async ({ page }) => {
    const start = futureDate(48, 14);
    const startDate = start.slice(0, 10);
    await cleanupEventsOnDate(page, startDate);
    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
    });
    const eventId = result.event!.id;
    await navigateToDate(page, startDate);

    await page.locator(`.fc-daygrid-day[data-date="${startDate}"] .fc-event`).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();

    await page.getByTestId('event-delete-btn').click();
    await expect(page.locator('#eventModal')).toBeHidden();
    await expect(page.locator(`.fc-daygrid-day[data-date="${startDate}"] .fc-event`)).toHaveCount(0);
  });

  test('удаление серии занятий через интерфейс', async ({ page }) => {
    const start = futureDate(48, 16);
    const startDate = start.slice(0, 10);
    await cleanupEventsOnDate(page, startDate);
    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
      is_recurring: true,
      recurring_count: 4,
    });
    const ids = result.recurring_events!.map((e) => Number(e.id));
    expect(ids).toHaveLength(4);
    const mainId = ids[0];

    await navigateToDate(page, startDate);

    await page.locator(`.fc-daygrid-day[data-date="${startDate}"] .fc-event`).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await page.getByTestId('event-delete-btn').click();
    await expect(page.locator('#deleteConfirmModal')).toBeVisible();

    await page.getByTestId('delete-series').check();
    const deleteResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/calendar/events/${mainId}/delete/`) && r.request().method() === 'POST',
      { timeout: 10000 },
    );
    await page.getByTestId('confirm-delete-btn').click();
    await expect(page.locator('#deleteConfirmModal')).toBeHidden();

    const delData = await (await deleteResponse).json();
    expect(delData.success).toBe(true);

    await waitForEvents(page);
    const remaining = await page.evaluate((targetIds) => {
      const evs = (window as any).calendar?.getEvents() || [];
      return evs.filter((e: any) => targetIds.includes(Number(e.id))).length;
    }, ids);
    expect(remaining).toBe(0);
  });

  test('одиночное занятие становится серией через редактирование (API)', async ({ page }) => {
    const hour = 10;
    const weekDates = [0, 7, 14, 21].map((d) => futureDate(48 + d * 24, hour).slice(0, 10));
    for (const d of weekDates) {
      await cleanupEventsOnDate(page, d);
    }
    const created = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${weekDates[0]}T10:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
    });
    const eventId = created.event!.id;
    createdIds.push(eventId);

    const updateData = await updateCalendarEvent(page, eventId, {
      is_recurring: true,
      recurring_count: 4,
    });
    expect(updateData.success).toBe(true);

    const events = await page.evaluate(async ({ startDate, endDate }) => {
      const r = await fetch(`/api/calendar/events/?start=${startDate}&end=${endDate}`);
      if (!r.ok) throw new Error(`fetch events: HTTP ${r.status}`);
      return r.json();
    }, { startDate: weekDates[0], endDate: weekDates[3] });

    const recurring = events.filter((e: any) => e.extendedProps.is_recurring);
    expect(recurring).toHaveLength(4);
    const recIds = new Set(recurring.map((e: any) => e.extendedProps.recurrence_id));
    expect(recIds.size).toBe(1);
    expect([...recIds][0]).toBeTruthy();
    expect(recurring.some((e: any) => Number(e.id) === eventId)).toBe(true);
  });

  test('включение повтора в форме редактирования создаёт серию', async ({ page }) => {
    const hour = 11;
    const weekDates = [0, 7, 14, 21].map((d) => futureDate(48 + d * 24, hour).slice(0, 10));
    for (const d of weekDates) {
      await cleanupEventsOnDate(page, d);
    }
    const created = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${weekDates[0]}T11:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
    });
    const eventId = created.event!.id;
    createdIds.push(eventId);

    await navigateToDate(page, weekDates[0]);
    await page.locator(`.fc-daygrid-day[data-date="${weekDates[0]}"] .fc-event`).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await expect(page.locator('#modalTitle')).toHaveText('Редактировать занятие');

    await page.getByTestId('event-recurring').check();
    await expect(page.locator('#recurringCountGroup')).toBeVisible();

    const updateResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/calendar/events/${eventId}/`) && r.request().method() === 'PUT',
      { timeout: 10000 },
    );
    await page.getByTestId('event-save-btn').click();
    await expect(page.locator('#eventModal')).toBeHidden();
    const updateData = await (await updateResponse).json();
    expect(updateData.success).toBe(true);

    const events = await page.evaluate(async ({ startDate, endDate }) => {
      const r = await fetch(`/api/calendar/events/?start=${startDate}&end=${endDate}`);
      if (!r.ok) throw new Error(`fetch events: HTTP ${r.status}`);
      return r.json();
    }, { startDate: weekDates[0], endDate: weekDates[3] });
    const recurring = events.filter((e: any) => e.extendedProps.is_recurring);
    expect(recurring).toHaveLength(4);
    expect(new Set(recurring.map((e: any) => e.extendedProps.recurrence_id)).size).toBe(1);
  });

  test('повторное сохранение серии не создаёт дубликаты', async ({ page }) => {
    const hour = 15;
    const weekDates = [0, 7, 14].map((d) => futureDate(48 + d * 24, hour).slice(0, 10));
    for (const d of weekDates) {
      await cleanupEventsOnDate(page, d);
    }
    const created = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${weekDates[0]}T15:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
      is_recurring: true,
      recurring_count: 3,
    });
    const ids = created.recurring_events!.map((e: any) => Number(e.id));
    const mainId = ids[0];
    const recId = created.recurring_events![1].recurrence_id as string;
    createdIds.push(mainId);

    await updateCalendarEvent(page, mainId, { is_recurring: true, recurring_count: 3 });
    await updateCalendarEvent(page, mainId, { is_recurring: true, recurring_count: 3 });

    const events = await page.evaluate(async ({ startDate, endDate }) => {
      const r = await fetch(`/api/calendar/events/?start=${startDate}&end=${endDate}`);
      if (!r.ok) throw new Error(`fetch events: HTTP ${r.status}`);
      return r.json();
    }, { startDate: weekDates[0], endDate: weekDates[2] });
    const series = events.filter((e: any) => e.extendedProps.recurrence_id === recId);
    expect(series).toHaveLength(3);
  });

  test('отключение повтора отсоединяет событие от серии', async ({ page }) => {
    const hour = 16;
    const weekDates = [0, 7, 14].map((d) => futureDate(48 + d * 24, hour).slice(0, 10));
    for (const d of weekDates) {
      await cleanupEventsOnDate(page, d);
    }
    const created = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${weekDates[0]}T16:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
      is_recurring: true,
      recurring_count: 3,
    });
    const ids = created.recurring_events!.map((e: any) => Number(e.id));
    const mainId = ids[0];
    const recId = created.recurring_events![1].recurrence_id as string;
    createdIds.push(mainId, ids[1], ids[2]);

    const updateData = await updateCalendarEvent(page, mainId, { is_recurring: false });
    expect(updateData.success).toBe(true);

    const events = await page.evaluate(async ({ startDate, endDate }) => {
      const r = await fetch(`/api/calendar/events/?start=${startDate}&end=${endDate}`);
      if (!r.ok) throw new Error(`fetch events: HTTP ${r.status}`);
      return r.json();
    }, { startDate: weekDates[0], endDate: weekDates[2] });
    const main = events.find((e: any) => Number(e.id) === mainId);
    expect(main.extendedProps.is_recurring).toBe(false);
    expect(main.extendedProps.recurrence_id).toBe('');
    const siblings = events.filter((e: any) => e.extendedProps.recurrence_id === recId);
    expect(siblings).toHaveLength(2);
  });

  test('смена типа занятия у начального события серии применяется ко всей серии (API)', async ({ page }) => {
    const hour = 12;
    const weekDates = [0, 7, 14, 21].map((d) => futureDate(48 + d * 24, hour).slice(0, 10));
    for (const d of weekDates) {
      await cleanupEventsOnDate(page, d);
    }
    const created = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${weekDates[0]}T12:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
      is_recurring: true,
      recurring_count: 4,
    });
    const ids = created.recurring_events!.map((e) => Number(e.id));
    const mainId = ids[0];
    createdIds.push(mainId);

    const updateData = await updateCalendarEvent(page, mainId, { class_type_id: 4 });
    expect(updateData.success).toBe(true);

    const events = await page.evaluate(async ({ startDate, endDate }) => {
      const r = await fetch(`/api/calendar/events/?start=${startDate}&end=${endDate}`);
      if (!r.ok) throw new Error(`fetch events: HTTP ${r.status}`);
      return r.json();
    }, { startDate: weekDates[0], endDate: weekDates[3] });

    const recurring = events.filter((e: any) => e.extendedProps.is_recurring);
    expect(recurring).toHaveLength(4);
    for (const e of recurring) {
      expect(e.title).toBe('Здоровая спина');
    }
  });

  test('смена времени и зала у начального события серии применяется ко всей серии, даты сохраняются', async ({ page }) => {
    const hour = 9;
    const weekDates = [0, 7, 14, 21].map((d) => futureDate(48 + d * 24, hour).slice(0, 10));
    for (const d of weekDates) {
      await cleanupEventsOnDate(page, d);
    }
    const created = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${weekDates[0]}T09:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
      is_recurring: true,
      recurring_count: 4,
    });
    const ids = created.recurring_events!.map((e) => Number(e.id));
    const mainId = ids[0];
    createdIds.push(mainId);

    const updateData = await updateCalendarEvent(page, mainId, {
      hall_id: 3,
      start: `${weekDates[0]}T14:30`,
    });
    expect(updateData.success).toBe(true);

    const events = await page.evaluate(async ({ startDate, endDate }) => {
      const r = await fetch(`/api/calendar/events/?start=${startDate}&end=${endDate}`);
      if (!r.ok) throw new Error(`fetch events: HTTP ${r.status}`);
      return r.json();
    }, { startDate: weekDates[0], endDate: weekDates[3] });

    const recurring = events.filter((e: any) => e.extendedProps.is_recurring);
    expect(recurring).toHaveLength(4);
    for (const e of recurring) {
      expect(e.extendedProps.hall_id).toBe(3);
      const ownDate = e.start.slice(0, 10);
      expect(e.start).toBe(`${ownDate}T14:30:00`);
    }
    const starts = recurring.map((e: any) => e.start.slice(0, 10)).sort();
    expect(starts).toEqual([...weekDates].sort());
  });

  test('редактирование не-начального события серии не влияет на остальные (API)', async ({ page }) => {
    const hour = 17;
    const weekDates = [0, 7, 14].map((d) => futureDate(48 + d * 24, hour).slice(0, 10));
    for (const d of weekDates) {
      await cleanupEventsOnDate(page, d);
    }
    const created = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${weekDates[0]}T17:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
      is_recurring: true,
      recurring_count: 3,
    });
    const ids = created.recurring_events!.map((e) => Number(e.id));
    createdIds.push(ids[0], ids[1], ids[2]);

    const updateData = await updateCalendarEvent(page, ids[1], { class_type_id: 4 });
    expect(updateData.success).toBe(true);

    const events = await page.evaluate(async ({ startDate, endDate }) => {
      const r = await fetch(`/api/calendar/events/?start=${startDate}&end=${endDate}`);
      if (!r.ok) throw new Error(`fetch events: HTTP ${r.status}`);
      return r.json();
    }, { startDate: weekDates[0], endDate: weekDates[2] });

    const byId = new Map(events.map((e: any) => [Number(e.id), e]));
    expect(byId.get(ids[0])!.title).toBe('Йога');
    expect(byId.get(ids[1])!.title).toBe('Здоровая спина');
    expect(byId.get(ids[2])!.title).toBe('Йога');
  });

  test('смена типа занятия у начального события серии через форму', async ({ page }) => {
    const hour = 18;
    const weekDates = [0, 7, 14, 21].map((d) => futureDate(48 + d * 24, hour).slice(0, 10));
    for (const d of weekDates) {
      await cleanupEventsOnDate(page, d);
    }
    const created = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${weekDates[0]}T18:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
      is_recurring: true,
      recurring_count: 4,
    });
    const ids = created.recurring_events!.map((e) => Number(e.id));
    const mainId = ids[0];
    createdIds.push(mainId);

    await navigateToDate(page, weekDates[0]);
    await page.locator(`.fc-daygrid-day[data-date="${weekDates[0]}"] .fc-event`).first().click();
    await expect(page.locator('#modalTitle')).toHaveText('Редактировать занятие');

    await page.selectOption('[data-test-id="event-class-type"]', '4');

    const updateResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/calendar/events/${mainId}/`) && r.request().method() === 'PUT',
      { timeout: 10000 },
    );
    await page.getByTestId('event-save-btn').click();
    await expect(page.locator('#eventModal')).toBeHidden();
    const updateData = await (await updateResponse).json();
    expect(updateData.success).toBe(true);

    const events = await page.evaluate(async ({ startDate, endDate }) => {
      const r = await fetch(`/api/calendar/events/?start=${startDate}&end=${endDate}`);
      if (!r.ok) throw new Error(`fetch events: HTTP ${r.status}`);
      return r.json();
    }, { startDate: weekDates[0], endDate: weekDates[3] });

    const recurring = events.filter((e: any) => e.extendedProps.is_recurring);
    expect(recurring).toHaveLength(4);
    for (const e of recurring) {
      expect(e.title).toBe('Здоровая спина');
    }
  });

  test('вкладка посещаемости доступна для администратора', async ({ page }) => {
    const start = futureDate(48, 11);
    const startDate = start.slice(0, 10);
    await cleanupEventsOnDate(page, startDate);
    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
    });
    createdIds.push(result.event!.id);
    await navigateToDate(page, startDate);

    await page.locator(`.fc-daygrid-day[data-date="${startDate}"] .fc-event`).first().click();

    await page.getByTestId('tab-attendance').click();
    await expect(page.getByTestId('tab-attendance')).toHaveClass(/active/);
    await expect(page.getByTestId('save-attendance-btn')).toBeVisible();
    await expect(page.getByTestId('client-search-input')).toBeVisible();
  });

  test('добавление и удаление клиента вручную администратором: списание и возврат средств', async ({ page }) => {
    const start = futureDate(48, 9);
    const startDate = start.slice(0, 10);
    await cleanupEventsOnDate(page, startDate);
    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
    });
    const eventId = result.event!.id;
    createdIds.push(eventId);

    // Убираем абонементы для детерминированного списания с баланса
    await deleteUserSubscriptions(page, STUDENT_ID);
    await setAllowedTariffs(page, STUDENT_ID, [TARIFF_GROUP_ID, 3]);

    const info = await getUserInfo(page, '+73333333333');
    const studentName = `${info.last_name || ''} ${info.first_name || ''}`.trim();
    const balanceBefore = parseFloat(info.balance!);

    await navigateToDate(page, startDate);

    const price = await getEventProp(page, eventId, 'price');
    expect(price).not.toBeNull();

    await page.locator(`.fc-daygrid-day[data-date="${startDate}"] .fc-event`).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await page.getByTestId('tab-attendance').click();
    await expect(page.getByTestId('tab-attendance')).toHaveClass(/active/);

    // Добавление клиента вручную через поиск
    await page.getByTestId('client-search-input').fill('333');
    await expect(page.getByTestId('client-search-result')).toBeVisible();

    const addResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/calendar/events/${eventId}/attendance/add/`) && r.request().method() === 'POST',
      { timeout: 10000 },
    );
    await page.getByTestId('client-search-result').first().click();

    const addData = await (await addResponse).json();
    expect(addData.success).toBe(true);

    await expect(page.locator('.attendance-item')).toContainText(studentName);

    // Запись списала стоимость занятия с баланса
    const balanceAfterAdd = parseFloat((await getUserInfo(page, '+73333333333')).balance!);
    expect(balanceAfterAdd).toBe(balanceBefore - price!);

    // Удаление клиента администратором
    const removeResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/calendar/events/${eventId}/attendance/remove/`) && r.request().method() === 'POST',
      { timeout: 10000 },
    );
    await page.getByTestId('remove-client-btn').first().click();
    await expect(page.locator('#confirmModal')).toBeVisible();
    await page.getByTestId('confirm-ok-btn').click();

    await expect(page.getByTestId('notification-modal')).toBeVisible();
    await expect(page.getByTestId('notification-message')).toContainText('возвращены');
    await page.getByTestId('notification-ok-btn').click();

    const removeData = await (await removeResponse).json();
    expect(removeData.success).toBe(true);

    await expect(page.locator('.attendance-item')).toHaveCount(0);
    await expect(page.locator('.attendance-list')).toContainText('Пока нет записанных клиентов');

    // Удаление вернуло средства на баланс
    const balanceAfterRefund = parseFloat((await getUserInfo(page, '+73333333333')).balance!);
    expect(balanceAfterRefund).toBe(balanceBefore);

    // Возврат разрешённых тарифов к дефолтному состоянию
    await setAllowedTariffs(page, STUDENT_ID, [3]);
  });

  test('удаление одного занятия из серии', async ({ page }) => {
    const start = futureDate(48, 11);
    const startDate = start.slice(0, 10);
    await cleanupEventsOnDate(page, startDate);
    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
      is_recurring: true,
      recurring_count: 4,
    });
    const ids = result.recurring_events!.map((e) => Number(e.id));
    expect(ids).toHaveLength(4);
    const mainId = ids[0];
    const otherIds = ids.slice(1);
    // Главное удаляется в тесте, остальные чистим в afterEach
    for (const id of otherIds) createdIds.push(id);

    await navigateToDate(page, startDate);

    await page.locator(`.fc-daygrid-day[data-date="${startDate}"] .fc-event`).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await page.getByTestId('event-delete-btn').click();
    await expect(page.locator('#deleteConfirmModal')).toBeVisible();

    await page.getByTestId('delete-single').check();
    const deleteResponse = page.waitForResponse(
      (r) => r.url().includes(`/api/calendar/events/${mainId}/delete/`) && r.request().method() === 'POST',
      { timeout: 10000 },
    );
    await page.getByTestId('confirm-delete-btn').click();
    await expect(page.locator('#deleteConfirmModal')).toBeHidden();

    const delData = await (await deleteResponse).json();
    expect(delData.success).toBe(true);

    await waitForEvents(page);
    expect(await getEventProp(page, mainId, 'duration')).toBeNull();
    const remaining = await page.evaluate((targetIds) => {
      const evs = (window as any).calendar?.getEvents() || [];
      return evs.filter((e: any) => targetIds.includes(Number(e.id))).length;
    }, otherIds);
    expect(remaining).toBe(3);
  });

  test('отмена в модалке подтверждения удаления', async ({ page }) => {
    const start = futureDate(48, 12);
    const startDate = start.slice(0, 10);
    await cleanupEventsOnDate(page, startDate);
    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
      is_recurring: true,
      recurring_count: 3,
    });
    for (const e of result.recurring_events!) createdIds.push(Number(e.id));
    const mainId = Number(result.recurring_events![0].id);

    await navigateToDate(page, startDate);

    await page.locator(`.fc-daygrid-day[data-date="${startDate}"] .fc-event`).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await page.getByTestId('event-delete-btn').click();
    await expect(page.locator('#deleteConfirmModal')).toBeVisible();

    await page.getByTestId('cancel-delete-btn').click();
    await expect(page.locator('#deleteConfirmModal')).toBeHidden();
    await expect(page.locator('#eventModal')).toBeVisible();

    await waitForEvents(page);
    expect(await getEventProp(page, mainId, 'duration')).toBe(60);
  });

  test('поиск клиентов без результатов', async ({ page }) => {
    const start = futureDate(48, 13);
    const startDate = start.slice(0, 10);
    await cleanupEventsOnDate(page, startDate);
    const result = await createCalendarEvent(page, {
      class_type_id: 1,
      start,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_GROUP_ID,
    });
    createdIds.push(result.event!.id);

    await navigateToDate(page, startDate);

    await page.locator(`.fc-daygrid-day[data-date="${startDate}"] .fc-event`).first().click();
    await expect(page.locator('#eventModal')).toBeVisible();
    await page.getByTestId('tab-attendance').click();

    await page.getByTestId('client-search-input').fill('zxczxczxc');
    await expect(page.locator('#clientSearchResults')).toContainText('Клиенты не найдены');
  });

  test('отмена модалки создания занятия', async ({ page }) => {
    let createRequested = false;
    page.on('request', (req) => {
      if (req.url().includes('/api/calendar/events/create/') && req.method() === 'POST') {
        createRequested = true;
      }
    });

    await openCreateModal(page, 19);
    await expect(page.locator('#modalTitle')).toHaveText('Новое занятие');
    await page.getByTestId('event-cancel-btn').click();
    await expect(page.locator('#eventModal')).toBeHidden();

    expect(createRequested).toBe(false);
  });
});

test.describe('Перетаскивание занятия (drag & drop)', () => {

  test.describe('Студент — запрет', () => {
    let eventId: number;

    test.beforeEach(async ({ page }) => {
      eventId = await setupEvent(page);
      await page.context().clearCookies();
      await loginAsStudent(page);
    });

    test.afterEach(async ({ page }) => {
      await teardownEvent(page, eventId);
    });

    test('перетаскивание в месячном виде недоступно', async ({ page }) => {
      await navigateToView(page, 'month');
      await cleanDateEvents(page).first()
        .dragTo(page.locator(`.fc-daygrid-day[data-date="${TARGET_DATE}"]`));
      await assertForbidden(page, eventId);
    });

    test('перетаскивание в недельном виде недоступно', async ({ page }) => {
      await navigateToView(page, 'week');
      await dragTimegridLater(page, page.locator(`.fc-timegrid-col[data-date="${CLEAN_EVENT_DATE}"] .fc-event`).first(), CLEAN_EVENT_DATE);
      await assertForbidden(page, eventId);
    });

    test('перетаскивание в дневном виде недоступно', async ({ page }) => {
      await navigateToView(page, 'day');
      await dragTimegridLater(page, page.locator('.fc-timegrid-event').first(), CLEAN_EVENT_DATE);
      await assertForbidden(page, eventId);
    });
  });

  test.describe('Администратор — разрешено', () => {
    let eventId: number;

    test.beforeEach(async ({ page }) => {
      eventId = await setupEvent(page);
    });

    test.afterEach(async ({ page }) => {
      await teardownEvent(page, eventId);
    });

    test('перетаскивание в месячном виде доступно', async ({ page }) => {
      await navigateToView(page, 'month');
      await cleanDateEvents(page).first()
        .dragTo(page.locator(`.fc-daygrid-day[data-date="${TARGET_DATE}"]`));
      await assertEventMovedTo(page, eventId);
    });

    test('перетаскивание в недельном виде доступно', async ({ page }) => {
      await navigateToView(page, 'week');
      await dragTimegridLater(page, page.locator(`.fc-timegrid-col[data-date="${CLEAN_EVENT_DATE}"] .fc-event`).first(), CLEAN_EVENT_DATE);
      await assertEventMovedTo(page, eventId);
    });

    test('перетаскивание в дневном виде доступно', async ({ page }) => {
      await navigateToView(page, 'day');
      await dragTimegridLater(page, page.locator('.fc-timegrid-event').first(), CLEAN_EVENT_DATE);
      await assertEventMovedTo(page, eventId);
    });
  });
});

async function createFreshClient(
  page: import('@playwright/test').Page,
  allowedTariffs: number[],
  balance = 10000,
): Promise<{ phone: string; id: number }> {
  const phone = uniquePhone();
  await page.context().clearCookies();
  await registerNewUser(page, phone);
  const info = await getUserInfo(page, phone);
  const id = info.id!;
  await page.context().clearCookies();
  await loginAsAdmin(page);
  await setBalance(page, id, balance);
  await setAllowedTariffs(page, id, allowedTariffs);
  await page.context().clearCookies();
  await loginAsStudent(page, phone);
  return { phone, id };
}

test.describe('Посещаемость — роли и приватность', () => {
  const STUDENT_PHONE_RAW = '3333333333';

  test('студент не видит телефоны в списке посещаемости', async ({ page }) => {
    const eventId = await setupEvent(page);
    await page.context().clearCookies();
    await loginAsStudent(page);
    await enrollToEvent(page, eventId);

    const data = await getAttendance(page, eventId);
    expect(data.attendances.length).toBe(1);
    expect(data.attendances[0].client_phone).toBe('');
    expect(JSON.stringify(data)).not.toContain(STUDENT_PHONE_RAW);

    await teardownEvent(page, eventId);
  });

  test('модератор видит телефоны в списке посещаемости', async ({ page }) => {
    const eventId = await setupEvent(page);
    await page.context().clearCookies();
    await loginAsStudent(page);
    await enrollToEvent(page, eventId);

    await page.context().clearCookies();
    await loginAsModerator(page);
    const data = await getAttendance(page, eventId);
    expect(data.attendances[0].client_phone).toBe('+73333333333');

    await teardownEvent(page, eventId);
  });

  test('студент не может добавить клиента на занятие (403)', async ({ page }) => {
    await loginAsStudent(page);
    const csrf = await getCsrfToken(page);
    const resp = await page.request.post('/api/calendar/events/999999/attendance/add/', {
      data: { client_id: 5 },
      headers: { 'X-CSRFToken': csrf },
    });
    expect(resp.status()).toBe(403);
  });

  test('студент не может обновить посещаемость (403)', async ({ page }) => {
    await loginAsStudent(page);
    const csrf = await getCsrfToken(page);
    const resp = await page.request.post('/api/calendar/events/999999/attendance/update/', {
      data: { attended_clients: [5] },
      headers: { 'X-CSRFToken': csrf },
    });
    expect(resp.status()).toBe(403);
  });

  test('студент не может удалить клиента с занятия (403)', async ({ page }) => {
    await loginAsStudent(page);
    const csrf = await getCsrfToken(page);
    const resp = await page.request.post('/api/calendar/events/999999/attendance/remove/', {
      data: { client_id: 5 },
      headers: { 'X-CSRFToken': csrf },
    });
    expect(resp.status()).toBe(403);
  });

  test('студент не может искать клиентов (403)', async ({ page }) => {
    await loginAsStudent(page);
    const resp = await page.request.get('/api/clients/search/?q=test');
    expect(resp.status()).toBe(403);
  });
});

test.describe('Сплит — оплата по дедлайну', () => {
  const TARIFF_SPLIT = 3;

  test('один участник платит полную стоимость по дедлайну', async ({ page }) => {
    const eventId = await setupEvent(page);
    const client = await createFreshClient(page, [TARIFF_SPLIT], 5000);
    await enrollToEvent(page, eventId);

    await page.context().clearCookies();
    await loginAsAdmin(page);
    await moveSessionToPast(page, eventId, 60);
    await getAttendance(page, eventId);

    const balance = parseFloat((await getUserInfo(page, client.phone)).balance!);
    expect(balance).toBe(5000 - SPLIT_PRICE_FULL);

    await deleteTestUser(page, client.phone);
    await deleteCalendarEvent(page, eventId);
  });

  test('двое участников делят стоимость пополам', async ({ page }) => {
    const eventId = await setupEvent(page);
    const c1 = await createFreshClient(page, [TARIFF_SPLIT], 5000);
    await enrollToEvent(page, eventId);
    const c2 = await createFreshClient(page, [TARIFF_SPLIT], 5000);
    await enrollToEvent(page, eventId);

    await page.context().clearCookies();
    await loginAsAdmin(page);
    await moveSessionToPast(page, eventId, 60);
    await getAttendance(page, eventId);

    expect(parseFloat((await getUserInfo(page, c1.phone)).balance!)).toBe(5000 - SPLIT_PRICE_HALF);
    expect(parseFloat((await getUserInfo(page, c2.phone)).balance!)).toBe(5000 - SPLIT_PRICE_HALF);

    await deleteTestUser(page, c1.phone);
    await deleteTestUser(page, c2.phone);
    await deleteCalendarEvent(page, eventId);
  });

  test('нехватка баланса по дедлайну отменяет запись', async ({ page }) => {
    const eventId = await setupEvent(page);
    const client = await createFreshClient(page, [TARIFF_SPLIT], 100);
    await enrollToEvent(page, eventId);

    await page.context().clearCookies();
    await loginAsAdmin(page);
    await moveSessionToPast(page, eventId, 60);
    const data = await getAttendance(page, eventId);

    expect(data.attendances.length).toBe(0);
    expect(parseFloat((await getUserInfo(page, client.phone)).balance!)).toBe(100);

    await deleteTestUser(page, client.phone);
    await deleteCalendarEvent(page, eventId);
  });

  test('запрос attendance после дедлайна запускает списание и ставит статус paid', async ({ page }) => {
    const eventId = await setupEvent(page);
    const client = await createFreshClient(page, [TARIFF_SPLIT], 5000);
    await enrollToEvent(page, eventId);

    await page.context().clearCookies();
    await loginAsAdmin(page);
    await moveSessionToPast(page, eventId, 60);
    const data = await getAttendance(page, eventId);

    expect(data.attendances[0].status).toBe('paid');
    expect(parseFloat((await getUserInfo(page, client.phone)).balance!)).toBe(5000 - SPLIT_PRICE_FULL);

    await deleteTestUser(page, client.phone);
    await deleteCalendarEvent(page, eventId);
  });

  test('нельзя записаться сверх лимита участников сплита', async ({ page }) => {
    const eventId = await setupEvent(page, { max_participants_override: 1 });
    const c1 = await createFreshClient(page, [TARIFF_SPLIT], 5000);
    await enrollToEvent(page, eventId);

    const c2 = await createFreshClient(page, [TARIFF_SPLIT], 5000);
    const csrf = await getCsrfToken(page);
    const resp = await page.request.post(`/api/calendar/events/${eventId}/enroll/`, {
      data: {},
      headers: { 'X-CSRFToken': csrf },
    });
    expect(resp.status()).toBe(400);
    const err = await resp.json();
    expect(err.error).toContain('свободных');

    await deleteTestUser(page, c1.phone);
    await deleteTestUser(page, c2.phone);
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, eventId);
  });
});

test.describe('Абонемент — просроченный', () => {
  test('просроченный абонемент не используется — списание с баланса', async ({ page }) => {
    const client = await createFreshClient(page, [LITE_ID], 10000);
    await purchaseSubscription(page, LITE_ID);
    const before = await getCurrentUserInfo(page);
    expect(before.subscription!.sessions_remaining).toBe(LITE_SESSIONS);
    const subId = before.subscription!.id;

    await page.context().clearCookies();
    await loginAsAdmin(page);
    await expireSubscription(page, subId);
    await page.context().clearCookies();
    const eventId = await setupEvent(page, { tariff_id: LITE_ID });

    await page.context().clearCookies();
    await loginAsStudent(page, client.phone);
    await enrollToEvent(page, eventId);

    const after = await getCurrentUserInfo(page);
    expect(after.subscription).toBeNull();
    expect(parseFloat((await getUserInfo(page, client.phone)).balance!)).toBe(10000 - LITE_SUBSCRIPTION_PRICE - LITE_SESSION_PRICE);

    await deleteTestUser(page, client.phone);
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, eventId);
  });
});

test.describe('Списание из абонемента — повторная запись', () => {
  test('повторная запись после отмены снова списывает занятие абонемента', async ({ page }) => {
    const client = await createFreshClient(page, [TARIFF_GROUP_ID], 10000);
    await purchaseSubscription(page, TARIFF_GROUP_ID);
    expect((await getCurrentUserInfo(page)).subscription!.sessions_remaining).toBe(GROUP_SESSIONS);

    const eventId = await setupEvent(page, { tariff_id: TARIFF_GROUP_ID });

    await page.context().clearCookies();
    await loginAsStudent(page, client.phone);
    await enrollToEvent(page, eventId);
    expect((await getCurrentUserInfo(page)).subscription!.sessions_remaining).toBe(GROUP_SESSIONS - 1);

    await cancelEnrollmentApi(page, eventId);
    expect((await getCurrentUserInfo(page)).subscription!.sessions_remaining).toBe(GROUP_SESSIONS);

    await enrollToEvent(page, eventId);
    expect((await getCurrentUserInfo(page)).subscription!.sessions_remaining).toBe(GROUP_SESSIONS - 1);

    await deleteTestUser(page, client.phone);
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, eventId);
  });
});

test.describe('Группы тарифов (Lite/Pro)', () => {
  test('запись через абонемент Lite на занятие тарифа Pro списывает занятие группы', async ({ page }) => {
    const client = await createFreshClient(page, [LITE_ID], 10000);
    await purchaseSubscription(page, LITE_ID);
    const afterPurchase = await getCurrentUserInfo(page);
    const balanceAfterPurchase = parseFloat(afterPurchase.balance);
    expect(afterPurchase.subscription!.sessions_total).toBe(LITE_SESSIONS);
    expect(afterPurchase.subscription!.sessions_remaining).toBe(LITE_SESSIONS);

    const eventId = await setupEvent(page, { tariff_id: PRO_ID });

    await page.context().clearCookies();
    await loginAsStudent(page, client.phone);
    await enrollToEvent(page, eventId);

    const afterEnroll = await getCurrentUserInfo(page);
    expect(afterEnroll.subscription!.sessions_remaining).toBe(LITE_SESSIONS - 1);
    expect(parseFloat(afterEnroll.balance)).toBe(balanceAfterPurchase);

    await deleteTestUser(page, client.phone);
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, eventId);
  });

  test('отмена записи возвращает занятие в абонемент другой группы', async ({ page }) => {
    const client = await createFreshClient(page, [LITE_ID], 10000);
    await purchaseSubscription(page, LITE_ID);
    expect((await getCurrentUserInfo(page)).subscription!.sessions_remaining).toBe(LITE_SESSIONS);

    const eventId = await setupEvent(page, { tariff_id: PRO_ID });

    await page.context().clearCookies();
    await loginAsStudent(page, client.phone);
    await enrollToEvent(page, eventId);
    expect((await getCurrentUserInfo(page)).subscription!.sessions_remaining).toBe(LITE_SESSIONS - 1);

    await cancelEnrollmentApi(page, eventId);
    expect((await getCurrentUserInfo(page)).subscription!.sessions_remaining).toBe(LITE_SESSIONS);

    await deleteTestUser(page, client.phone);
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, eventId);
  });

  test('is_allowed=true для занятия смежного тарифа группы', async ({ page }) => {
    const eventId = await setupEvent(page, { tariff_id: PRO_ID });
    const client = await createFreshClient(page, [LITE_ID], 10000);

    const event = await page.evaluate(async ({ eventId, date }) => {
      const evs = await fetch(`/api/calendar/events/?start=${date}&end=${date}`).then((r) => r.json());
      return evs.find((e: any) => Number(e.id) === eventId);
    }, { eventId, date: CLEAN_EVENT_DATE });
    expect(event).not.toBeUndefined();
    expect(event.extendedProps.is_allowed).toBe(true);
    expect(event.extendedProps.tariff_id).toBe(PRO_ID);

    await deleteTestUser(page, client.phone);
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, eventId);
  });

  test('запись с баланса на занятие смежного тарифа группы списывает цену занятия', async ({ page }) => {
    const client = await createFreshClient(page, [PRO_ID], 10000);
    const eventId = await setupEvent(page, { tariff_id: LITE_ID });

    const price = await page.evaluate(async ({ eventId, date }) => {
      const evs = await fetch(`/api/calendar/events/?start=${date}&end=${date}`).then((r) => r.json());
      const ev = evs.find((e: any) => Number(e.id) === eventId);
      return ev?.extendedProps?.price ?? null;
    }, { eventId, date: CLEAN_EVENT_DATE });
    expect(price).not.toBeNull();

    await page.context().clearCookies();
    await loginAsStudent(page, client.phone);
    await enrollToEvent(page, eventId);

    const after = await getCurrentUserInfo(page);
    expect(after.subscription).toBeNull();
    expect(parseFloat((await getUserInfo(page, client.phone)).balance!)).toBe(10000 - price);

    await deleteTestUser(page, client.phone);
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, eventId);
  });

  test('покупка абонемента Pro доступна при доступе только к Lite (и наоборот)', async ({ page }) => {
    const client = await createFreshClient(page, [LITE_ID], 10000);
    await purchaseSubscription(page, PRO_ID);
    const after = await getCurrentUserInfo(page);
    expect(after.subscription).not.toBeNull();
    expect(after.subscription!.sessions_total).toBe(PRO_SESSIONS);
    expect(after.subscription!.sessions_remaining).toBe(PRO_SESSIONS);

    await deleteTestUser(page, client.phone);
  });
});

test.describe('Права студента', () => {
  test('студент не может записать другого через client_id', async ({ page }) => {
    const a = await createFreshClient(page, [TARIFF_GROUP_ID], 10000);
    const b = await createFreshClient(page, [TARIFF_GROUP_ID], 10000);
    const eventId = await setupEvent(page, { tariff_id: TARIFF_GROUP_ID });

    await page.context().clearCookies();
    await loginAsStudent(page, a.phone);
    const csrf = await getCsrfToken(page);
    const resp = await page.request.post(`/api/calendar/events/${eventId}/enroll/`, {
      data: { client_id: b.id },
      headers: { 'X-CSRFToken': csrf },
    });
    expect((await resp.json()).success).toBe(true);

    expect(parseFloat((await getUserInfo(page, a.phone)).balance!)).toBe(10000 - GROUP_SESSION_PRICE);
    expect(parseFloat((await getUserInfo(page, b.phone)).balance!)).toBe(10000);

    await deleteTestUser(page, a.phone);
    await deleteTestUser(page, b.phone);
    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, eventId);
  });

  test('студент не может удалить занятие (403)', async ({ page }) => {
    const eventId = await setupEvent(page);
    await page.context().clearCookies();
    await loginAsStudent(page);
    const csrf = await getCsrfToken(page);
    const resp = await page.request.post(`/api/calendar/events/${eventId}/delete/`, {
      data: {},
      headers: { 'X-CSRFToken': csrf },
    });
    expect(resp.status()).toBe(403);

    await teardownEvent(page, eventId);
  });
});

test.describe('API событий — доступность тарифов', () => {
  test('недоступный тариф помечается is_allowed=false', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await cleanupEventsOnDate(page, CLEAN_EVENT_DATE);
    const e1 = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${CLEAN_EVENT_DATE}T10:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: 3,
    });
    const e2 = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${CLEAN_EVENT_DATE}T12:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_FORBIDDEN_ID,
    });
    const id1 = e1.event!.id;
    const id2 = e2.event!.id;

    await page.context().clearCookies();
    await loginAsStudent(page);
    const events = await fetchEventsOnDate(page, CLEAN_EVENT_DATE);
    const byId = Object.fromEntries(events.map((ev) => [Number(ev.id), ev]));
    expect(byId[id1].extendedProps.is_allowed).toBe(true);
    expect(byId[id2].extendedProps.is_allowed).toBe(false);

    await page.context().clearCookies();
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await deleteCalendarEvent(page, id1);
    await deleteCalendarEvent(page, id2);
  });

  test('сотрудник видит все события', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/calendar/');
    await cleanupEventsOnDate(page, CLEAN_EVENT_DATE);
    const e1 = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${CLEAN_EVENT_DATE}T10:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: 3,
    });
    const e2 = await createCalendarEvent(page, {
      class_type_id: 1,
      start: `${CLEAN_EVENT_DATE}T12:00`,
      duration: 60,
      hall_id: 2,
      tariff_id: TARIFF_FORBIDDEN_ID,
    });

    const events = await fetchEventsOnDate(page, CLEAN_EVENT_DATE);
    expect(events.length).toBe(2);
    expect(events.every((ev) => ev.extendedProps.is_allowed === true)).toBe(true);

    await deleteCalendarEvent(page, e1.event!.id);
    await deleteCalendarEvent(page, e2.event!.id);
  });
});

test.describe('Цвет текста события зала', () => {
  const HALL_ID = 2;
  let testEventId: number;
  let originalColors: { color: string; text_color: string };

  test.beforeEach(async ({ page }) => {
    testEventId = await setupEvent(page);
    originalColors = await setHallColors(page, HALL_ID);
  });

  test.afterEach(async ({ page }) => {
    await teardownEvent(page, testEventId);
    await setHallColors(page, HALL_ID, {
      color: originalColors.color,
      text_color: originalColors.text_color,
    });
  });

  test('явный text_color зала передаётся в API как textColor', async ({ page }) => {
    await setHallColors(page, HALL_ID, { color: '#4ECDC4', text_color: '#FF0000' });
    const events = await fetchEventsOnDate(page, CLEAN_EVENT_DATE);
    expect(events.length).toBe(1);
    expect(events[0].textColor).toBe('#FF0000');
  });

  test('пустой text_color на светлом фоне даёт тёмный текст #212529', async ({ page }) => {
    await setHallColors(page, HALL_ID, { color: '#FFFFFF', text_color: '' });
    const events = await fetchEventsOnDate(page, CLEAN_EVENT_DATE);
    expect(events.length).toBe(1);
    expect(events[0].textColor).toBe('#212529');
  });

  test('пустой text_color на тёмном фоне даёт белый текст', async ({ page }) => {
    await setHallColors(page, HALL_ID, { color: '#1a1a2e', text_color: '' });
    const events = await fetchEventsOnDate(page, CLEAN_EVENT_DATE);
    expect(events.length).toBe(1);
    expect(events[0].textColor).toBe('#FFFFFF');
  });

  test('событие рендерится с явным цветом текста зала', async ({ page }) => {
    await setHallColors(page, HALL_ID, { color: '#123456', text_color: '#FFAA00' });
    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await navigateToCleanDate(page);
    const event = page.locator(
      `.fc-daygrid-day[data-date="${CLEAN_EVENT_DATE}"] .fc-event-custom`,
    );
    await expect(event).toHaveCount(1);
    await expect(event).toHaveCSS('color', 'rgb(255, 170, 0)');
  });

  test('авто-контраст: светлый фон зала даёт тёмный текст события', async ({ page }) => {
    await setHallColors(page, HALL_ID, { color: '#FFFFFF', text_color: '' });
    await page.context().clearCookies();
    await loginAsStudent(page);
    await page.goto('/calendar/');
    await page.waitForSelector('.fc-daygrid', { timeout: 10000 });
    await waitForEvents(page);
    await navigateToCleanDate(page);
    const event = page.locator(
      `.fc-daygrid-day[data-date="${CLEAN_EVENT_DATE}"] .fc-event-custom`,
    );
    await expect(event).toHaveCount(1);
    await expect(event).toHaveCSS('color', 'rgb(33, 37, 41)');
  });
});
