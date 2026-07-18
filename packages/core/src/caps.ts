// Контекст-бюджет как данные, не как дисциплина вывода: все капы CLI/MCP в одном
// месте (паттерн hermes tool_output_limits). Числа — контракт из спеки.
export const CAPS = {
  boardRows: 8,            // строк на колонку: CLI board + MCP list_tasks
  statusRows: 5,           // строк на секцию kdd status
  statusEvents: 5,         // recent-событий в statusDigest
  titleChars: 50,
  blockReasonChars: 40,
  bodyChars: 8192,         // тело задачи в show/get_task
  comments: 20,            // последних комментов в show/get_task
  commentChars: 500,
  events: 10,              // последних событий в show/get_task
  recallK: 10,             // дефолтный top-k
  recallKMax: 50,          // потолок k — больше не отдаём никому
  recallSnippetTokens: 12,
  recallBytes: 4096,       // бюджет текстовой выдачи kdd recall
  recallTitleChars: 60,
  trackDescChars: 200,
} as const;

export function capText(s: string, n: number): string {
  if (s.length <= n) return s;
  // не резать суррогатную пару — lone surrogate ломает строгий JSON/UTF-8
  const cut = n - ((s.charCodeAt(n - 1) & 0xfc00) === 0xd800 ? 1 : 0);
  return `${s.slice(0, cut)}… [+${s.length - cut} chars]`;
}
