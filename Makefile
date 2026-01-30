.PHONY: build up down logs test-backend test-frontend

build:
	docker-compose build

up:
	docker-compose up -d

down:
	docker-compose down

logs:
	docker-compose logs -f

test-backend:
	docker-compose run backend pytest

test-frontend:
	docker-compose run frontend npm test
