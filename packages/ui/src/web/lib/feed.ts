// append-only merge: дедуп по id, порядок сохранён. Чистый, без импортов —
// ui vitest импортирует ТОЛЬКО этот модуль (нет @-alias/jsdom для .tsx-компонента).
export function mergeFeed<T extends { id: number }>(prev: T[], incoming: T[]): T[] {
  if (!incoming.length) return prev;
  const seen = new Set(prev.map((e) => e.id));
  const fresh = incoming.filter((e) => !seen.has(e.id));
  return fresh.length ? [...prev, ...fresh] : prev;
}

// claude's tool_result.content — часто массив text-блоков, не строка; String(output)
// на нём даёт '[object Object]'. Разворачиваем в читаемый текст для Activity tab.
export function fmtOutput(output: unknown): string {
  if (output === null || output === undefined) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    // Read of image/PDF -> mixed content [{type:'text',...}, {type:'image',...}] — не все блоки
    // текстовые. Берём то, что есть текстом, игнорируя картинки/прочее; JSON только если текста нет.
    const texts = output.filter((b) => typeof b?.text === 'string').map((b) => b.text as string);
    return texts.length ? texts.join('\n') : JSON.stringify(output);
  }
  return JSON.stringify(output);
}
