import { test, expect, BASE_URL } from '../fixtures/base';
import {
  loginAsStudent,
  loginAsAdmin,
  getUserInfo,
  deleteTestUser,
  registerNewUser,
  uniquePhone,
  fillPhoneField,
  setAllowedTariffs,
  setBalance,
  purchaseSubscription,
  topupViaWebhook,
  createCalendarEvent,
  enrollToEvent,
  cancelEnrollment,
  deleteCalendarEvent,
  cleanupEventsOnDate,
  uploadAvatar,
  setAvatarFile,
  attachVk,
  createPastAttendance,
  getResolvedTestTariffs,
} from '../fixtures/helpers';

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

test.describe('Страница профиля', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsStudent(page);
    await page.goto('/profile/');
  });

  test.describe('Отображение', () => {
    test('открывается страница профиля', async ({ page }) => {
      await expect(page).toHaveURL(`${BASE_URL}profile/`);
    });

    test('отображается аватар или плейсхолдер', async ({ page }) => {
      const avatarImg = page.locator('.profile-avatar-img');
      const avatarPlaceholder = page.locator('.profile-avatar-placeholder');
      await expect(avatarImg.or(avatarPlaceholder)).toBeVisible();
    });

    test('отображается имя пользователя', async ({ page }) => {
      await expect(page.locator('.profile-row-value').first()).toBeVisible();
    });

    test('отображается кнопка "Редактировать"', async ({ page }) => {
      await expect(page.getByTestId('edit-profile-btn')).toBeVisible();
    });

    test('отображается кнопка "Выйти из аккаунта"', async ({ page }) => {
      await expect(page.getByTestId('logout-btn')).toBeVisible();
    });

    test('в карточке отображаются телефон и email', async ({ page }) => {
      await expect(page.getByTestId('profile-phone')).toContainText('+7');
      await expect(page.getByTestId('profile-email')).toBeVisible();
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

    test('кнопка "Магазин" ведёт в магазин', async ({ page }) => {
      await page.getByTestId('nav-shop').click();
      await expect(page).toHaveURL(`${BASE_URL}shop/`);
    });

    test('кнопка "Профиль" активна', async ({ page }) => {
      await expect(page.getByTestId('nav-profile')).toHaveClass(/active/);
    });
  });

  test.describe('Модальное окно редактирования', () => {
    test('кнопка "Редактировать" открывает модалку', async ({ page }) => {
      await page.getByTestId('edit-profile-btn').click();
      await expect(page.getByTestId('edit-modal')).toBeVisible();
    });

    test('модалка содержит все поля', async ({ page }) => {
      await page.getByTestId('edit-profile-btn').click();
      await expect(page.getByTestId('edit-first-name')).toBeVisible();
      await expect(page.getByTestId('edit-last-name')).toBeVisible();
      await expect(page.getByTestId('edit-phone')).toBeVisible();
      await expect(page.getByTestId('edit-email')).toBeVisible();
      await expect(page.getByTestId('edit-theme')).toBeVisible();
      await expect(page.getByTestId('edit-profile-save')).toBeVisible();
    });

    test('крестик закрывает модалку', async ({ page }) => {
      await page.getByTestId('edit-profile-btn').click();
      await expect(page.getByTestId('edit-modal')).toBeVisible();
      await page.getByTestId('edit-modal-close').click();
      await expect(page.getByTestId('edit-modal')).toBeHidden();
    });

    test('клик по оверлею закрывает модалку', async ({ page }) => {
      await page.getByTestId('edit-profile-btn').click();
      await expect(page.getByTestId('edit-modal')).toBeVisible();
      await page.getByTestId('edit-modal').click({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('edit-modal')).toBeHidden();
    });

    test('поле имени содержит текущее значение', async ({ page }) => {
      await page.getByTestId('edit-profile-btn').click();
      const value = await page.getByTestId('edit-first-name').inputValue();
      expect(value.length).toBeGreaterThan(0);
    });
  });

  test.describe('Редактирование профиля', () => {
    test('сохранение имени, фамилии и email обновляет профиль', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await page.getByTestId('edit-profile-btn').click();
        await page.getByTestId('edit-first-name').fill('НовоеИмя');
        await page.getByTestId('edit-last-name').fill('НоваяФамилия');
        await page.getByTestId('edit-email').fill('new@example.com');
        await page.getByTestId('edit-profile-save').click();
        await expect(page.getByTestId('profile-first-name')).toHaveText('НовоеИмя');
        await expect(page.getByTestId('profile-last-name')).toHaveText('НоваяФамилия');
        await expect(page.getByTestId('profile-email')).toHaveText('new@example.com');

        const info = await getUserInfo(page, phone);
        expect(info.first_name).toBe('НовоеИмя');
        expect(info.last_name).toBe('НоваяФамилия');
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('смена темы оформления применяется к странице', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await page.getByTestId('edit-profile-btn').click();
        await page.getByTestId('edit-theme').selectOption('forest');
        await page.getByTestId('edit-profile-save').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'forest');
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('пустой телефон показывает ошибку', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await page.getByTestId('edit-profile-btn').click();
        await page.evaluate(() => {
          const input = document.getElementById('id_phone') as HTMLInputElement;
          input.value = '';
        });
        await page.evaluate(() => {
          const form = document.getElementById('editForm') as HTMLFormElement;
          form.submit();
        });
        await expect(page.getByTestId('edit-modal')).toBeVisible();
        await expect(page.locator('.modal-error')).toContainText('Номер телефона обязателен');
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('неверный формат телефона показывает ошибку', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await page.getByTestId('edit-profile-btn').click();
        await fillPhoneField(page, '[data-test-id="edit-phone"]', '123');
        await page.getByTestId('edit-profile-save').click();
        await expect(page.getByTestId('edit-modal')).toBeVisible();
        await expect(page.locator('.modal-error')).toContainText('Неверный формат телефона');
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('чужой телефон показывает ошибку о занятости номера', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await page.getByTestId('edit-profile-btn').click();
        await fillPhoneField(page, '[data-test-id="edit-phone"]', '+73333333333');
        await page.getByTestId('edit-profile-save').click();
        await expect(page.getByTestId('edit-modal')).toBeVisible();
        await expect(page.locator('.modal-error')).toContainText('Этот номер телефона уже используется');
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('телефон, начинающийся с 8, конвертируется в +7', async ({ page }) => {
      const phone = uniquePhone();
      const digits = phone.replace(/\D/g, '');
      const raw8 = '8' + digits.slice(1);
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await page.getByTestId('edit-profile-btn').click();
        await fillPhoneField(page, '[data-test-id="edit-phone"]', raw8);
        await page.getByTestId('edit-profile-save').click();
        await expect(page.getByTestId('edit-modal')).toBeHidden();
        await expect(page.getByTestId('profile-phone')).toContainText(phone);
      } finally {
        await deleteTestUser(page, phone);
      }
    });
  });

  test.describe('Редактирование — безопасность', () => {
    test('сохранение своего же телефона не считается дубликатом', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await page.getByTestId('edit-profile-btn').click();
        await fillPhoneField(page, '[data-test-id="edit-phone"]', phone);
        await page.getByTestId('edit-profile-save').click();
        await expect(page.getByTestId('edit-modal')).toBeHidden();
        await expect(page.getByTestId('profile-phone')).toContainText(phone);
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('попытка изменить баланс в POST игнорируется', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await page.evaluate(() => {
          const form = document.getElementById('editForm') as HTMLFormElement;
          const h = document.createElement('input');
          h.type = 'hidden';
          h.name = 'balance';
          h.value = '999999';
          form.appendChild(h);
          form.submit();
        });
        await expect(page.getByTestId('profile-phone')).toBeVisible();
        const info = await getUserInfo(page, phone);
        expect(info.balance).toBe('0.00');
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('попытка изменить роль в POST игнорируется', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await page.evaluate(() => {
          const form = document.getElementById('editForm') as HTMLFormElement;
          const h = document.createElement('input');
          h.type = 'hidden';
          h.name = 'role';
          h.value = 'admin';
          form.appendChild(h);
          form.submit();
        });
        await expect(page.getByTestId('profile-phone')).toBeVisible();
        const resp = await page.request.get('/api/clients/search/?q=тест');
        expect(resp.status()).toBe(403);
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('POST в /profile/ изменяет только текущего пользователя', async ({ page }) => {
      const phoneA = uniquePhone();
      const phoneB = uniquePhone();
      await registerNewUser(page, phoneA);
      const infoA = await getUserInfo(page, phoneA);
      await registerNewUser(page, phoneB);
      try {
        await page.goto('/profile/');
        await page.getByTestId('edit-profile-btn').click();
        await page.getByTestId('edit-first-name').fill('Взломщик');
        await page.evaluate((userId) => {
          const form = document.getElementById('editForm') as HTMLFormElement;
          const h = document.createElement('input');
          h.type = 'hidden';
          h.name = 'user_id';
          h.value = String(userId);
          form.appendChild(h);
        }, infoA.id);
        await page.getByTestId('edit-profile-save').click();
        await expect(page.getByTestId('profile-first-name')).toHaveText('Взломщик');
        const afterA = await getUserInfo(page, phoneA);
        expect(afterA.first_name).not.toBe('Взломщик');
      } finally {
        await deleteTestUser(page, phoneB);
        await deleteTestUser(page, phoneA);
      }
    });
  });

  test.describe('Пустые состояния', () => {
    test('нет активных абонементов', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await expect(page.getByTestId('profile-no-subscriptions')).toHaveText('Нет активных абонементов');
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('нет предстоящих занятий', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await expect(page.getByTestId('profile-no-upcoming')).toHaveText('Нет предстоящих занятий');
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('история пуста', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await expect(page.getByTestId('profile-no-history')).toHaveText('История пуста');
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('баланс отображается как 0 ₽', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await expect(page.getByTestId('profile-balance')).toHaveText('0 ₽');
      } finally {
        await deleteTestUser(page, phone);
      }
    });
  });

  test.describe('Наполненные состояния (студент 5)', () => {
    test('баланс отображается в рублях', async ({ page }) => {
      await expect(page.getByTestId('profile-balance')).toContainText('₽');
    });

    test('история посещений показывает прошлые занятия и тепловую карту', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      const uid = (await getUserInfo(page, phone)).id!;
      const eventDate = futureDay(364).split('T')[0];
      let eventId = 0;
      try {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await cleanupEventsOnDate(page, eventDate);
        const ev = await createCalendarEvent(page, {
          class_type_id: 1,
          start: futureDay(364),
          duration: 60,
          hall_id: 2,
          tariff_id: 3,
          max_participants_override: 10,
        });
        expect(ev.success).toBe(true);
        eventId = ev.event!.id;
        await createPastAttendance(page, uid, eventId, 1440);

        await page.context().clearCookies();
        await loginAsStudent(page, phone);
        await page.goto('/profile/');

        const sectionRows = page.getByTestId('profile-past-session');
        expect(await sectionRows.count()).toBeGreaterThanOrEqual(1);

        await page.getByTestId('history-btn').click();
        await expect(page.getByTestId('history-modal')).toBeVisible();
        const modalRows = page.locator('#historyList').getByTestId('profile-past-session');
        expect(await modalRows.count()).toBeGreaterThanOrEqual(1);

        const cells = page.locator('#heatmapGrid .hm-cell');
        expect(await cells.count()).toBeGreaterThan(350);
        const colored = page.locator(
          '#heatmapGrid .hm-cell.l1, #heatmapGrid .hm-cell.l2, #heatmapGrid .hm-cell.l3, #heatmapGrid .hm-cell.l4',
        );
        expect(await colored.count()).toBeGreaterThanOrEqual(1);
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

  test.describe('Модальное окно истории посещений', () => {
    test('кнопка "Все" открывает модалку истории', async ({ page }) => {
      await page.getByTestId('history-btn').click();
      await expect(page.getByTestId('history-modal')).toBeVisible();
    });

    test('история содержит тепловую карту', async ({ page }) => {
      await page.getByTestId('history-btn').click();
      await expect(page.getByTestId('history-modal')).toBeVisible();
      await expect(page.locator('#heatmapGrid')).toBeVisible();
    });

    test('крестик закрывает модалку истории', async ({ page }) => {
      await page.getByTestId('history-btn').click();
      await expect(page.getByTestId('history-modal')).toBeVisible();
      await page.getByTestId('history-close').click();
      await expect(page.getByTestId('history-modal')).toBeHidden();
    });

    test('клик по оверлею закрывает модалку истории', async ({ page }) => {
      await page.getByTestId('history-btn').click();
      await expect(page.getByTestId('history-modal')).toBeVisible();
      await page.getByTestId('history-modal').click({ position: { x: 5, y: 5 } });
      await expect(page.getByTestId('history-modal')).toBeHidden();
    });
  });

  test.describe('Модальное окно подтверждения', () => {
    test('модалка подтверждения скрыта по умолчанию', async ({ page }) => {
      await expect(page.getByTestId('confirm-modal')).toBeHidden();
    });
  });

  test.describe('Активный абонемент на профиле', () => {
    test('после покупки абонемент отображается в секции баланса', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      const info = await getUserInfo(page, phone);
      const uid = info.id!;
      try {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await setAllowedTariffs(page, uid, [3]);
        await setBalance(page, uid, 50000);
        await page.context().clearCookies();
        await loginAsStudent(page, phone);

        const res = await purchaseSubscription(page, 3);
        expect(res.success).toBe(true);

        await page.goto('/profile/');
        await expect(page.getByTestId('profile-sub-item')).toHaveCount(1);
        await expect(page.getByTestId('profile-sub-name')).toContainText('Сплит');
        await expect(page.getByTestId('profile-sub-count')).toHaveText(/^\d+ из \d+ занятий/);
      } finally {
        await deleteTestUser(page, phone);
      }
    });
  });

  test.describe('История баланса', () => {
    test('пополнение и покупка абонемента появляются в истории', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      const uid = (await getUserInfo(page, phone)).id!;
      try {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await setAllowedTariffs(page, uid, [3]);
        await setBalance(page, uid, 50000);
        await page.context().clearCookies();
        await loginAsStudent(page, phone);

        await topupViaWebhook(page, uid, 1000);
        const res = await purchaseSubscription(page, 3);
        expect(res.success).toBe(true);

        await page.goto('/profile/');
        const rows = page.getByTestId('balance-transaction').filter({ visible: true });
        await expect(rows).toHaveCount(2);
        // Самая свежая — покупка абонемента (списание)
        await expect(rows.first()).toContainText('Покупка абонемента');
        await expect(rows.first().getByTestId('balance-amount')).toContainText('−8000,00 ₽');
        await expect(rows.first().getByTestId('balance-amount')).toHaveClass(/amount-debit/);
        // Раньше — пополнение (зачисление)
        await expect(rows.nth(1)).toContainText('Пополнение');
        await expect(rows.nth(1).getByTestId('balance-amount')).toContainText('+1000,00 ₽');
        await expect(rows.nth(1).getByTestId('balance-amount')).toHaveClass(/amount-credit/);
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('модалка показывает все операции и закрывается', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      const uid = (await getUserInfo(page, phone)).id!;
      try {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await setBalance(page, uid, 10000);
        await page.context().clearCookies();
        await loginAsStudent(page, phone);

        await topupViaWebhook(page, uid, 500);
        await topupViaWebhook(page, uid, 700);

        await page.goto('/profile/');
        await page.getByTestId('balance-history-btn').click();
        await expect(page.getByTestId('balance-history-modal')).toBeVisible();
        const modalRows = page.locator('#balanceHistoryList .balance-transaction');
        await expect(modalRows).toHaveCount(2);
        const amounts = (await modalRows.getByTestId('balance-amount').allTextContents()).map((s) =>
          s.replace(/\s+/g, ' ').trim(),
        );
        expect(amounts).toEqual(expect.arrayContaining(['+700,00 ₽', '+500,00 ₽']));

        await page.getByTestId('balance-history-close').click();
        await expect(page.getByTestId('balance-history-modal')).toBeHidden();
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('у пользователя без операций история пуста', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await expect(page.getByTestId('profile-no-balance-history')).toHaveText('Нет операций');
        await expect(page.getByTestId('balance-history-btn')).toHaveCount(0);
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('использование абонемента за занятие появляется в истории', async ({ page }) => {
      const t = await getResolvedTestTariffs(page);
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      const uid = (await getUserInfo(page, phone)).id!;
      const eventDate = futureDay(3).split('T')[0];
      let eventId = 0;
      try {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await cleanupEventsOnDate(page, eventDate);
        await setAllowedTariffs(page, uid, [t.groupId]);
        await setBalance(page, uid, 10000);
        const ev = await createCalendarEvent(page, {
          class_type_id: 1,
          start: futureDay(3),
          duration: 60,
          hall_id: 2,
          tariff_id: t.groupId,
          max_participants_override: 10,
        });
        expect(ev.success).toBe(true);
        eventId = ev.event!.id;

        await page.context().clearCookies();
        await loginAsStudent(page, phone);
        const buy = await purchaseSubscription(page, t.groupId);
        expect(buy.success).toBe(true);
        const enroll = await enrollToEvent(page, eventId);
        expect(enroll.success).toBe(true);

        await page.goto('/profile/');
        const rows = page.getByTestId('balance-transaction').filter({ visible: true });
        await expect(rows).toHaveCount(2);
        // Использование абонемента — самая свежая (баланс не меняется → нейтральная)
        await expect(rows.first()).toContainText('Использование абонемента');
        await expect(rows.first().getByTestId('balance-amount')).toHaveClass(/amount-neutral/);
        // Покупка абонемента — раньше
        await expect(rows.nth(1)).toContainText('Покупка абонемента');
      } finally {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        if (eventId) {
          await deleteCalendarEvent(page, eventId);
        }
        await deleteTestUser(page, phone);
      }
    });

    test('списание с баланса и возврат за занятие появляются в истории', async ({ page }) => {
      const t = await getResolvedTestTariffs(page);
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      const uid = (await getUserInfo(page, phone)).id!;
      const eventDate = futureDay(5).split('T')[0];
      let eventId = 0;
      try {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await cleanupEventsOnDate(page, eventDate);
        await setAllowedTariffs(page, uid, [t.groupId]);
        await setBalance(page, uid, 10000);
        const ev = await createCalendarEvent(page, {
          class_type_id: 1,
          start: futureDay(5),
          duration: 60,
          hall_id: 2,
          tariff_id: t.groupId,
          max_participants_override: 10,
        });
        expect(ev.success).toBe(true);
        eventId = ev.event!.id;

        await page.context().clearCookies();
        await loginAsStudent(page, phone);
        const enroll = await enrollToEvent(page, eventId);
        expect(enroll.success).toBe(true);
        const cancel = await cancelEnrollment(page, eventId);
        expect(cancel.success).toBe(true);

        await page.goto('/profile/');
        const rows = page.getByTestId('balance-transaction').filter({ visible: true });
        await expect(rows).toHaveCount(2);
        // Самая свежая — возврат (зачисление)
        await expect(rows.first()).toContainText('Возврат средств');
        await expect(rows.first().getByTestId('balance-amount')).toContainText(`+${formatRu(t.groupSessionPrice)} ₽`);
        await expect(rows.nth(1)).toContainText('Оплата занятия');
        await expect(rows.nth(1).getByTestId('balance-amount')).toContainText(`−${formatRu(t.groupSessionPrice)} ₽`);
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

  test.describe('Предстоящие занятия на профиле', () => {
    test('запись на занятие показывает его в списке предстоящих', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      const info = await getUserInfo(page, phone);
      const uid = info.id!;
      const eventDate = futureDay(3).split('T')[0];
      let eventId = 0;
      try {
        await page.context().clearCookies();
        await loginAsAdmin(page);
        await cleanupEventsOnDate(page, eventDate);
        await setAllowedTariffs(page, uid, [3]);
        await setBalance(page, uid, 10000);
        const res = await createCalendarEvent(page, {
          class_type_id: 1,
          start: futureDay(3),
          duration: 60,
          hall_id: 2,
          tariff_id: 3,
          max_participants_override: 10,
        });
        expect(res.success).toBe(true);
        eventId = res.event!.id;

        await page.context().clearCookies();
        await loginAsStudent(page, phone);
        const enroll = await enrollToEvent(page, eventId);
        expect(enroll.success).toBe(true);

        await page.goto('/profile/');
        await expect(page.getByTestId('profile-upcoming-session')).toHaveCount(1);
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

  test.describe('Секция абонементов', () => {
    test('отображается заголовок "Баланс"', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'Баланс', exact: true })).toBeVisible();
    });
  });

  test.describe('Секция предстоящих занятий', () => {
    test('отображается заголовок "Предстоящие занятия"', async ({ page }) => {
      await expect(page.locator('section.profile-section h2').filter({ hasText: 'Предстоящие занятия' })).toBeVisible();
    });
  });

  test.describe('Секция достижений', () => {
    test('отображается заголовок "Достижения"', async ({ page }) => {
      await expect(page.locator('section.profile-section h2').filter({ hasText: 'Достижения' })).toBeVisible();
    });
  });

  test.describe('Секция соцсетей', () => {
    test('отображается заголовок "Привязанные соцсети"', async ({ page }) => {
      await expect(page.locator('section.profile-section h2').filter({ hasText: 'Привязанные соцсети' })).toBeVisible();
    });
  });

  test.describe('VK секция', () => {
    test('кнопка VK привязки видна', async ({ page }) => {
      await expect(page.getByTestId('vk-toggle-btn')).toBeVisible();
    });

    test('для привязанного VK показывается блок с отвязкой и сообщениями', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await attachVk(page, `test-vk-${Date.now()}`);
        await page.goto('/profile/');
        await expect(page.getByText('VK ID привязан')).toBeVisible();
        await expect(page.getByTestId('vk-toggle-btn')).toContainText('Отвязать');
        await expect(page.getByTestId('vk-message-link')).toBeVisible();
        await expect(page.getByTestId('vk-test-btn')).toBeVisible();
        await expect(page.getByText('VK уведомления не активны')).toBeVisible();
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('для непривязанного VK показывается кнопка привязки', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await expect(page.getByText('VK ID не привязан')).toBeVisible();
        await expect(page.getByTestId('vk-toggle-btn')).toContainText('Привязать');
        await expect(page.getByTestId('vk-message-link')).toHaveCount(0);
        await expect(page.getByTestId('vk-test-btn')).toHaveCount(0);
      } finally {
        await deleteTestUser(page, phone);
      }
    });
  });

  test.describe('Аватар', () => {
    test('загрузка корректного изображения показывает аватар и кнопку удаления', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await expect(page.locator('.profile-avatar-placeholder')).toBeVisible();
        await uploadAvatar(page);
        await expect(page.getByTestId('avatar-delete-btn')).toBeVisible();
        await expect(page.locator('.profile-avatar-img')).toBeVisible();

        // Файл реально сохранён и доступен по URL
        const src = await page.locator('.profile-avatar-img').getAttribute('src');
        expect(src).toBeTruthy();
        const mediaRes = await page.request.get(src!);
        expect(mediaRes.status()).toBe(200);
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('загрузка текстового файла отклоняется с ошибкой', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await setAvatarFile(page, {
          name: 'avatar.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('это не картинка'),
        });
        await expect(page.getByTestId('avatar-error')).toBeVisible();
        await expect(page.getByTestId('avatar-error')).toContainText('Загрузите файл изображения');
        await expect(page.locator('.profile-avatar-placeholder')).toBeVisible();
        await expect(page.getByTestId('avatar-delete-btn')).toHaveCount(0);
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('загрузка переименованного не-изображения отклоняется (mime-спуфинг)', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await setAvatarFile(page, {
          name: 'avatar.png',
          mimeType: 'image/png',
          buffer: Buffer.from('просто текст, а не PNG'),
        });
        await expect(page.getByTestId('avatar-error')).toBeVisible();
        await expect(page.getByTestId('avatar-error')).toContainText('Загрузите файл изображения');
        await expect(page.locator('.profile-avatar-placeholder')).toBeVisible();
        await expect(page.getByTestId('avatar-delete-btn')).toHaveCount(0);
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('слишком маленькое изображение отклоняется с ошибкой', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await setAvatarFile(page, {
          name: 'tiny.png',
          mimeType: 'image/png',
          buffer: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
            'base64',
          ),
        });
        await expect(page.getByTestId('avatar-error')).toBeVisible();
        await expect(page.getByTestId('avatar-error')).toContainText('слишком маленькое');
        await expect(page.locator('.profile-avatar-placeholder')).toBeVisible();
        await expect(page.getByTestId('avatar-delete-btn')).toHaveCount(0);
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('слишком большой файл отклоняется с ошибкой', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await setAvatarFile(page, {
          name: 'big.png',
          mimeType: 'image/png',
          buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
        });
        await expect(page.getByTestId('avatar-error')).toBeVisible();
        await expect(page.getByTestId('avatar-error')).toContainText('превышать 5 МБ');
        await expect(page.locator('.profile-avatar-placeholder')).toBeVisible();
        await expect(page.getByTestId('avatar-delete-btn')).toHaveCount(0);
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('удаление пользователя удаляет файл аватара', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      let src = '';
      try {
        await page.goto('/profile/');
        await uploadAvatar(page);
        src = (await page.locator('.profile-avatar-img').getAttribute('src')) || '';
        expect(src).not.toBe('');
        expect((await page.request.get(src)).status()).toBe(200);
      } finally {
        await deleteTestUser(page, phone);
      }
      // После удаления пользователя файл аватара тоже удалён
      const afterDelete = await page.request.get(src);
      expect(afterDelete.status()).toBe(404);
    });

    test('удаление фотографии через подтверждение', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await uploadAvatar(page);
        await page.getByTestId('avatar-delete-btn').click();
        await expect(page.getByTestId('confirm-modal')).toBeVisible();
        await page.getByTestId('confirm-yes').click();
        await expect(page.locator('.profile-avatar-placeholder')).toBeVisible();
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('отмена подтверждения не удаляет фотографию', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await uploadAvatar(page);
        await page.getByTestId('avatar-delete-btn').click();
        await expect(page.getByTestId('confirm-modal')).toBeVisible();
        await page.getByTestId('confirm-no').click();
        await expect(page.getByTestId('confirm-modal')).toBeHidden();
        await expect(page.locator('.profile-avatar-img')).toBeVisible();
      } finally {
        await deleteTestUser(page, phone);
      }
    });

    test('клик по фону подтверждения не удаляет фотографию', async ({ page }) => {
      const phone = uniquePhone();
      await registerNewUser(page, phone);
      try {
        await page.goto('/profile/');
        await uploadAvatar(page);
        await page.getByTestId('avatar-delete-btn').click();
        await expect(page.getByTestId('confirm-modal')).toBeVisible();
        await page.getByTestId('confirm-modal').click({ position: { x: 5, y: 5 } });
        await expect(page.getByTestId('confirm-modal')).toBeHidden();
        await expect(page.locator('.profile-avatar-img')).toBeVisible();
      } finally {
        await deleteTestUser(page, phone);
      }
    });
  });

  test.describe('Выход', () => {
    test('форма выхода содержит POST action', async ({ page }) => {
      const logoutForm = page.locator('form').filter({ has: page.getByTestId('logout-btn') });
      await expect(logoutForm).toHaveAttribute('method', 'post');
    });

    test('нажатие "Выйти из аккаунта" выходит из аккаунта', async ({ page }) => {
      await page.getByTestId('logout-btn').click();
      await expect(page).toHaveURL(`${BASE_URL}login/`);
      await page.goto('/profile/');
      await expect(page).toHaveURL(`${BASE_URL}login/?next=/profile/`);
    });
  });

  test.describe('Скрытые формы', () => {
    test('форма аватара существует', async ({ page }) => {
      await expect(page.getByTestId('avatar-form')).toBeAttached();
    });

    test('инпут аватара принимает изображения', async ({ page }) => {
      await expect(page.getByTestId('avatar-input')).toHaveAttribute('accept', 'image/*');
    });
  });
});
