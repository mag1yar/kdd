Плана по пути `undefined` не существует (в рабочей директории только `.claude`-конфиги) — синтез выполнен против заявленных принципов KDD: pull-not-push, substrate-not-orchestrator, центральный SQLite + решения в git-md, параллелизм через worktree.

---

# KDD: сводный design-input отчёт

## 1. Фичи из референсов

Приоритет = порядок в таблице. Дубликаты слиты (источники через запятую).

| # | Фича | Источник | Зачем | Фаза |
|---|------|----------|-------|------|
| 1 | Атомарный claim через один UPDATE (`WHERE status='todo'`), pull-планирование без диспетчера | agent-kanban, ruflo (claims) | Ядро pull-модели: агенты сами берут работу, first-writer-wins, ноль оркестрации | v0 |
| 2 | Append-only таблица events как единый хребет (actor_type, actor_id, action, session_id) | agent-kanban, ECC (audit) | Одна таблица даёт аудит, ленту активности, staleness и «что делали агенты» бесплатно | v0 |
| 3 | Чистая функция-стейт-машина переходов, гейт по типу актора | agent-kanban, superpowers (typed status) | Кто и куда может двигать задачу — в коде, а не в промптах; люди и агенты на одной доске | v0 |
| 4 | Decision-записи в git-md: дата-префикс имён, поля Rationale / Alternatives / Supersedes / Outcome (✓/⚠/—), «out of scope + почему» | GSD, ECC, superpowers | Ядро KDD: решения ревьюятся в git, Outcome-колонка не даёт им протухать, supersedes убирает противоречия | v0 |
| 5 | FTS5 BM25 как единственный поиск (recall = явная команда, не хук) | ruflo | Их же бенчмарк: cosine-only = 0% релевантности, BM25 → 70%. Эмбеддинги не нужны в v0 | v0 |
| 6 | Дедуп по хэшу контента как UNIQUE-констрейнт при записи | ruflo | У ruflo 5 706 записей = ~20 уникальных. Одна констрейнт-строка против этого | v0 |
| 7 | Короткие sequence-ID (#42) вместо UUID в прозе | agent-kanban | Задачи упоминают в коммитах и решениях постоянно; ~10 строк SQL | v0 |
| 8 | session_id на claim → указатель на локальный transcript, транскрипты не хранить | agent-kanban | Правильная граница субстрата: SQLite — координация, богатый контекст лежит где лежит | v0 |
| 9 | Skill-как-контракт (user-invocable: false) с таблицей рационализаций и Iron Laws | agent-kanban, superpowers | Единственный доказанный способ, чтобы агент реально следовал протоколу доски | v0 |
| 10 | «What NOT to retry»: список проваленных подходов на задаче/сессии | ECC | Самый дешёвый и самый ценный элемент преемственности сессий | v0 |
| 11 | Минимальный SessionStart-хук: 1–3 строки «субстрат есть, вот как спросить» | superpowers (механизм), ECC (антипример объёма) | Pull-указатель вместо инъекции; бюджет — строки, не килобайты | v0 |
| 12 | Хуки: exit 0 всегда, тайм-бюджет, только локальные бинарники, но ошибки — в лог-таблицу | ruflo | Надёжность без невидимых сбоев (их no-op consolidator жил 6 000 коммитов) | v0 |
| 13 | `kdd status` = digest-по-запросу (контракт STATE.md ≤100 строк, но как SELECT, не файл) | GSD | «Прочитал один раз — знаешь где мы», без write-гонок и дрейфа | v0 |
| 14 | Staleness как производная от последнего event, release в todo | agent-kanban, ruflo (steal) | Агенты умирают молча; один SQL-запрос при любом чтении доски, без демона | v0.5 |
| 15 | DAG зависимостей: таблица (task_id, depends_on) + проверка циклов + pull-запрос «todo без незакрытых deps» | agent-kanban | Агенты самосериализуются без оркестратора; «newly unblocked since» — тот же запрос | v0.5 |
| 16 | Worktree-per-task: ветка по ID задачи, регистрация worktree в SQLite, cleanup на терминальном статусе | agent-kanban, superpowers, ECC (ecc2) | Параллельные агенты видят друг друга — то, чего у superpowers нет | v0.5 |
| 17 | Карта кодовой базы: фиксированный набор md-документов + `last_mapped_commit` во frontmatter | GSD, ECC (codemaps) | Pull тривиален (нужны конвенции — читай один известный файл); staleness = git-нативное одно поле | v0.5 |
| 18 | `kdd stats`: строки по kind, никогда-не-читанные записи, рост | ruflo | Дешёвая наблюдаемость, поймавшая бы дубликатный взрыв ruflo годами раньше | v0.5 |
| 19 | MMR + recency-decay поверх FTS5 (~30 строк, чистые функции) | ruflo | Чтобы выдача не была пятью парафразами одного факта; новые решения перекрывают старые | v0.5 |
| 20 | Handoff: строка сессии в SQLite (позиция, next_action, context_notes) + короткая md-заметка | GSD (HANDOFF.json), ECC (save/resume) | Поля next_action и «что не пробовать» — киллер-фичи паузы/резюма; по строке на worktree | v0.5 |
| 21 | Accumulate-then-act: PostToolUse только копит пути файлов, одна запись на Stop | ECC | Единственный pull-совместимый способ вести «файлы задачи» с почти нулевой ценой | v0.5 |
| 22 | Выходной контракт вывода (≤5 строк, ноль декора) как написанный документ | GSD (continuation-format) | Борьба с болтливостью агентов структурно, а не уговорами | v0.5 |
| 23 | Graphviz-диаграммы в скиллах с циклами/гейтами | superpowers | Дешёвое снятие двусмысленности для claim→work→report→release | v0.5 |
| 24 | `kdd wait` с дисциплиной exit-кодов (0/2/124) | agent-kanban | Ожидание без чат-поллинга; для supervising-сессий и cron | v1 |
| 25 | Дешёвый wakeup-probe: board_rev + actionable_count в одном запросе, <200 токенов | agent-kanban (wait), персона-6 | Make-or-break для cron-режима; тривиален поверх events (MAX(rowid)) | v1 |
| 26 | Гейты per-column/per-actor как данные, enforcement в CLI-пути записи | agent-kanban (state machine), персоны 2/6 | Промпт-гейты обходятся за неделю; расширение стейт-машины из v0 | v1 |
| 27 | Failure-derived constraints («записываем только то, что реально сломалось») | GSD | Противоядие от спекулятивных советов в базе знаний | v1 |
| 28 | Desktop-уведомление на Stop / waiting_on_human (лестница: терминал → osascript → BurntToast) | ECC | Windows-путь готов; одна самодостаточная node-строка, без сервиса | v1 |
| 29 | extract-learnings: 4 категории с атрибуцией источника и «graduated»-флагом | GSD, ECC (/learn) | Структурированный сбор знаний по запросу пользователя, не наблюдателем | v1 |
| 30 | Байтовый бюджет-рэтчет на собственные skills в CI + pressure-тесты скиллов (TDD для прозы) | GSD, superpowers | Единственное, что реально останавливает разбухание промптов | v1 |
| 31 | Ревью-вердикты как строки, привязанные к задаче/коммиту (хранить, не исполнять) | superpowers | Аудит-след ревью-циклов исполнителей без превращения в оркестратор | v1 |
| 32 | Model/effort-маршрутизация: колонка на задаче + frontmatter роли, ноль движка | ECC, agent-kanban | Решается декларативно; резервируем колонку, движок не пишем | v2 |
| 33 | Outcome-сигнал из git (revert/hotfix-детекция → пометка решения) | ruflo | Решение с откаченным коммитом = готовая «gotcha»; batch-скрипт по запросу | v2 |
| 34 | Консолидация: курсор + транзакции + никогда не удалять исходники, вывод = ревьюемый git-diff | ruflo | Если компакция вообще понадобится — только такой формы, только вручную | v2 |
| 35 | apply -f YAML-спеки, capability-манифесты, provenance-tier | agent-kanban, GSD, ruflo | Осмысленно только при сторонних потребителях | v2 |

## 2. Антипаттерны

1. **Push-инъекция памяти в каждый промпт** (ruflo `[INTELLIGENCE]`, ECC SessionStart на 8KB, superpowers `<EXTREMELY_IMPORTANT>`) — статический PageRank-член протаскивает одни и те же записи под любой запрос; без подавления повторов агент получает одинаковый спам каждый ход. Recall — только явный запрос.
2. **Оркестратор из промптов** (GSD: 92 workflow / 1.78MB; superpowers: жёсткий пайплайн «ONLY skill you invoke next»; agent-kanban: leader-агент; ECC: orch-*/gan-*/hive + 3 дашборда) — KDD выставляет данные, оркестрирует host-агент и человек.
3. **Markdown как мутабельная БД** (GSD: чекбоксы ROADMAP, счётчики STATE.md, regex-патчи, самодельный lockfile-мьютекс и кладбище багфиксов) — мутабельное состояние живёт только в SQLite; md append-mostly или рендер.
4. **Push-диспетчер и няньканье процессов** (agent-kanban: ~15 файлов dispatcher/reaper/circuit-breaker) — pull-модель удаляет весь слой.
5. **Несколько перекрывающихся хранилищ + молчаливый ETL** (ruflo: 7 стораджей, consolidate-заглушка 6 000 коммитов; ECC: 5+ поверхностей персистенции) — один SQLite-файл, ноль производных кэшей, ноль демонов.
6. **Fail-silent** (ruflo: exit 0 + проглоченный stderr = невидимые месяцы сбоев) — exit 0 да, но ошибки в таблицу, которую показывает `kdd stats`.
7. **Один факт в 3+ местах** (GSD: позиция в STATE body + frontmatter + ROADMAP) — один источник истины на факт.
8. **Гейт-бюрократия** (GSD: research/drift/schema/verify-гейты) — ноль блокирующих гейтов в ядре; сигналы queryable, действует человек.
9. **Tool sprawl / catalog sprawl** (ruflo: 300+ MCP-тулов; ECC: 66 агентов, 268 skills) — каждая схема = налог на контекст каждого хода. Горстка CLI-команд, почти нулевая MCP-поверхность.
10. **Церемониальный вывод** (GSD: emoji-заголовки, прогресс-бары, «🎉 Milestone Complete»; ruflo: маркетинг в хуках, плейсхолдеры `%SESSION_ID%`) — в контекст печатаются только реальные данные.
11. **Второй мутабельный источник истины** (agent-kanban: GitHub PR-state → вечный reconciliation-sprawl) — завершение = явный акт в SQLite; git/PR — информационные указатели.
12. **Хуки, зовущие сеть** (ruflo: `npx ruflo@alpha` в PostToolUse, 30+ c) — только локальные бинарники.
13. **Always-on наблюдение каждого tool-call** (ECC: observe-runner → «memory explosion fix», 5-слойные guard'ы) — захват только на Stop/границах команд.
14. **Config-взрыв** (ECC: десятки env-ручек; GSD: слоёные оверлеи) — profile + disable-list, точка.
15. **Инвариант в прозе там, где возможна механика** (superpowers сам это признаёт) — NOT NULL/CHECK/UNIQUE вместо предупреждения в промпте.

## 3. Голоса персон

**Solo full-stack (2–3 worktree, superpowers).** Знание должно жить в закоммиченных md-файлах внутри репо, чтобы worktree и merge переносили его; решения фиксируются одной дешёвой командой 5 раз в день, контекст загружается scope-aware дайджестом ≤2–3KB. Deal-breakers: глобальное мутабельное состояние, протекающее между worktree; инъекция без токен-бюджета; merge-конфликты от файлов самого KDD (последовательные ID, хранимая доска); молчаливо-неполный контекст.

**Enterprise team lead (Jira, команда 8).** Агенты пишут только в Proposed, promotion — только человек; каждый агентский write несёт invoking-user, session_id и обязательный reason; полный append-only аудит без дыр. Deal-breakers: гейты в промптах вместо серверного write-path; любой путь записи мимо аудита; «это сделал агент» без владельца-человека; остров без экспорта/синка; порча доски двумя сессиями.

**Frontend-разработчик (downstream API).** `depends_on` как данные с автопереходом Blocked→Ready и запросом «что разблокировалось с вчера»; контекст-бандл задачи (родитель, контракт API, решения) одним вызовом; типизированные вложения-контракты с таймстампами. Deal-breakers: вероятностный анблок из тегов/текста; чисто pull-модель без единого триггер-механизма; статус доски, не разделяемый с backend-коллегой; спам-уведомления.

**QA/SDET.** Структурированные acceptance_criteria, per-file свежесть карты кода, first-class сущность test-run с состоянием INCONCLUSIVE и детерминированным readiness-скорингом по записанным фактам. Deal-breakers: глобальная-только свежесть карты; комменты без вложений-доказательств; runs, умирающие с терминалом; «vibes»-скоринг от LLM; false red при упавшем стенде.

**Минималист (mode 1, без агентов).** Простые md-файлы в docs/ — единственное durable-состояние; индекс — одноразовый gitignored-кэш; read-only MCP-поверхность, где write-тулы физически не зарегистрированы; ноль хуков и авто-инъекций; однофайловые диффы. Deal-breakers: агентский write в его доску хотя бы раз; миграции, переписывающие его md; репо-мусор (lock/sidecar/tombstone); агентский стек как обязательная зависимость режима 1.

**Автономщик (cron-петля, BA→planner→dev→tester).** Wakeup-probe за <200 токенов (board_rev + actionable_count); enforced-гейты per-column; персистентные Q&A-поля со статусом waiting_on_human и уведомлением на телефон; claim с TTL-lease, worktree-привязкой и journal для резюма; model/effort/budget-поля с эскалацией в Blocked. Deal-breakers: стоимость wakeup растёт с размером доски; гейты только в промптах; ответы, тонущие в чате (BA переспрашивает каждый цикл); отсутствие уведомлений вне терминала; отсутствие учёта расхода на задачу.

## 4. Пробелы в плане

Поскольку письменного плана нет, «пробелы» = вопросы, которые персоны вскрыли и которые концепт (SQLite + git-md + worktree) не отвечает сам собой.

| Пробел | Кто вскрыл | Рекомендация |
|--------|-----------|--------------|
| **Модель scope-резолюции для worktree**: что видит worktree B, включая глобальное решение, записанное на ветке A до merge | solo, автономщик | **v0**: центральный SQLite вне репо решает это по построению (решение видно сразу, файл догоняет через merge); md-запись — колонка `scope` (global/sprint) + `branch`. Это главный аргумент за центральный SQLite — зафиксировать в плане явно |
| **Merge-story собственных файлов KDD**: file-per-record, несеквенциальная часть ID, доска derived-not-stored | solo, минималист | **v0**: один md-файл на решение, доска = SELECT, счётчик seq — только в SQLite (вне репо → не конфликтует). Хранимых board-файлов не будет |
| **Токен-бюджет контракта**: жёсткие цифры на каждый вывод (status ≤2KB, hook-pointer ≤3 строк, recall top-k с капом) | solo, минималист, автономщик | **v0**: прописать числа в спеку и в byte-budget-тест (сам тест — v1) |
| **Actor-модель**: human vs agent:role на каждой мутации, session_id | team lead, автономщик | **v0**: колонки actor_type/actor_id/session_id в events уже дают 80%; invoking-user и обязательный reason — v2 (enterprise) |
| **Q&A / waiting_on_human**: вопросы и ответы как поля задачи, не эфемерный чат | автономщик | **v1**: статус waiting_on_human + поля questions/answers. Телефонный канал ответа — v2 |
| **Идемпотентность событий** (unblock_event_id, ack, debounce) | frontend, автономщик | **v1** вместе с wait/probe: cursor «changed-since rowid» по events покрывает без отдельной ack-механики |
| **Структурированные acceptance_criteria / non_goals на задаче** | solo (otsebyatina), QA | **v0.5**: два TEXT-JSON-поля. Otsebyatina-gate (plan_check) — v1, только advisory, сравнение строго против non_goals и decision-конфликтов |
| **Staleness/rot-модель документов**: last_verified/last_mapped_commit, метка STALE при выдаче | solo, QA | **v0.5** для карты кода (frontmatter-commit); v1 — метка «stale» в recall-выдаче |
| **Mode 1 / enforcement уровней доступа**: read-only без регистрации write-тулов, ноль хуков | минималист | **v1**: config-флаг, при котором CLI/skill-поверхность записи отключена. В v0 достаточно того, что хук — 3 строки и легко выключается |
| **Uninstall/exit-гарантия**: md-директория самодостаточна, индекс rebuild-from-files | минималист, solo | **v0**: одно предложение в спеку + команда `kdd rebuild`. Дёшево, критично для доверия |
| **Кросс-разработческий sync и multi-user concurrency** | team lead, frontend | **v2 / отклонить**: KDD v0–v1 — локальный однопользовательский субстрат; общий статус между людьми едет через git-md (решения) и, позже, экспорт JSON со стабильными ID. Полный Jira/ADO-sync — отклонить (чужой продукт) |
| **Test-run сущность, readiness-скоринг, вложения-доказательства** | QA | **v2 / отклонить как ядро**: это отдельный QA-продукт поверх субстрата. В ядре — только типизированные записи events/comments, на которые он сможет опереться |
| **Token/session-учёт на задачу + эскалация после N сессий** | автономщик | **v2**: колонки session_count/spent_tokens дёшевы, но потребитель (cron-режим) сам v1+; резервируем колонки, движок не пишем |
| **Failure-mode UX**: что видит пользователь при частичном контексте/побитом индексе | solo, минималист | **v0.5**: `kdd stats` показывает лог ошибок хуков и «N решений не видны из этого worktree» |

## 5. Конфликты и решения

1. **«Файлы — источник истины» (solo, минималист) vs «центральный SQLite» (принцип плана, agent-kanban, автономщик).**
   Решение — разрезать по типу состояния: **durable-знание (решения, learnings, спеки) = git-md, источник истины; операционное состояние (задачи, claims, events, индекс поиска) = один SQLite вне репо (`.git/kdd/` или user-cache), пересобираемый и не коммитимый.** Это одновременно снимает страх solo про «контаминацию между worktree» (контекст фильтруется по scope/branch-колонке) и решает его же сценарий №1 (незамёрдженное глобальное решение видно из любого worktree, потому что индекс общий). Задачи в v0 живут только в SQLite; если file-first-режим задач понадобится — v2.

2. **Push-уведомления (frontend, автономщик) vs pull-only и ноль инъекций (минималист, принцип).**
   Решение — лестница: v0 — чистый pull; v0.5 — queryable-сигналы (`--changed-since`, «newly unblocked»), т.е. push-вопрос превращён в дешёвый pull; v1 — один desktop-notify на Stop/waiting_on_human, выключенный по умолчанию; v2 — webhook/телефон. «Watcher-агент» — это скилл + `kdd wait`, не демон KDD.

3. **Минималист «ноль хуков» vs solo «авто-хуки — must-have, иначе никто не вызовет».**
   Решение — v0 ставит ровно один SessionStart-хук на ≤3 строки («субстрат есть: kdd status / kdd recall»), с однострочным отключением. Это ниже болевого порога минималиста и достаточно как pull-указатель для solo. Всё остальное — навык-контракт, не хуки.

4. **Enterprise «server-side enforcement, invoking-user, Jira» vs локальный однопользовательский субстрат.**
   Решение — взять дешёвую половину (actor-колонки, append-only events, стейт-машина в CLI-пути записи — это и есть «серверное» enforcement для локального инструмента; per-column гейты v1), отклонить дорогую (multi-user auth, Jira-sync, обязательный reason). Экспорт JSON со стабильными ID в v2 — честный ответ вместо полусинка.

5. **QA «test-run, readiness, вложения» vs scope-предупреждение плана.**
   Решение — отклонить из ядра. Субстрат даёт то, на чём QA-продукт можно построить (структурированные критерии v0.5, типизированные events, карта с commit-штампом). Readiness-скоринг, browser-runs, артефакты — отдельный плагин, не KDD.

6. **Otsebyatina-gate: solo хочет блокирующий plan_check, но сам же называет false positives deal-breaker'ом; принцип «ноль блокирующих гейтов» (анти-GSD).**
   Решение — v1, только advisory, сравнение строго детерминированное (явные non_goals[] + конфликт с decision-ID), hard-block — opt-in-конфиг, override одной командой с записью в events. Никогда не default-block.

7. **Автономщик «lease/TTL/heartbeat/бюджеты» vs v0 в 1–2 вечера.**
   Решение — v0 даёт атомарный claim + staleness-release (v0.5), что покрывает 90% его crash-сценария без lease-механики. TTL/heartbeat/journal — v1 (journal = те же events с action='progress'), бюджеты/эскалация — v2.

## 6. Уточнённые фазы v0–v2

### v0 — «Доска + решения + recall» (1–2 вечера, всё — CLI поверх одного SQLite + горстка md)

**Хранилище:** один SQLite-файл вне репо (WAL); ~4 таблицы: `tasks` (seq, title, status, scope/branch, claimed_by, session_id, failed_approaches), `events` (append-only: task_id, actor_type CHECK, actor_id, action CHECK, detail, session_id, ts), `decisions_index` (FTS5 по md-файлам + content-hash UNIQUE), `errors` (лог сбоев хуков). Решения — `docs/kdd/decisions/YYYY-MM-DD-topic.md` (шаблон: Decision / Rationale / Alternatives / Supersedes / Outcome ✓⚠—; без frontmatter-супа).

**CLI-глаголы (~8):** `kdd add`, `kdd claim` (атомарный UPDATE), `kdd done`, `kdd board` (текстовый рендер, derived), `kdd status` (digest ≤2KB), `kdd decide` (создаёт md + индексирует), `kdd recall` (FTS5 BM25, top-k с капом), `kdd rebuild` (индекс из файлов).

**Поведение:** стейт-машина переходов как чистая функция в CLI; переходы гейтятся по actor_type; каждый claim пишет session_id. Один skill-контракт (таблица рационализаций, Iron Laws: «claim не удался — стоп», «done для агента = review, complete — человек»). Один SessionStart-хук ≤3 строк, exit 0, локальный вызов, ошибки в `errors`. Ноль MCP-тулов, ноль веб-UI, ноль демонов, ноль эмодзи в выводе.

### v0.5 — «Параллелизм и свежесть»

- Staleness-release: in_progress без событий > cutoff → todo, опортунистически при чтении доски.
- `task_dependencies` + проверка циклов + pull-запрос «unblocked todo» + `kdd board --changed-since <rowid>`.
- Worktree-привязка: колонки worktree_path/branch на задаче; скилл worktree-per-task (detect-first, cleanup на терминальном статусе).
- Карта кода: фиксированный набор md (STRUCTURE/CONVENTIONS/ARCHITECTURE, максимум 4 файла) с `last_mapped_commit`; `kdd map-status` сравнивает с HEAD.
- Поля `acceptance_criteria[]`, `non_goals[]` на задаче (JSON TEXT).
- `kdd stats` (строки по kind, никогда-не-читанные, ошибки хуков, «N глобальных решений не видны из worktree»).
- MMR + recency-decay в recall; handoff-строка сессии (next_action, context_notes) + `kdd pause/resume`.
- Написанный output-контракт (≤5 строк, ноль декора) для всех команд и скиллов.

### v1 — «Автономный режим и знания»

- `kdd wait` (exit 0/2/124) + wakeup-probe `kdd probe` (board_rev = MAX(events.rowid), actionable_count; <200 токенов).
- Claim-lease с TTL + `kdd heartbeat`; journal = events(action='progress'); reclaim передаёт старый worktree + журнал.
- Per-column гейты как данные (column policy: кто может create/move/transition_out), enforcement в CLI-write-path, отказ логируется.
- waiting_on_human + questions/answers-поля; desktop-notify (Windows BurntToast-лестница), off по умолчанию.
- `kdd plan-check` — advisory-сверка плана с non_goals и decision-конфликтами; override с записью.
- `kdd learn` (ручной extract-learnings: 4 категории, атрибуция, graduated-флаг) + failure-derived constraints.
- Mode 1: config-флаг read-only (write-поверхность не регистрируется); простейший локальный веб-view доски (поллинг SQLite, read-only).
- Ревью-вердикты как строки; byte-budget CI-тест и pressure-тесты на собственные скиллы.

### v2 — спекулятивное (только по доказанной потребности)

- JSON-экспорт со стабильными ID (мост к Jira строит пользователь); model/effort/token_budget-колонки + эскалация в Blocked; webhook/телефон-уведомления и канал ответа; outcome-сигнал из git (revert-детекция); ручная консолидация с ревьюемым diff; file-first-режим задач; типизированные вложения/comment-payloads (фундамент для QA-плагина); apply -f спеки.

**Отклонено насовсем:** авто-инъекция памяти; leader/оркестратор-агенты и workflow-движок; эмбеддинги до провала FTS5; фоновые демоны и SSE; multi-user auth/hosted; полный Jira/ADO-sync; test-run/readiness в ядре; chat-через-БД; каталоги агентов per-stack; второй store любого вида.

---

**Сквозной принцип отсечения:** каждая новая таблица, тул и хук — подозреваемые по умолчанию. Тест на включение в фазу: «можно ли это получить одним SELECT / одной колонкой / одним md-файлом?» Если нет — фаза +1 или отказ.