# Normfest Sales Assistant

Internal sales assistant for the Normfest outbound telesales team. See `CLAUDE.md` for
the full project contract and `TODO.md` for the build plan.

## Getting started

```bash
pnpm install
cp .env.example .env.local   # fill in Supabase project values
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `pnpm dev` — dev server
- `pnpm build` — production build
- `pnpm typecheck` — `tsc --noEmit`
- `pnpm lint` — ESLint
- `pnpm test` — vitest

## Database

Migrations live in `supabase/migrations/`. Apply with the Supabase CLI once a project
is linked:

```bash
pnpm dlx supabase link --project-ref <ref>
pnpm dlx supabase db push
```
