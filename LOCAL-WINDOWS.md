# Run SPR on a Windows PC

This starts a **new, empty** PostgreSQL 18 database and Redis in Docker Desktop, then runs the existing SPR app locally. It does not copy Railway data or change the old database. Docker named volumes keep local database data across restarts.

1. Install Docker Desktop (with WSL 2), Node.js **22**, and Git. Start Docker Desktop.
2. In PowerShell:

   ```powershell
   git clone -b codex/local-windows-recovery https://github.com/dreamzzzz120-cell/software-passport-registry.git
   cd software-passport-registry
   powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1
   ```

3. The first run creates `.env.local` with a random database password and stops. Edit `.env.local` and fill the existing SPR Supabase project URL and publishable key in both the `VITE_` and server fields. Fill `SUPABASE_SERVICE_ROLE_KEY` and `SPR_INITIAL_OWNER_EMAIL` with an existing, confirmed Supabase user email. Never share or commit this file. The fresh SPR database does **not** reset Supabase Auth users.
4. Run `powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1` again. The script starts Postgres and Redis, installs locked dependencies, migrates the database, creates the first Owner when needed, and starts the app at `http://localhost:3000`.
5. Check `http://localhost:3000/health` and `http://localhost:3000/health/ready`. The latter must report readiness. Keep the PowerShell window open while running the app.

To restart quickly: `powershell -ExecutionPolicy Bypass -File .\scripts\start-local.ps1 -SkipInstall`. To stop the databases without erasing data: `docker compose --env-file .env.local -f compose.local.yml down`. **Do not use `down -v`** unless you intend to erase the new local database.

This is a local development run. Public access from other devices, production HTTPS, billing, owner bootstrap, the worker, and production role separation require additional configuration. The Railway app is not automatically redirected to your PC.
