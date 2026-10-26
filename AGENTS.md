# Loanly — agent and contributor guide

Chat web app for a Computer Networks course (socket programming). Read before working:
`GLOSSARY.md` (vocabulary), `docs/CONTRACT.md` (WebSocket/REST contract), `docs/PLAN.md` (who owns what), `docs/adr/` (decisions).

Stack: FastAPI + Motor + MongoDB (`backend/`), Vite + React + TypeScript + Tailwind (`frontend/`).

## Workflow (every change)
1. **Branch** from an up-to-date `main`: `[tag]/#[issue]-[name]`, e.g. `feat/#12-group-join`. One issue per branch.
2. **Implement** as planned in `docs/PLAN.md`. Stay inside your workstream's folders; change `docs/CONTRACT.md` only via a change agreed by all four owners.
3. **Write unit tests** for the new behaviour (`pytest` in `backend/tests/`, `vitest` in `frontend/`).
4. **Gate**: tests pass first, then lint and security checks. Fix failures; never skip or disable a check to get green.
   - Backend: `ruff check .`, `bandit -r app`, `pip-audit`
   - Frontend: `npm run lint`, `npm audit --omit=dev`
5. **PR** to `main` describing what and why, link the issue, then merge once the gate is green. Delete the branch after merging.

## Conventions
- **Tags**: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`. Same tags for branches, commits and PRs.
- **Commit message**: `[tag]: [message]`, e.g. `feat: let members leave a group`. Imperative, lowercase, no trailing period.
- Never commit secrets. `.env` is git-ignored; add new variables to `.env.example`.
- Use the glossary terms in code, UI text and docs (Chat Room, Group, Creator, Member...).
- Chat actions go over the WebSocket only; auth and AI go over REST (ADR 0002).
