# create-ja-express

ja-express package

## Quick Start

Scaffold a new project with:

```bash
npm create ja-express@latest express-project
cd express-project
```

## Project Structure

```
index.js                # Entry point - loads env, starts the server
src/
  app.js                # Builds the Express app (no .listen - used by tests too)
  routes/v1/            # Route definitions
  controllers/v1/       # Request handlers
  models/               # DB queries (mysql2)
  middlewares/          # authentication / authorization
  schemas/              # Zod request validation schemas
  services/             # External integrations (e.g. email)
  utils/                # Helpers (jwt, hashing, etc.)
migrations/             # SQL table definitions
scripts/migrate.js      # Runs the .sql files in migrations/
```
