# Working on Pi Coder

- Keep this as a Pi extension/package. Do not fork Pi or add a second terminal UI.
- Use strict red/green TDD for behavior changes: add a failing Vitest test, run it, make the smallest change, and rerun.
- Check the pinned `@earendil-works/pi-coding-agent` and `@earendil-works/pi-ai` API types/source before changing extension hooks or provider calls.
- Keep routing candidates restricted to direct Anthropic and OpenAI endpoints and Pi-authenticated available models.
- Never write prompts, responses, tool content, credentials, paths, headers, or project names to usage files.
- Do not add upload, release, or publish automation without an explicit request.
- Run `bun run format`, `bun run lint`, `bun run typecheck`, `bun run test`, and `bun run build` before review.
