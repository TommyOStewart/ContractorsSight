# ContractorSight

Voice notes, photos of handwritten notes, and typed text in; reviewed, structured job records out. Built for trade contractors, starting with plumbers.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how it fits together and the rules that hold it together.

```bash
pnpm install
pnpm test
pnpm export:tool-schemas
pnpm db:start && pnpm db:reset   # local Supabase; requires Docker
```
