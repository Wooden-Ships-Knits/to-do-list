COMPOSE      := docker compose
COMPOSE_DEV  := docker compose -f docker-compose.yml -f docker-compose.dev.yml

DUMP ?= db-dump/todo.sql

# Playwright runs against its own stack (own project name, ports and database volume), so it
# never touches the data of the normal stack.
E2E_PORT     ?= 8091
E2E_COMPOSE  := DB_PORT=5466 BACKEND_PORT=8020 FRONTEND_PORT=$(E2E_PORT) docker compose -p todo-e2e

.PHONY: dump-db restore-db dev up down seed seed-users reset-db test test-backend test-frontend e2e e2e-up e2e-down lighthouse acceptance lint lint-backend lint-frontend

dev:            ## Hot-reload stack: Vite on :5173, API on :8000
	$(COMPOSE_DEV) up --build

up:             ## Production-style stack (nginx) on :8090
	$(COMPOSE) up --build -d --wait

down:
	$(COMPOSE) down

seed:           ## Idempotent seed data
	$(COMPOSE) up -d --wait db backend
	$(COMPOSE) exec backend python -m app.seed

reset-db:       ## Wipe the database volume, migrate and seed again
	$(COMPOSE) down -v
	$(COMPOSE) up -d --build --wait db backend
	$(COMPOSE) exec backend python -m app.seed

test: test-backend test-frontend

test-backend:   ## pytest against a real Postgres (database todo_test in the db container)
	$(COMPOSE_DEV) up -d --wait db
	$(COMPOSE_DEV) run --rm --no-deps --build backend pytest

test-frontend:
	cd frontend && npm run test

e2e-up:         ## Fresh, seeded stack for Playwright on :$(E2E_PORT) (separate volume)
	$(E2E_COMPOSE) down -v
	$(E2E_COMPOSE) up -d --build --wait
	$(E2E_COMPOSE) exec backend python -m app.seed

e2e: e2e-up     ## Playwright on all 8 viewports (own stack: your data is never touched)
	cd frontend && BASE_URL=http://localhost:$(E2E_PORT) npm run e2e

e2e-down:       ## Stop the Playwright stack and delete its database
	$(E2E_COMPOSE) down -v

lighthouse:     ## Lighthouse mobile run (Accessibility >= 95, Performance >= 85)
	$(MAKE) up
	cd frontend && npm run lighthouse

acceptance:     ## Rebuild ACCEPTANCE.md from the latest real test results
	cd frontend && npm run test:report && node scripts/acceptance.mjs

lint: lint-backend lint-frontend

lint-backend:
	$(COMPOSE_DEV) run --rm --no-deps --build backend sh -c "ruff check . && ruff format --check . && mypy app tests"

lint-frontend:
	cd frontend && npm run lint

dump-db:        ## Plain-SQL dump of the whole database (schema + data) to $(DUMP)
	$(COMPOSE) up -d --wait db
	$(COMPOSE) exec -T db sh -c 'pg_dump -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' > $(DUMP)
	@echo "Wrote $(DUMP)"

restore-db:     ## Load $(DUMP) into the database (replaces what is there), then start the app
	$(COMPOSE) up -d --wait db
	$(COMPOSE) exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"' < $(DUMP)
	$(COMPOSE) up -d --build --wait
	@echo "Restored $(DUMP)"
