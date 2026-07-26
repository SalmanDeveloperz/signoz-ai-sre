# frontend

The AI SRE Console: a Vite + React + TypeScript UI for this repo's 3 backend services.

Full documentation (stack, folder structure, what each panel does, how to run it) lives in the root [`README.md`](../README.md#8-the-ui-reactnextjs), Section 8. Quickstart:

```bash
npm install
npm run dev
```

Requires the backend stack to already be running (`docker compose up -d --build` from the repo root, see root README Section 2). Talks to `control-plane`, `worker-service`, and `watcher-service` through Vite's dev-server proxy (`vite.config.ts`), no CORS setup needed.
