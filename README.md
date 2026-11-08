# chip-daw

A browser-based DAW for chiptune / 8-bit / 16-bit music, with an OP-1-inspired look.

- What it should be: [design-principles.md](design-principles.md)
- How it's built: [ARCHITECTURE.md](ARCHITECTURE.md)
- What's next: [ROADMAP.md](ROADMAP.md)

## Development

Requires Node 22+.

```sh
npm install
npm run dev        # start the dev server
npm test           # unit tests (model, engine, control maths)
npm run check      # type-check: app, core (no DOM), and config
npm run lint       # ESLint, including the core import boundary
npm run format     # Prettier
npm run build      # production build into dist/
```

Audio starts on your first click or key press, because browsers block audio until a user gesture.

## Deploying

Every push to `main` is checked, built and deployed to GitHub Pages by
[.github/workflows/deploy.yml](.github/workflows/deploy.yml). One-time setup: in the repository's
**Settings → Pages**, set **Source** to **GitHub Actions**.
