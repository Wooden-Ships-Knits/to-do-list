COMPOSE      := docker compose
COMPOSE_DEV  := docker compose -f docker-compose.yml -f docker-compose.dev.yml

DUMP ?= db-dump/todo.sql

.PHONY: dump-db restore-db dev up down seed reset-db test test-backend test-frontend e2e lighthouse acceptance lint lint-backend lint-frontend

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

e2e:            ## Playwright on all 8 viewports against the Docker stack (fresh, seeded database)
	$(MAKE) reset-db
	$(MAKE) up
	cd frontend && npm run e2e

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
