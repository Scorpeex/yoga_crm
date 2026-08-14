# AGENTS.md — project conventions & context

## Stack
- Django 6.0.5, SQLite, Python 3
- FullCalendar.js v6 (CDN), vanilla JS, no jQuery
- Lucide icons via CDN
- Waitress (production), nginx reverse proxy
- YooKassa online payments (live keys: shop_id=1382572)

## Django config
- `USE_TZ=False`, timezone `Asia/Novosibirsk` (UTC+7)
- Auth: `PhoneAuthBackend` in `core/auth_backend.py` — normalises digits. Телефон-путь (перебор всех пользователей по `normalize_phone(phone/username)`) работает **только если во вводе есть цифры**; иначе (логин по username типа `admin`) — точное совпадение `username`. Без этого `'admin'` нормализуется в `''` и совпадает с пустым телефоном любого пользователя (баг 13.08.2026)
- `AUTHENTICATION_BACKENDS`: `PhoneAuthBackend` first, then `ModelBackend`
- Login form cleans phone: strips non-digit chars → `+7XXXXXXXXXX`

## Roles
- `student` / `moderator` / `admin` (field on User model)

## Deployment
- **Production**: nginx → waitress on `127.0.0.1:8001`, SSL via Let's Encrypt (win-acme)
- **Demo**: `demo.alenaproyoga.ru`, nginx → waitress on `127.0.0.1:8002`, separate DB (`demo_db.sqlite3`), separate settings (`settings_demo.py`)
- Static/media served by nginx in production, by Django when hitting waitress directly
- Restart scripts: `restart_waitress.bat` (main), `restart_waitress _demo.bat` (demo — needs `DJANGO_SETTINGS_MODULE=yoga_crm.settings_demo`)

## Models (core)
- `User(AbstractUser)`: role, `phone`, `balance` (Decimal), `allowed_tariffs` M2M, `vk_user_id`, `vk_messages_allowed`, `avatar`, `theme`
- `Tariff`: name, type (group/individual/split), price, `subscription_price`, `subscription_sessions_count`, `subscription_validity_days`, `is_subscription_available`
- `ClassSession`: linked to `ClassType`, `Hall`, `Tariff`; date_time, duration, max_participants_override, is_recurring
- `ClassType`: name, color, duration_minutes, default_tariff
- `Hall`: name, color, `text_color` (пусто = авто-контраст через `get_effective_text_color()`, `get_contrast_color()`; админка трактует `#000000` как «пусто», чтобы нативный `<input type="color">` не перетирал auto чёрным)
- `Booking`: links User→ClassSession, statuses: pending/confirmed/paid/cancelled/cancelled_by_admin/no_show; unique on (session, client)
- `Subscription`: linked to User+Tariff; `sessions_total`/`sessions_remaining`, `purchased_at`, `activated_at`, `expires_at`, `status`, `total_price`
- `PaymentTransaction`: ledger for all money/subscription movements; types: deposit, debit, refund, adjustment, subscription_purchase, subscription_renewal
- `InAppNotification`: user, title, message, link, is_read, created_at
- **`__str__` null-safe FK-рендеринг** (инцидент 13.08.2026): удаление тарифа в админке падало `DoesNotExist: User matching query does not exist` на GET-странице подтверждения — Django рендерит PROTECT-блокеры через `Subscription.__str__` (models.py:419), а в БД остались осиротевшие Subscription/PaymentTransaction с `client_id` удалённых тест-пользователей. `Booking.__str__`, `PaymentTransaction.__str__`, `Subscription.__str__` (client), `Attendance.__str__`, `Payment.__str__` (client), `Subscription.__str__` (tariff) теперь отображают «Клиент #id»/«—» при отсутствующей записи
- **Осиротевшие FK: причина и защита** (13.08.2026): сироты появляются при удалении пользователя НЕ через Django ORM (внешний инструмент/скрипт): SQLite-редактор Django не генерирует `ON DELETE CASCADE` (`sql_create_fk=None`), в DDL голый `REFERENCES ... DEFERRABLE INITIALLY DEFERRED`, а `PRAGMA foreign_keys` — per-connection (Django ставит `ON` сам, внешние инструменты по умолчанию `OFF`). Поэтому сырое `DELETE FROM core_user ...` оставляет дочерние Subscription/PaymentTransaction/M2M-строки (`core_user_allowed_tariffs`) с мёртвым `client_id`; ORM-каскад при этом не работает. Защита — **management-команда `python manage.py check_orphans`**: общий проход `PRAGMA foreign_key_check` (отчёт) + `--delete` (удаление в транзакции, каскадом-циклом через ORM-коллектор, чтобы SET_NULL-дочки не пострадали). Тест-сервер авто-чистит при старте (`_cleanup_orphans()` в `runserver_test.py`). **Правило: db.sqlite3 не редактировать вне Django ORM; после ручной правки запускать `check_orphans --delete`**

## Business logic (core/services.py)
- `PaymentService.create_booking()` — charges immediately (subscription first, then balance)
- `PaymentService.cancel_booking()` → `refund_booking()` — refunds to balance or subscription
- `PaymentService.purchase_subscription(client, tariff)` — deducts from balance, creates Subscription (no `expires_at` until first use → `activate()` sets it)
- `PaymentService.renew_subscription(subscription, comment="")` — deducts from balance, adds sessions, extends `expires_at` (`max(current, now) + validity_days`); `comment` (опционально) сохраняется в `subscription.comment` — обязателен для вызова из YooKassa-колбэка (иначе TypeError → 500)
- `PaymentService.deposit_balance()` — adds to balance, creates PaymentTransaction
- `PaymentService.can_renew_subscription()` — checks: active status, tariff active, sessions_remaining ≤ 1 OR expires_at ≤ now OR expires before next session

## Subscription lifecycle
1. **Buy**: checks no active sub exists → if balance sufficient → `purchase_subscription()` deducts → creates Subscription (status='active', `activated_at`=null, `expires_at`=null)
2. **First use**: `activate()` called → sets `activated_at=now`, `expires_at=activated_at + validity_days`
3. **Use session**: `use_session()` → decrements `sessions_remaining`, sets status='used_up' when 0, sets status='expired' if past `expires_at`
4. **Renew**: calls `renew_subscription()` → adds sessions, extends `expires_at` — button shown on home page when ≤1 session remaining
5. **Block buying new**: blocked via `purchase_subscription_view` if any active sub with `sessions_remaining > 0` exists

## Payment flow (YooKassa)
- **Top-up**: `/api/balance/top-up/` → creates YooKassa payment → callback adds balance via `PaymentService.deposit_balance()`
- **Purchase subscription**: `/api/purchase-subscription/` → checks active sub + balance → if balance sufficient, purchases directly (no YooKassa); if insufficient, returns `need_top_up`
- **Renew subscription**: `/api/renew-subscription/` → same pattern: balance check first, YooKassa only not needed for top-up
- **Callback**: `/api/yookassa/callback/` — handles topup, purchase, renewal via metadata action field; dedup via payment_id

## Frontend patterns
- CSS: single shared `style.css` with CSS custom properties (`:root` + `[data-theme="..."]`), plus page-specific `auth.css`/`calendar.css`/`admin_custom.css`
- Themes: default, yoga, forest, ocean, midnight
- Mobile breakpoint: 768px; bottom nav fixed at bottom
- No `alert()` — `showNotification(msg, isError)` (centered modal), custom confirm modals
- Modals use `.modal-overlay` (flex centered) + `.modal-card`
- `showNotification()` defined in `auth_base.html`, available on all pages
- YooKassa widget (`openYooKassaWidget(token, returnUrl)`) — shared helper in shop.html & home.html

## Common JS patterns
- Purchase/renew flow: modal → fetch → handle `balance_used` (success + reload) or `need_top_up` (show topup button in modal)
- Topup from purchase/renew modal: automatically calculates `price - balance`, calls `/api/balance/top-up/`, opens YooKassa widget
- Balance check is done BOTH frontend (modal visibility) and backend (API); backend is authoritative
- **История баланса** (profile): секция `profile.html` показывает последние 5 операций + кнопка «Все» → модалка `balanceHistoryModal`. Данные — `PaymentTransaction` из контекста `profile_detail_view` (`balance_transactions`, `order_by('-created_at')`, последние 200). Строка (`includes/balance_transaction_row.html`, `data-test-id="balance-transaction"`): дата+время, `comment` (fallback `get_transaction_type_display`), сумма со знаком по `balance_after` vs `balance_before` (+ зелёная `amount-credit` / − красная `amount-debit` / нейтральная `amount-neutral` при абонементном списании, где баланс не меняется), «Баланс после». Decimal-суммы рендерятся с запятой (например `−8000,00 ₽`). Транзакции уже создаются в 8 местах `core/services.py`; новые хелпер `topupViaWebhook` имитирует вебхук ЮKassa (`topup`) для создания реального deposit
- **Locked tariff cards** (shop + home): all active subscription tariffs are rendered; those NOT in `allowed_tariffs` get class `subscription-card--locked` (`data-test-id="subscription-card-locked"`) with a `tariff-request-btn` button "Обратитесь к администратору для покупки тарифа" instead of the purchase button. Click → POST `/api/tariff/request-access/` → sends VK message to admin(s) with `vk_user_id` (role='admin') + admin-panel link to grant access; button becomes disabled "Запрос отправлен". Anti-spam: 1 request per tariff per 60s (session)

## Key URLs
| URL | View | Purpose |
|---|---|---|
| `/` | `home_view` | Main dashboard |
| `/calendar/` | `calendar_view` | Schedule |
| `/shop/` | `shop_view` | Buy subscriptions, top-up balance |
| `/profile/` | `profile_detail_view` | User profile, subscription list |
| `/admin/` | Django admin | Admin panel |
| `/news/` | `news_list` | News list (moderator/admin) |
| `/news/create/` | `news_create` | Create news |
| `/news/<pk>/edit/` | `news_edit` | Edit news |
| `/news/<pk>/delete/` | `news_delete` | Delete news |
| `/api/purchase-subscription/` | `purchase_subscription_view` | POST — buy sub |
| `/api/renew-subscription/` | `renew_subscription_view` | POST — renew sub |
| `/api/tariff/request-access/` | `request_tariff_access_view` | POST — VK-запрос администратору на доступ к тарифу |
| `/api/balance/top-up/` | `top_up_balance_view` | POST — top-up via YooKassa |
| `/api/yookassa/callback/` | `yookassa_callback` | POST — YooKassa webhook |
| `/api/auth/vk/test/` | `vk_auth_test` | POST — test VK auth (DEBUG only) |
| `/api/auth/test/user-info/` | `test_user_info` | POST — get user info by phone (DEBUG only) |
| `/api/auth/test/delete-user/` | `test_delete_user` | POST — delete user by phone (DEBUG only) |
| `/api/auth/test/my-info/` | `test_my_info` | POST — current user balance + subscription (DEBUG only) |
| `/api/auth/test/set-allowed-tariffs/` | `test_set_allowed_tariffs` | POST — staff, set user allowed_tariffs (DEBUG only) |
| `/api/auth/test/delete-subscriptions/` | `test_delete_subscriptions` | POST — staff, delete all user subscriptions (DEBUG only) |
| `/api/auth/test/set-balance/` | `test_set_balance` | POST — staff, set user balance (DEBUG only) |
| `/api/auth/test/create-notifications/` | `test_create_notifications` | POST — create unread notifications by phone (DEBUG only) |
| `/api/auth/test/delete-notifications/` | `test_delete_notifications` | POST — delete all notifications by phone (DEBUG only) |

## Testing
- **Только Playwright**: `core/tests.py` удалён (все 54 джанго-сценария портированы в E2E). Django-тестов больше нет.
- **Playwright E2E tests**: 307 tests in `tests/` — run: `BASE_URL=http://127.0.0.1:8003/ npx playwright test`
  - **Стратегия «прагматичный гибрид»**: мутирующие тесты (баланс/абонементы/подписки/посещения/VK/уведомления) создают свежих пользователей (`registerNewUser` + `setBalance` + `setAllowedTariffs`) и убирают за собой (`deleteTestUser`); засеянные s5/s6 — только read-only (логин, отображение). `runserver_test.py` при старте авто-чинит канонических s5/s6 (`_ensure_test_users()`): `username=phone=+73333333333/+74444444444`, `balance=5500/0`, `allowed_tariffs=[3]`, пароль `stud123` — поэтому даже после случайного `deleteTestUser` read-only тесты не сломаются
  - Dev test server: `python runserver_test.py` (port 8003, `DEBUG=True`). Скрипт навешивает `connection_created`-сигнал: `PRAGMA journal_mode=WAL;` + `busy_timeout=30000` + `synchronous=NORMAL` — убирает «database is locked» при параллельных воркерах (5), и при старте авто-чистит осиротевшие FK-строки (`_cleanup_orphans()` → `check_orphans --delete`). После правки скрипта сервер нужно перезапустить
  - Config: `playwright.config.js` (CJS, `testIdAttribute: 'data-test-id'`)
  - `tests/fixtures/helpers.ts`: shared helpers (`loginAsStudent`, `fillPhoneField`, `fillRegisterForm`, `getUserInfo`, `deleteTestUser`, `createCalendarEvent`, `deleteCalendarEvent`, `cleanupEventsOnDate`, `getCurrentUserInfo`, `setAllowedTariffs`, `deleteUserSubscriptions`, `setBalance`, `topupViaWebhook`, `createNotifications`, `deleteNotifications`, `getUnreadNotificationCount`, `purchaseSubscription`, `enrollToEvent`, `cancelEnrollment`, `uniquePhone`, `registerNewUser`, `uploadAvatar`, `moveSessionToPast`, `expireSubscription`, `attachVk`, `createPastAttendance`, `UserInfo.id`)
  - `loginAsModerator` — перебирает пароли `['mod123', 'admin123']` (реальный пароль модератора в основной БД — `admin123`, не `mod123`)
  - `tests/fixtures/widget-stub.ts`: стаб YooKassa-виджета (`installWidgetStub` → `window.createPaymentWidget` → `window.widgetLog[]`, `WidgetLogEntry`, `getWidgetLog`) — импортируется в `home.spec.ts` и `shop.spec.ts`, чтобы не грузился CDN-скрипт
  - **VK SDK стаб** (тест «VK конфигурация» в `tests/auth/login.spec.ts`): реальный SDK грузится динамически из `vk-auth.js`, поэтому подмена через `addInitScript` гоняется с загрузкой (SDK из кэша перезаписывает стаб). Надёжно работает перехват через `page.route('**/unpkg.com/@vkid/**')` → `route.fulfill` со стаб-UMD (`window.VKIDSDK = {...}`), который захватывает конфиг из `Config.init` в `window.__vkCapturedConfig`
  - **VK-конфиг**: попап-авторизация — `ConfigAuthMode.InNewWindow` + `ConfigResponseMode.Callback` (вкладка не навигируется, результат приходит через postMessage → `LOGIN_SUCCESS` → `exchangeCode`; привязка VK на профиле тоже делает `exchangeCode` после `Auth.login()`). `handleVKCallback` и подавление кодов 0/2 оставлены как фолбэк для `/api/auth/vk/?code=...` (возврат из приложения VK на мобильных обрабатывает серверная `vk_auth` GET). После VK-логина редирект — на `/dashboard/` (не на `/profile/`); привязка VK уже залогиненным пользователем остаётся на `/profile/`
  - **Мост попап → вкладка**: VK часто НЕ шлёт postMessage обратно (попап доезжает до `/login/?code=...` и логинится там сам). При этом **`window.opener` в попапе может быть оборван** переходом через id.vk.ru — полагаться на него нельзя. Поэтому при успехе в попапе (`vkidOnSuccess`) работают ДВА независимых моста: (1) `localStorage.setItem('vkAuthSuccess', JSON.stringify({redirect_url, ts}))` → на исходной вкладке слушатель `window.addEventListener('storage')` (событие приходит в другие вкладки того же origin) ставит `window.__vkAuthSuccess` и редиректит; (2) `window.opener.postMessage({type:'VK_AUTH_SUCCESS', redirect_url})` — быстрый путь, если opener уцелел. Затем попап закрывается (`window.close()`), а при невозможности закрыть — фолбэк-навигация на `redirect_url`. Тесты в `tests/auth/login.spec.ts`: «мост попапа: VK_AUTH_SUCCESS…» (диспатч postMessage → URL содержит `/dashboard/`) и «мост через localStorage: запись из попапа переводит исходную вкладку» (реальные два окна: `window.open('/login/')` + запись в localStorage → исходная вкладка уходит на `/dashboard/`). Привязка VK на профиле: в `.catch` пропуск тоста, если `window.__vkAuthSuccess`
  - **Возврат из VK без мигания формой**: на `/login/?code=...` (попап или мобильный возврат) inline-скрипт в `login.html` ставит класс `vk-return` на `<html>` → форма скрывается (`display:none !important` в `auth.css`), показывается спиннер `.vk-return-spinner`. Если поток не завершился — `vk-auth.js` диспатчит событие `vkAuthFlowFailed` (реальные ошибки обмена, `phone_conflict`, отмена ambiguous-модалки, сбой загрузки SDK, ошибка POST вне попапа) → класс снимается, форма возвращается. Код 0/2 вне попапа тоже снимает спиннер
  - `registerNewUser()` — регистрирует свежего пользователя с паролем `stud123` (подходит `YogaPasswordValidator`), всегда вызывает `clearCookies()` до регистрации, редирект на `**/dashboard/`
  - `uploadAvatar()` — грузит PNG 1×1 (base64) через `[data-test-id="avatar-input"]`
  - **Phone-mask caveat**: Playwright `fill()` on phone-masked inputs causes digit duplication. Always use `fillPhoneField()` helper (bypasses mask via JS `input.value` setter) instead of `page.locator().fill()`
  - **Form POST via API**: `page.request.post('/login/', { form: {...} })` — Playwright сериализует объект `data` в JSON, а Django-формы читают `request.POST` (form-urlencoded), поэтому для login/register нужен именно `form:`. Для JSON-эндпоинтов (`/api/...`) — `data:`
  - **Calendar test events**: всегда создаются на чистой будущей дате — `CLEAN_EVENT_DATE` в `tests/calendar/helpers.ts` вычисляется динамически (+1 год от today, не пересекается с реальным расписанием студии) с `cleanupEventsOnDate()` перед созданием. **Shop-тесты** (`tests/shop/shop.spec.ts`) используют отдельную дату `SHOP_EVENT_DATE = '2030-08-22'` — не пересекаются с календарными при параллельном прогоне. Профильные тесты истории посещений используют `futureDay(364)` (не совпадает ни с CLEAN, ни с SHOP)
  - **Test student**: phone `3333333333`, pass `stud123`, `allowed_tariffs=[3]` (s5; read-only тесты). Мутирующие тесты НЕ используют s5/s6 — им нужен свежий `registerNewUser()`
  - **Phone format gotcha**: `loginAsStudent('3333333333')` работает (форма логина сама добавляет `+7`), а `getUserInfo()`/`test_user_info` нормализует без `+7` → `'3333333333'` не находит пользователя. Для API-вызовов передавайте полный `'+73333333333'`
  - **Calendar new describes** (`tests/calendar/calendar.spec.ts`): «Удаление занятия возвращает средства» (одиночное + серия), «Запись других пользователей» (отмена своей не отменяет чужую), «Сплит-тариф» (сплит не списывает средства, отмена без штрафа), «Админ — краевые случаи посещаемости» (повторный `attendance/remove/` → 400 «…уже отменена»; повторный `add` → повторное списание; `attendance/update/` с пустым списком не воскрешает отменённые записи — активная становится `no_show`, отменённая не появляется в списке). Админ-тесты самовосстанавливаются: возвращают s5 исходный баланс (`preBalance`) и тарифы `[3]`. «Цвет текста события зала» (5 тестов): API-проверки `textColor` (явный `text_color`, авто-контраст `#212529` на светлом / `#FFFFFF` на тёмном фоне) и DOM-проверки computed `color` `.fc-event-custom`; мутируют цвета зала 2 через `setHallColors` и возвращают исходные в `afterEach`. «Серия через редактирование» (4 теста): `update_event` умеет включать повторение у ранее одиночного занятия (PUT с `is_recurring:true` создаёт недельную серию с общим `recurrence_id`, skip существующих дат — идемпотентно) и отключать (`is_recurring:false` отсоединяет событие от серии, остальные не трогает); хелпер `updateCalendarEvent` в `tests/fixtures/helpers.ts`. **Семантика редактирования серии** (core/views.py `update_event`): редактирование НАЧАЛЬНОГО (самого раннего) занятия серии применяется ко всей серии — переносятся `class_type_id`, `duration`, `hall_id`, `tariff_id`, `max_participants_override`, а при смене `start` — только время (часы:минуты), даты остальных не трогаются; редактирование не-начального занятия меняет только его. Серия создаётся только при ПЕРВОМ включении повтора (`not was_recurring`) — повторный PUT со сменой времени не плодит дубликатов. Отключение повтора на начальном — только выход из серии, без распространения. Тесты (4): «смена типа занятия у начального события серии применяется ко всей серии (API)», «смена времени и зала … даты сохраняются», «редактирование не-начального события серии не влияет на остальные (API)», «смена типа занятия у начального события серии через форму»
  - **Shop describes** (`tests/shop/shop.spec.ts`, 35 тестов): «Покупка абонемента» (5) — UI-покупка с кнопкой `confirm-purchase-btn` (id), проверка баланса через `toContainText` (значение форматируется с запятой «5500,00 ₽»); «Пополнение баланса (валидация)» (3) — `amount > 100000` → 400, недопустимый `amount` → 400; «Вебхук YooKassa» (5) — `purchase_subscription`/`renew_subscription` через `postWebhook` на `/api/yookassa/callback/`, дубликат `payment_id` не зачисляет дважды, `pending` игнорируется; «Пополнение из модалки покупки» (1) — `price − balance` передаётся в виджет. Отдельный `SHOP_EVENT_DATE` для энроллов, события создаются под админом (`createCalendarEvent`), свежие юзеры (`registerNewUser` + `deleteTestUser`), уникальные `payment_id` (`pay-test-${Date.now()}-${n}`)
  - **Вебхук продления**: тест выявил баг — `renew_subscription()` не принимал `comment`, а колбэк (`core/views.py:2036`) передавал `comment=...` → TypeError → 500. Исправлено: `renew_subscription(subscription, comment="")`, комментарий сохраняется в `subscription.comment`
  - **Drag & drop** (describe «Перетаскивание занятия» в `tests/calendar/calendar.spec.ts`, 6 тестов): перетаскивание/изменение размера события доступно ТОЛЬКО персоналу — `editable` в `calendar.js` вычисляется по роли (`isStaff = admin/moderator`, иначе `false`). Для студента drag просто не срабатывает: событие не двигается, модалка-предупреждение НЕ показывается. Хелпер `assertForbidden(page, eventId)` в `tests/calendar/drag-helpers.ts` теперь проверяет, что `startStr` события не изменился (`CLEAN_EVENT_START`) и `notification-modal` невидима (раньше ожидал модалку «Доступ запрещен» — та убрана). `assertEventMovedTo` (админ) — сравнивает фронт (`calendar.getEventById().startStr`) с бэкендом через API
- **Test endpoints** (DEBUG=True only, `@csrf_exempt`): `POST /api/auth/vk/test/`, `POST /api/auth/test/user-info/`, `POST /api/auth/test/delete-user/`, `POST /api/auth/test/my-info/`, `POST /api/auth/test/set-allowed-tariffs/` (staff), `POST /api/auth/test/delete-subscriptions/` (staff), `POST /api/auth/test/set-balance/` (staff), `POST /api/auth/test/create-notifications/`, `POST /api/auth/test/delete-notifications/`, `POST /api/auth/test/authenticate/` (логин по username без формы — аналог `Client.login`), `POST /api/auth/test/move-session-to-past/` (session_id, minutes — перенос занятия в прошлое для обхода запрета <4 ч), `POST /api/auth/test/expire-subscription/` (subscription_id — мгновенно истекает абонемент), `POST /api/auth/test/set-attendance/` (staff; user_id, session_id, minutes — переносит ClassSession в прошлое и создаёт Attendance('attended') для тестов истории посещений/тепловой карты), `POST /api/auth/test/set-hall-colors/` (staff; hall_id, color?, text_color? — меняет цвет фона/текста зала, возвращает `hall` с `effective_text_color`; пустой объект = чтение текущих), `GET /api/auth/test/tariffs/` (каталог тарифов: id, name, tariff_type, цены, sub-поля, group_id — без авторизации, для стабильных тестов)
- **Резолв тарифов в тестах** (14.08.2026): тесты НЕ хардкодят id тарифов — удаление тарифа в админке ломало ~30 тестов (`IntegrityError: FOREIGN KEY constraint failed` в `setAllowedTariffs`). Хелпер `getResolvedTestTariffs(page)` (`tests/fixtures/helpers.ts`, кеш на воркер) резолвит тарифы по семантике из каталога `/api/auth/test/tariffs/`: `group` — первый `tariff_type=group` + `is_subscription_available` + вне TariffGroup (роль экс-«Йоги»: 700 ₽/абонемент 4500/8), `forbidden` — первый без абонемента, `lite`/`pro` — по имени (`/lite/i`, `/pro/i`), `split` — по типу. Спеки используют `test.beforeAll(async ({ browser }) => { const page = await browser.newPage(); ... page.close(); })` (fixture `page` в `beforeAll` недоступна!) и модульные `let`-переменные. Цены/счётчики занятий берутся из каталога, не хардкодятся. Канонический split-тариф остаётся id 3 (зашит в `runserver_test.py`). **Правило: новые тесты обязаны использовать `getResolvedTestTariffs`, а не литеральные id тарифов.**
- **`setBalance()`** requires staff login — call before `loginAsStudent()` in tests
- **Deduction/refund tests**: "списание из абонемента" uses `setBalance()` to ensure sufficient balance (sets 10000, subscription costs 4500; после сьюта баланс s5 = 5500)
- **4-hour restriction**: cancellation blocked when event starts in ≤4 hours (`calendar.js:846-853`). Enrollment: shows confirm modal warning "отменить будет невозможно" (`enrollWithWarning`), then proceeds. Backend: enroll OK, cancel blocked. Tested in "4-часовое ограничение"
- **Profile tests** (`tests/profile/profile.spec.ts`, 63 теста): мутации (редактирование, тема, аватар, покупка абонемента, запись на занятие, VK-привязка, история посещений, история баланса, пустые состояния) — только на свежезарегистрированных пользователях (`registerNewUser()` + `deleteTestUser()`); s5/s6 — только read-only проверки отображения/истории/VK-секции. История посещений/тепловая карта: событие создаётся на `futureDay(364)` (дата, не пересекающаяся с calendar/shop), `createPastAttendance(uid, eventId)` переносит занятие в прошлое и создаёт Attendance; VK-секция — `attachVk(page, vkId)` для текущего залогиненного. Тест «телефон, начинающийся с 8, конвертируется в +7» выводит «восьмёрочный» ввод из `uniquePhone()` (`'8' + digits.slice(1)`), чтобы после конвертации номер совпал с исходным и не было конфликта/утечки
- **Avatar upload backend** (`core/views.py:1014-1022`): `profile_detail_view` обрабатывает `avatar` в `request.FILES` (и `avatar_delete`) ДО валидации телефона, т.к. форма аватара содержит только файл — без этого падало «Номер телефона обязателен»
- **`test_user_info`** (`core/views.py:1545`): возвращает `'id': user.id` в ответе — нужен хелперам `registerNewUser`/`uploadAvatar`

## Windows-specific
- nginx at: `C:\Users\Specialist\AppData\Local\Microsoft\WinGet\Packages\nginxinc.nginx...\nginx-1.31.1\`
- SSL certs at: `C:\tools\certificates\`
- ACME challenge path: `C:\tools\acme-challenge\`
- win-acme at: `C:\tools\win-acme\` (PemFiles plugin → `C:\tools\certificates\`; НЕ пишет `fullchain.pem`)
- `renew_cert.bat` (задача `WinACMERenewal`, ~09:00): `wacs.exe --renew` → пересборка `fullchain.pem` из `chain.pem` для обоих доменов → `nginx -s reload`. **Не удалять** шаг пересборки: без него `fullchain.pem` остаётся старым, reload падает с `SSL_CTX_use_PrivateKey: key values mismatch` и сайт умирает (инцидент 05.08.2026)
- Scheduled task: "CRM Seed Demo DB" every 3 days at 03:00
- Scheduled task: "CRM Send All Notifications" every hour
- nginx reload: `nginx.exe -p "<prefix>" -s reload`

## Demo site
- `demo.alenaproyoga.ru` → HTTPS (port 443) → nginx → port 8002
- `settings_demo.py` overrides: separate DB, static root, adds `demo.alenaproyoga.ru` to ALLOWED_HOSTS + CSRF_TRUSTED_ORIGINS
- Disables YooKassa keys, VK tokens (empty strings in settings_demo.py)
- Seed data: all users have balance 100000.00
- Logins: admin/admin123, moderator/mod123, student1-4/stud123
