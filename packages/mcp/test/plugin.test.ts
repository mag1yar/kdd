import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

describe('plugin files', () => {
  it('manifest names the plugin kdd', () => {
    expect(JSON.parse(read('.claude-plugin/plugin.json')).name).toBe('kdd');
  });

  it('.mcp.json registers the kdd server via CLAUDE_PLUGIN_ROOT', () => {
    const mcp = JSON.parse(read('.mcp.json'));
    const kdd = mcp.mcpServers.kdd;
    expect(kdd.command).toBe('node');
    expect(kdd.args.join(' ')).toContain('${CLAUDE_PLUGIN_ROOT}');
    expect(kdd.args.join(' ')).toContain('packages/mcp/dist/main.js');
  });

  it('hooks.json wires SessionStart to both scripts', () => {
    const hooks = JSON.parse(read('hooks/hooks.json'));
    const cmd = hooks.hooks.SessionStart[0].hooks[0].command;
    expect(cmd).toContain('smart-install.mjs');
    expect(cmd).toContain('session-start.mjs');
  });

  it('skill declares the kdd contract with an Iron Law', () => {
    const skill = read('skills/kdd/SKILL.md');
    expect(skill).toMatch(/^name:\s*kdd/m);
    expect(skill).toMatch(/Iron Law/i);
  });
});
