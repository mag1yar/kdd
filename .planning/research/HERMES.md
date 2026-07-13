# Hermes → KDD: интеграция находок в роадмап

## 1. Telegram-канал для KDD (главный интерес)

Hermes доказывает: Telegram-канал для доски — это **не демон, а три колонки и один cursor-запрос**. Дизайн для KDD:

### Outbound (уведомление о waiting_on_human) — **v1**, механика:

- **Notify-target как данные, захваченные при создании задачи.** Hermes стампует origin (platform/chat_id/thread_id) в момент создания через ContextVars/env (`tools/kanban_tools.py:960-1058` `_maybe_auto_subscribe`, `gateway/session_context.py`). KDD-версия дешевле: `kdd add` читает `KDD_NOTIFY_TARGET` из конфига/env и пишет в колонку задачи. Формат — строка-грамматика hermes: `telegram:<chat_id>[:<thread_id>]` (`gateway/delivery.py:142-220`, DeliveryTarget.parse — ~20 строк парсинга). Никакого registry, никакого discovery. Критичный урок hermes (KNOWN LIMITATION в `gateway/kanban_watchers.py:492-570`): персистить **полный** routing-кортеж при записи — всё, что планируешь реконструировать потом, реконструировать не получится.
- **Курсор доставки = таблица-подписка поверх events.** Схема hermes `kanban_notify_subs(task_id, target, last_event_id)` (`hermes_cli/kanban_db.py:1255-1268`) — это ровно KDD-идиома «changed-since rowid» из синтеза (#25, пробел «идемпотентность»). Доставка = `SELECT events WHERE id > last_event_id AND kind IN (...)`, advance курсора в транзакции (`kanban_db.py:8608-8660`), rewind при неудачной отправке. Exactly-once бесплатно.
- **Без демона в v1.** Hermes гоняет это 5-секундным watcher'ом из gateway — для KDD это яд (их же антипаттерн). KDD: `kdd notify-flush` вызывается на Stop-хуке и внутри `kdd wait` — доставка едет на существующих lifecycle-точках. Та же схема данных работает pull-стилем.
- **Сама отправка = один curl на `api.telegram.org/bot<token>/sendMessage`.** Не тянуть python-telegram-bot: адаптер hermes — 8 808 строк квирков (`plugins/platforms/telegram/adapter.py`). Длинный вопрос: truncate на 4000 + футер «см. kdd show #42» — паттерн hermes из `gateway/delivery.py:24-30` (полный текст всегда в задаче, delivery_error отдельно от ошибки задачи). Чанкер с переносом code-fence (`gateway/platforms/base.py:5520-5655`) — только если truncate докажет недостаточность.
- **task_id в тексте каждого уведомления** («⏸ #42 blocked: <вопрос>») — hermes делает так в `kanban_watchers.py:340-346`; это же позволяет inbound-пути найти задачу.

### Inbound (ответ из Telegram → задача) — **v2**, механика:

- **Опциональный отдельный процесс `kdd answer-daemon`, long-polling getUpdates.** Hermes закрыл вопрос: long-poll = исходящий HTTPS, ноль портов, ноль сертификатов; webhook нужен только облаку (`plugins/platforms/telegram/adapter.py:2997-3100`). Это единственный демон во всём KDD, вне ядра, выключен по умолчанию.
- **Ответ = comment + unblock, не чат-артефакт.** У hermes ответ проходит через чат-агента, который зовёт `kanban_comment` + `kanban_unblock` (`tools/kanban_tools.py:804, 1059-1084`). KDD не нужен агент-посредник: парсим `#42` из reply/текста → `INSERT task_comments (author='user', via='telegram')` → `UPDATE status='ready'`. Ответ становится durable-состоянием задачи, и следующая сессия читает его через context pack — «ответы не тонут в чате» (deal-breaker автономщика) закрыт структурно.
- **Маппинг reply→задача без таблицы:** task_id в тексте уведомления (reply-parsing) — v2-минимум. Форум-топик-на-задачу (thread_id = указатель на задачу, детерминированный ключ как `gateway/session.py:871-960`) — только если reply-parsing надоест; это уже управление топиками, т.е. вход в 8k-строчный адаптер.
- **Безопасность — settled by hermes:** default-deny; единственный authority — `KDD_TELEGRAM_CHAT_ID` (CSV максимум); проверка ДО любого парсинга/мутации (prefilter из `adapter.py:841-908` — неавторизованный текст вообще не входит в обработку); токен только в env/0600-файле. Pairing-коды (`gateway/pairing.py`) — пропустить, single-user. Один allowlist-чек в одном месте — hermes размазал auth по 3+ слоям и заплатил комментариями-оберегами (`gateway/authz_mixin.py:264-400`).
- **Три детали демона украсть дословно:** (1) singleton-lock на bot-токен (двойной поллинг = Telegram 409), (2) `drop_pending_updates=False` — ответы, присланные пока демон лежал, обязаны выжить, (3) персистентный offset последнего update_id — тот же cursor-идиом (`adapter.py:1991-2032`, `base.py:1753-1762`). Плюс dead-target-регистр (`gateway/dead_targets.py`) — ~40 строк суммарно, только вместе с демоном.

## 2. Память hermes vs KDD-синтез

**Подтверждает (менять нечего):**
- FTS5 BM25 pull-only без эмбеддингов достаточен в продакшене (синтез #5): `session_search` hermes — ноль LLM-вызовов, ноль векторов в ядре (`tools/session_search_tool.py`, `hermes_state.py:714-933`).
- Один store: hermes отгрузил 8 memory-провайдеров и потом **в коде** запретил больше одного (`agent/memory_manager.py:1-8, 374-440`) — прямое подтверждение «второй store любого вида — отклонено».
- Push-инъекция = аппарат принуждения: их always-inject выживает только за счёт char-капов, threat-скана и ~200 строк fence-скраббинга (`agent/memory_manager.py:150-350`) — весь антипаттерн-раздел синтеза №1 подтверждён их собственной ценой.
- Kanban-ядро hermes независимо повторяет v0 KDD: CAS-claim без retry, append-only task_events, центральный SQLite вне репо, stale-reclaim без штрафного счётчика (`hermes_cli/kanban_db.py`, docstring + схема 1097-1276).

**Корректирует / добавляет:**
- **Дедуп: дубль = успех, не ошибка.** Hermes возвращает «Entry already exists» как success (`tools/memory_tool.py:190-193`) — ошибка учит агента перефразировать и записать почти-дубль. Синтез #6 (content-hash UNIQUE) уточнить: `INSERT OR IGNORE` + сообщение «уже записано».
- **Demotion по источнику в recall.** BM25 у hermes ослеп от cron-лексики, фикс — один stable-sort ORDER BY, демотирующий agent/cron-записи под человеческие (`session_search_tool.py`, `_DEMOTED_SESSION_SOURCES`). Добавить к синтезу #19 (MMR/recency): +1 ORDER BY по actor_type, v0.5, ~3 строки.
- **Budget как rejection, не документация.** Каповый write у hermes отклоняет запись сверх бюджета и возвращает текущие записи для консолидации в том же ходу, с капом ретраев (`memory_tool.py:128-540`). KDD-пробел «токен-бюджет» усилить: enforce в write-path, не только в спеке.
- **Ephemeral injection.** build_context_pack собирается per-request и никогда не пишется обратно ни в какой store (hermes: копия сообщения, `agent/conversation_loop.py:792-856`) — одно предложение в спеку context pack, закрывает класс «re-ingest собственной выдачи».
- **build_worker_context = референс-спека context pack** с выжившими в проде байт-капами (body 8KB, 30 комментов по 2KB, prior attempts): `kanban_db.py:8156-8290`. Прямо покрывает синтез #10 («what NOT to retry» = prior attempts из run-истории, не отдельное поле) и идею пользователя №4/№5 (задачи как память, child-задачи = общая память через typed handoff summary+metadata JSON).
- **7-дневный литмус** («факт, протухающий за 7 дней, — не память, а транскрипт») и правило declarative-not-imperative (`agent/prompt_builder.py:151-173`) — готовый текст для skill-контракта v0, копировать.

**Противоречий синтезу нет.** Всё, что hermes делает иначе (always-inject, авто-синк каждого хода, провайдер-абстракция, mutable md как БД с локами и drift-guard'ами `memory_tool.py:83-110`), сам же оплачивает фильтр-стеками — это их антипаттерны, подтверждающие отклонения KDD.

## 3. Skills / cron / state — что берём

- **Wake-gate ладдер — ядро cron-режима v1 (синтез #25 подтверждён механикой).** `kdd probe` — детерминированный скрипт, НЕ LLM-ход, последняя строка stdout = `{"wakeAgent": actionable_count>0}` — сессия Claude вообще не спавнится, если доска не менялась (`cron/scheduler.py:2138` `_parse_wake_gate`; четыре ступени no-op: :2203, :2485, :258). Внешний cron + probe-скрипт даёт всю ценность их 3 811-строчного шедулера без демона.
- **Script-injection паттерн:** входной промпт cron-агента = вывод `kdd status` + changed-since-digest, впрыснутый фенсом «## Script Output» (`scheduler.py:2164-2261`). Плюс наследуемое предупреждение: комменты доски, читаемые scheduled-агентом, — stored-data-executed-later, т.е. injection-поверхность; hermes сканирует собранный промпт (`scheduler.py:2369-2439`). Для KDD v2 — дешёвый вариант: скан при рендере, mark-don't-delete (`[BLOCKED: ...]` в выдаче, исходник цел — `memory_tool.py:62-241`).
- **Отчёт cron-агента = comment на задаче с actor_id='system:cron'** — эквивалент их seed-in-thread (`scheduler.py:719-831`): следующая сессия (человек или агент) вытягивает его как контекст. Задача = тред; ничего нового строить не надо.
- **Skill-как-контракт (v0):** писать board-protocol-skill по дисциплине hermes — description-бюджет 60 символов = весь routing («most-violated rule, NOT cosmetic», `agent/learn_prompt.py:40-47`), фикс-порядок секций, references/ для таблицы рационализаций (`tools/skills_tool.py:1-105`). Совместимо с нативным форматом Claude Code, ноль новой машинерии.
- **`kdd learn` (v1) = /learn-паттерн:** стандарты в одной prompt-функции, «NEVER invent flags/paths/APIs — не видел в источнике, не пиши» (`agent/learn_prompt.py`, 150 строк) — прямой антидот отсебятины. Плюс копировать **текст** (не механизм) из background_review: preference-ладдер update-before-create и do-NOT-capture-блэклист («X is broken» твердеет в само-отказы на месяцы; фиксируй фикс, не фейл — `agent/background_review.py:166-370`). Сам always-on-fork («пасс без вывода = упущенная возможность», :182-185) — антипаттерн, root cause их же куратора-мусорщика (~1100 строк уборки за писателем); у KDD learn только по явной команде.
- **Write-path validation:** lifecycle_guard hermes живёт внутри `create_job`, не в CLI-слое, и матчит command-shaped regex, не прозу (`cron/lifecycle_guard.py`, `cron/jobs.py:1147-1153`) — подтверждение синтеза #26/антипаттерна №15 плюс конкретный hazard: агент однажды зашедулил рестарт собственного хоста. Если KDD позволит агентам самошедулить probe — этот гейт обязателен.
- **At-most-once tick:** advance-next-run-до-исполнения + один lock + heartbeat-файл (`scheduler.py:3560-3650`) — рецепт для `kdd wait`-петли, ~30 строк поверх BEGIN IMMEDIATE. Дисциплину берём, демон — нет. И контрпример: hermes держит jobs в мутабельном jobs.json с авто-репайром порчи (`cron/jobs.py:822-868`) при живом SQLite в десяти футах — у KDD любые джобы только в одном SQLite.
- **Handoff как 4-state колонка + атомарный claim-UPDATE** (`hermes_state.py:7023-7121`): два процесса координируются тремя колонками — блюпринт для waiting_on_human/handoff-строки v0.5, реюз claim-машинерии v0 дословно.

## 4. Диф фаз v0–v2

**v0 — не трогаем.** Три бесплатных правки текста спеки (ноль кода сверх плана):
- дубль-write возвращает success «уже записано», не ошибку (INSERT OR IGNORE);
- board-skill пишется по 60-char-description-дисциплине hermes;
- в шаблон skill-контракта — 7-дневный литмус + declarative-not-imperative (готовая проза из `prompt_builder.py:151-173`).

**v0.5 — добавить:**
- `block_kind` CHECK-колонка (`dependency|needs_input|capability|transient`) + `block_recurrences`-счётчик с маршрутом в triage после лимита (`kanban_db.py:125, 1163-1181`) — это и есть схема waiting_on_human, переезжает из v1 сюда: две колонки, потребитель-нотификация остаётся в v1. Reset счётчика только на успешном complete (их amnesia-bug).
- Байт-капы context pack зафиксировать числами по образцу `_CTX_MAX_*` (`kanban_db.py:280-295`); typed handoff = summary(1-3 предложения) + metadata JSON на done.
- ORDER BY demotion по actor_type в recall (+3 строки к MMR-пункту).
- Budget-rejection в write-path заметок/декизий (отказ + текущие записи + кап ретраев).
- В спеку context pack: инъекция эфемерна, никогда не пишется обратно в store.

**v1 — добавить:**
- **Telegram outbound** (раздел 1): notify_target-колонка со строкой-грамматикой `telegram:chat[:thread]`, cursor-доставка поверх events, `kdd notify-flush` на Stop/wait, curl на sendMessage, truncate-4000 + «см. kdd show #N». Это *замена* «webhook/телефон — v2» из синтеза: hermes показал, что outbound стоит одну таблицу и один curl — переносим из v2 в v1. Desktop-notify (#28) остаётся как ступень ниже.
- `kdd probe` уточнить контрактом wake-gate (последняя строка = JSON `wakeAgent`); cron-отчёт = comment actor='system:cron'.
- `kdd learn`: анти-фабрикация + update-before-create + do-not-capture-блэклист как письменный контракт.
- lifecycle-guard-правило (command-shaped regex в write-path), если агенты получают право самошедулинга.

**v2 — уточнить:**
- «Телефонный канал ответа» конкретизируется: опциональный `kdd answer-daemon` (long-poll getUpdates, allowlist по chat_id до парсинга, singleton-lock, персистентный update_id-offset, dead-target-регистр). Reply→task через task_id в тексте; форум-топики — только при доказанной боли.
- Threat-скан recall-выдачи при рендере (mark-don't-delete).

**Отклонено (с evidence):**
- Агент-посредник для ответов из Telegram (у hermes чат-агент зовёт comment/unblock — KDD хватает парсера и двух SQL).
- Wake-injection синтетических сообщений в живую сессию (`kanban_watchers.py:492-570`) — оркестраторская территория; pull-эквивалент = `kdd wait` exit-коды, уже в плане.
- python-telegram-bot / полнофидельный адаптер (8 808 строк квирков), rich-render, управление топиками в v1.
- Pairing-коды, multi-platform delivery-роутер (~1000 строк шедулера hermes на телеграм/дискорд/слак-таргеты), background-review-fork, curator-агент, второй формат хранения джобов (jobs.json), mutable-md-store с локами и drift-guard'ами.

**Итоговая цена дельты:** v0 +0 кода; v0.5 +2 колонки, +3 строки сортировки, +числа в спеку; v1 +1 таблица (notify_subs), +1 колонка (notify_target), +1 команда (notify-flush), +curl; v2 +1 опциональный процесс вне ядра. Принцип отсечения синтеза («один SELECT / одна колонка / один md-файл») выдержан везде, кроме answer-daemon — он честно куплен ценой единственного опционального демона в v2.