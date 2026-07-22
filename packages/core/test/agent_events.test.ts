import { describe, expect, it } from 'vitest';
import { openDb, parseClaudeStreamLine, appendAgentEvent, listAgentEvents, taskDetail, addTask } from '../src/index.js';

function db() {
  const d = openDb(':memory:');
  addTask(d, { title: 't' }, { type: 'user' });
  return d;
}

describe('parseClaudeStreamLine', () => {
  it('assistant text block → text event', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } });
    expect(parseClaudeStreamLine(line)).toEqual([{ kind: 'text', detail: { text: 'hello' } }]);
  });

  it('assistant tool_use block → tool_start with name+input', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } });
    expect(parseClaudeStreamLine(line)).toEqual([{ kind: 'tool_start', name: 'Bash', detail: { input: { command: 'ls' } } }]);
  });

  it('assistant multi-block → multiple events, thinking skipped', () => {
    const line = JSON.stringify({ type: 'assistant', message: { content: [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'ok' },
      { type: 'tool_use', name: 'Read', input: { file: 'a' } }] } });
    expect(parseClaudeStreamLine(line)).toEqual([
      { kind: 'text', detail: { text: 'ok' } },
      { kind: 'tool_start', name: 'Read', detail: { input: { file: 'a' } } },
    ]);
  });

  it('user tool_result → tool_finish with isError', () => {
    const line = JSON.stringify({ type: 'user', message: { content: [
      { type: 'tool_result', content: 'boom', is_error: true }] } });
    expect(parseClaudeStreamLine(line)).toEqual([{ kind: 'tool_finish', detail: { output: 'boom', isError: true } }]);
  });

  it('system / result / malformed → []', () => {
    expect(parseClaudeStreamLine(JSON.stringify({ type: 'system', subtype: 'init' }))).toEqual([]);
    expect(parseClaudeStreamLine(JSON.stringify({ type: 'result', result: 'Hi.' }))).toEqual([]);
    expect(parseClaudeStreamLine('not json{')).toEqual([]);
    expect(parseClaudeStreamLine('')).toEqual([]);
  });
});

describe('append / list agent_events', () => {
  it('round-trips and orders by id', () => {
    const d = db();
    appendAgentEvent(d, 1, 'tick:1-0', 'run_start');
    appendAgentEvent(d, 1, 'tick:1-0', 'text', { detail: { text: 'hi' } });
    const rows = listAgentEvents(d, 1);
    expect(rows.map((r) => r.kind)).toEqual(['run_start', 'text']);
    expect(rows[0].worker_id).toBe('tick:1-0');
    expect(JSON.parse(rows[1].detail!)).toEqual({ text: 'hi' });
  });

  it('sinceId returns only newer, limit caps', () => {
    const d = db();
    const a = appendAgentEvent(d, 1, 'w', 'text', { detail: { text: '1' } });
    appendAgentEvent(d, 1, 'w', 'text', { detail: { text: '2' } });
    const rows = listAgentEvents(d, 1, { sinceId: a });
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].detail!)).toEqual({ text: '2' });
    expect(listAgentEvents(d, 1, { limit: 1 })).toHaveLength(1);
  });

  it('agent_events never leak into the audit events path (isolation)', () => {
    const d = db();
    appendAgentEvent(d, 1, 'w', 'tool_start', { name: 'Bash', detail: { input: {} } });
    expect(taskDetail(d, 1).events.some((e) => e.action === 'tool_start')).toBe(false);
  });
});
