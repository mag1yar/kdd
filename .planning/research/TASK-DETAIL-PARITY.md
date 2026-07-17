# Task Detail Parity — Azure DevOps & Jira

Анализ детального вида задачи в Azure DevOps и Jira (скриншоты пользователя, 2026-07-17)
для развития `TaskDialog` веб-канбана. Источник идей: [ORIGINAL-PLAN.md](ORIGINAL-PLAN.md).

## Наблюдаемые паттерны

Общее в обоих продуктах:
ID+title · статус-дропдаун · assignee · priority · метки/теги · parent+сабтаски ·
связанные задачи · rich description · комменты (markdown/@/#) · история/activity ·
watchers · спринт · estimate · даты · dev-линки (commit/PR) · вложения · автоматизация.

- **Azure DevOps** — энтерпрайз-тяжёлый: кастомные поля (Result DEV/TEST, Personas affected),
  Deployment/Releases, Effort (Hours), Implementation. Много процесс-специфики.
- **Jira** — чище: правая панель «Сведения» (Details rail), подзадачи с прогресс-баром,
  табы Активности (Все/Комментарии/История/Журнал), quick-reply чипы в комменте.

Взятый структурный паттерн для kdd: **Jira Details-rail + Activity-tabs** — ложится на shadcn,
не тащит энтерпрайз-cruft.

## kdd отличается

kdd — не командный трекер, а substrate под агентами:
- «Исполнитель» = человек **или** ai-агент (`actor_type`, комменты/события метят `user` vs `ai:session`).
- Доступ через MCP/CLI (pull), не только web.
- Одна доска на все worktree (key = git-common-dir).
- Blocked — first-class событие (block/unblock в истории), а не только статус.
- Decisions/conventions + FTS recall — durable-знание, привязанное к задачам (уникально).

## Решения (что делаем / потом / не нужно)

### Сделано (2026-07-17, Phase 5)
Всё уже было в схеме/ops — только выведено в UI:

| Фича | Как |
|---|---|
| Статус-дропдаун | `<Select>` в Details-rail → `moveTask(id, to)` |
| История/Activity | таб History, рендер `events` (created/moved/blocked/linked/commented) |
| Даты created/updated | Details-rail |
| Blocked + reason | Details-rail: бейдж+reason, кнопки Block(reason)/Unblock (block/unblock API) |
| Связанные задачи | Details-rail Related, рендер `links` из `task_links` |
| Markdown в комментах | `<Prose>` (react-markdown), inline-code видимый |
| Composer | InputGroup-стиль: textarea+Send в рамке |

### На будущее (нужна модель/большой слой)

| Фича | Зачем | Блокер |
|---|---|---|
| Parent / сабтаски + прогресс | декомпозиция (idea #5), Jira-бар | нужен `parent_id` + агрегатор |
| Estimate / points | планирование | новое поле; агенты часами не мерят |
| Dev-линки (commit/PR/branch) | привязка коммитов→задачам (idea #8) | git-слой |
| `@`/`#` в комментах | `#3` линк на задачу для агента | парсер+резолв |
| Quick-reply чипы | быстрый ответ человека агенту | после autonomy-loop |
| Autonomy-контроль на задаче | модель+effort агента, «докуда автономен» (idea #2) | слой оркестрации |
| Agent-loop / автоматизация | ядро (idea #1) | слой оркестрации |

### Не нужно (энтерпрайз-cruft / чужой контекст)

Watchers/Follow (single-user) · Спринт-поле (worktree=спринт, idea #6) ·
Result DEV/TEST · Personas affected · Deployment/Releases ·
Story Points/Activity/Effort(Hours) как обязательные · Attachments (YAGNI).
