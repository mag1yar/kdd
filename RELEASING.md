# Releasing

Versions move in lockstep: all `packages/*` + `.claude-plugin/plugin.json` share one version.

```sh
pnpm release
```

One command does everything:

1. **bumpp** prompts for the new version and writes it to the root `package.json`,
   every `packages/*/package.json` and `.claude-plugin/plugin.json`
2. runs `pnpm build && pnpm test` (rebuilt `dist/` is tracked and lands in the commit)
3. commits everything (`--all`) and tags `vX.Y.Z` — no push
4. `pnpm -r publish` publishes the non-private packages
   (`@kddkit/core`, `@kddkit/cli`, `@kddkit/ui`; `@kddkit/mcp` is private, ships inside the plugin)

Then push manually:

```sh
git push --follow-tags
```

Requirements: clean working tree, `npm whoami` succeeds (`npm login` otherwise).
If publish fails after the tag exists (OTP, network), just rerun `pnpm -r publish` —
pnpm skips versions already in the registry.
