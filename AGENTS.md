# Repository conventions

TypeScript, a pnpm workspace, Node.js 24.16 or later. Shared packages live in `packages/<name>` as `@devlanes/<name>`, and each browser gets an app in `apps/<browser>`.

- `packages/protocol` owns the types and parsers of the native host contract (protocol 1). The other side is `crates/browser-host` in devlanes-run/devlanes. A change to the contract lands in both repos.
- `packages/extension` owns the background, popup and content code. It stays browser agnostic.
- `apps/chromium` owns the manifest, the rsbuild config and the icons for Chrome, Chromium, Brave and Edge. The manifest's `key` fixes the extension id, which the devlanes host allows. Never change it.
- A new manifest permission needs a reason in the PR.

A new package is `private: true` and `type: module`. It has only the scripts among `build`, `test` and `test-types` that it has something to run for, and the root runs them with `pnpm -r`. Tests live in `<package>/test/*.test.ts`.

Biome owns the formatting and runs once from the root over every file. `pnpm lint-fix` applies its fixes.

The extension never receives environments, secrets or logs, and the host never forwards daemon JSON as it is. Settings live in the extension, per browser. Nothing goes into the devlanes config or the daemon.

## Worktrees and delivery

- Before changing files for a new pull request, fetch `origin/main` and create a fresh feature branch and Git worktree from the latest `origin/main`.
- Put worktrees under the repository's ignored `.worktrees/` directory. Implement, test, commit, push and ship the pull request from its feature worktree.
- After a pull request is merged, remove its clean worktrees and run `git worktree prune`. Never remove a dirty or unmerged worktree without confirming its work is preserved.

## Engineering rules

- Prefer simple, maintainable solutions with minimal abstractions and changes.
- Follow existing project conventions and avoid unnecessary refactoring.
- Keep changes within the requested scope. Report concrete risks without speculating.
- Every function and method has a JSDoc comment.
- Comments explain why, when or where, never what the code already says. Tricky code always gets one.

## Commits, branches and PRs

- Name branches `<type>/<short-kebab-case-description>`, with types like `feat`, `fix`, `chore`, `docs`, `refactor`, `test` and `ci` (for example `feat/add-popup`).
- Never use Conventional Commits or PR titles. Omit type prefixes (`feat:`, `fix:`) and write concise, imperative descriptions (for example `Add popup`, `Fix badge text`).
- Every PR opened by an AI agent MUST disclose the agent and model used (for example `Claude Code / Claude Opus 4.1`, `Codex / GPT-6`) in the PR description. This is mandatory, even for minor changes. Never omit, guess or misrepresent it.

## Writing style

- Write naturally, directly and concisely. Prioritize clarity, specificity and substance over polished or dramatic prose.
- Avoid common AI writing tropes: "It's not X, it's Y", rhetorical questions, forced metaphors, grandiose claims, false suspense and manufactured one-liners.
- Avoid excessive em dashes, short punchy fragments, repetitive sentence structures, rule-of-three patterns and unnecessary adverbs.
- Skip preambles, self-narration, filler transitions, redundant explanations, repeated summaries and conclusions that restate earlier points.
- Prefer simple, precise vocabulary. Avoid corporate jargon, promotional language, invented terminology, vague attributions and synonym cycling.
- Use natural paragraph lengths and sentence structures. Avoid excessive lists, bold-first bullets, title-case headings and decorative Unicode.
- Preserve the author's voice. Don't force collective language ("we"), unnecessary enthusiasm, artificial humility or exaggerated certainty.
- Messages shown to users say what's wrong, then what to do.
- Treat these as patterns to avoid overusing, not absolute bans. Favor context and natural writing over rigid rules.

## Public content

Examples and fixtures use neutral names (`acme`, `example.invalid`) and never contain credentials, private paths or references to files outside this repository.

## Checks

```sh
pnpm lint-ci
pnpm build
pnpm test-types
pnpm test
pnpm zip
```

- Tests run with `tsx --test`.
- When a test fails intermittently, locally or in CI, fix the flake instead of rerunning it until it passes.
