# Project Context: Bifrost (Used and updated by the ReviewBot)

## 1. Overview & Purpose
Bifrost is a software engineering bachelor project focused on building a scalable, maintainable system following Clean Architecture principles.

## 2. Tech Stack & Key Technologies
- **Backend:** .NET (C#)
- **Frontend:** TBD (Will be updated automatically when frontend code is introduced)
- **Architecture:** Clean Architecture / Domain-Driven Design (DDD)
- **CI/CD:** GitHub Actions (Automated build & test pipelines, automated AI reviewer, context updater)

## 3. Architecture & Dependency Rules
- **Domain Layer:** Pure business entities, domain events, domain logic. Zero external dependencies.
- **Application Layer:** Use cases, interfaces, DTOs, commands/queries. Depends only on Domain.
- **Infrastructure Layer:** Database contexts, repositories, external API clients, message queues.
- **Presentation / API Layer:** Controllers, API endpoints, web views.
- **Core Rule:** Dependencies must always point inward. No database calls in controllers.

## 4. Modules & Domain Services
*(This section is automatically updated by the review bot during reviews)*