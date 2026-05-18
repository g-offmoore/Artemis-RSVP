# Legacy Prisma Directory

The production Prisma schema now lives at:

```text
packages/db/prisma/schema.prisma
```

Use the workspace scripts from the repository root:

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```
