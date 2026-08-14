# Session Summary (update: 14.08.2026)

## Goal
- Сделать Playwright-тесты устойчивыми к реальному составу тарифов: убрать хардкод id тарифов и цен. Удаление тарифа «Йога» (id=1) в админке ломало ~30 тестов (`IntegrityError: FOREIGN KEY constraint failed` в `setAllowedTariffs`). Резолвить тарифы по семантике через новый DEBUG-эндпоинт каталога.

## Constraints & Preferences
- Тесты не должны зависеть от существования тарифа по id.
- Сплит (id 3) остаётся каноническим (зашит в `runserver_test.py` `tariff_ids: [3]`).
- Decimal-поля модели рендерятся как `X,XX` (`Decimal('700')` → `'700,00'`); JS `parseFloat('4500,00')` → 4500.
- `test.beforeAll` НЕ принимает `page`/`context` — только worker-фикстуры (`browser`).
- Общая БД `db.sqlite3` для прод (8001) и тест-сервера (8003); прод waitress — старый elevated-процесс, перезапуск только админом.

## Progress
### Done
- Диагностика: падения полного сьюта вызваны отсутствием тарифа id=1 в БД, не фичей групп тарифов. Пользователь: «Йога» удалена намеренно → тесты были неустойчивы.
- **Бэкенд**: `GET /api/auth/test/tariffs/` (`test_tariffs` в `core/views.py`, URL в `yoga_crm/urls.py`) — каталог тарифов (id, name, tariff_type, цены, sub-поля, group_id), DEBUG-only, без авторизации.
- **Фикстуры** (`tests/fixtures/helpers.ts`): `TariffInfo`, `getTariffs`, `ResolvedTestTariffs`, `getResolvedTestTariffs(page)` (кеш на воркер). Резолв: `group` = первый `group`+`is_subscription_available`+вне TariffGroup (сейчас id 8 «Здоровая спина» — роль экс-«Йоги»), `forbidden` = первый без абонемента (id 4), `lite`/`pro` по имени, `split` по типу. Из `tests/calendar/helpers.ts` дубль-резолвер убран (реэкспорт).
- **`calendar.spec.ts`** — полный рефакторинг: модульные `let` + file-level `beforeAll({ browser })`; `tariff_id: 1/4/6/7` → `TARIFF_GROUP_ID`/`TARIFF_FORBIDDEN_ID`/`LITE_ID`/`PRO_ID`; динамические цены/счётчики (`GROUP_SESSIONS`, `GROUP_SESSION_PRICE`, `LITE_SESSIONS`, `PRO_SESSIONS`, `LITE_SUBSCRIPTION_PRICE`, `LITE_SESSION_PRICE`, `SPLIT_PRICE_FULL/HALF`); форма создания занятия выбирает тариф по `String(TARIFF_GROUP_ID)`; тест «нулевой баланс» выдаёт s3 групповой тариф + обнуляет баланс вручную; тест «Списание»→«Оплата занятия» (актуальный комментарий транзакции).
- **`shop.spec.ts`** — 5 тестов покупки, вебхук purchase и renew переведены на динамику (`GROUP_ID`, `FORBIDDEN_ID`, `LITE_ID`, цены/счётчики из каталога; renew создаёт `LITE_SESSIONS-1` событий).
- **`home.spec.ts`** — продление и «при нехватке средств» на `LITE_ID`/`GROUP_ID`, динамические цены (`#renewPrice`/`#renewBalance` через `formatRu`, `#renewNeededAmount` = `LITE_SUB_PRICE-1000`).
- **`profile.spec.ts`** — 2 теста истории баланса на `t.groupId`/`t.groupSessionPrice` + `formatRu`; комментарий списания «Оплата занятия: …».
- **Багфикс** `session_access_q` (services.py): фильтровал `TariffGroup.objects.filter(tariff_id__in=...)` → `FieldError` на /dashboard/ (31 фейл home). Исправлено через `Tariff.objects.filter(id__in=..., group_id__isnull=False).values_list('group_id', ...)` + импорт `Tariff`.
- **Прогоны**: calendar — **108 passed**; shop+home+profile — **138 passed**; auth+news — **79 passed**. Все зелёные.
- AGENTS.md: добавлены `test_tariffs` в список test-эндпоинтов и буллет «Резолв тарифов в тестах» с правилом «не хардкодить id тарифов».

### Blocked
- Прод waitress (8001) — старый elevated-процесс; перезапуск только из консоли администратора `dev_utils\!restart_waitress.bat`. Правки (группы тарифов, update_event, editable, vk-auth, test_tariffs) попадут в прод после перезапуска.

## Key Decisions
- Резолв тарифов по семантике (тип/имя/свойства) из каталога `/api/auth/test/tariffs/`, а не по литеральным id.
- Сплит id 3 — канонический (совпадает с runserver_test.py), в тестах остаётся литералом.
- Цены/счётчики берутся из каталога (`formatRu` = `toFixed(2).replace('.', ',')` для рендера `X,XX`).
- `beforeAll` для резолва использует `browser.newPage()` + `page.close()`.

## Next Steps
1. Перезапустить прод waitress 8001 из консоли администратора.
2. Новым тестам использовать `getResolvedTestTariffs`, не литеральные id тарифов.

## Critical Context
- Тарифы сейчас: 2 individual, 3 split (канон), 4 group sub=off (forbidden), 6 Lite/7 Pro (группа 1), 8 «Здоровая спина» (700/4500/8 → резолвится в group), 9 sub=off. Тарифа 1 нет.
- `getResolvedTestTariffs` кешируется модулем (воркер); первый вызов делает GET каталога.
- Рендер Decimal: model-поле → `'700,00'`; `parseFloat('4500,00')` → 4500. Минус в балансе — U+2212.
- Комментарии транзакций: «Оплата занятия: …», «Использование абонемента: …», «Покупка абонемента: …», «Возврат средств …».

## Relevant Files
- `core/views.py` (`test_tariffs`), `yoga_crm/urls.py` (URL), `core/services.py` (фикс `session_access_q`).
- `tests/fixtures/helpers.ts` (резолвер), `tests/calendar/helpers.ts` (реэкспорт).
- `tests/calendar/calendar.spec.ts`, `tests/shop/shop.spec.ts`, `tests/home/home.spec.ts`, `tests/profile/profile.spec.ts`.
- `AGENTS.md` (test-эндпоинты + «Резолв тарифов в тестах»).
- `dev_utils\!restart_waitress.bat`: перезапуск прода 8001 (нужна консоль администратора).
