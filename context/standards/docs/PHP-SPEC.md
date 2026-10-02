Modern PHP Engineering Standards (2026)

Philosophy

Modern PHP is no longer “sprinkle PHP into HTML templates.”

A modern PHP codebase should:

- Be strongly typed wherever possible
- Follow PSR standards
- Prefer composition over inheritance
- Be framework-agnostic at the domain layer
- Embrace dependency injection
- Use async/event-driven approaches only where they truly add value
- Treat PHP as a serious backend engineering language
- Avoid global state and magic-heavy abstractions
- Be testable by design
- Favor explicitness over convenience magic

⸻

Recommended Stack Philosophy

Runtime

Target:

- PHP 8.3+

Avoid supporting ancient versions unless required by business constraints.

Modern PHP features are genuinely valuable:

- Constructor property promotion
- Attributes
- Readonly properties/classes
- Union/intersection types
- Enums
- Match expressions
- First-class callable syntax
- Fibers (advanced use cases)

⸻

Project Structure

Recommended structure:

src/
Domain/
Application/
Infrastructure/
Presentation/
config/
bootstrap/
public/
storage/
tests/

Alternative lightweight structure:

src/
Core/
Services/
Repositories/
Http/
Support/

Prefer clear boundaries over deep nesting.

Avoid:

src/Everything/Managers/Helpers/Utilities/Common/Shared/

If naming becomes difficult, architecture is usually becoming unclear.

⸻

Composer Standards

Always Use Composer

Never manually include files.

Use:

composer install
composer require
composer update

Use PSR-4 autoloading:

{
"autoload": {
"psr-4": {
"App\\": "src/"
}
}
}

Then:

composer dump-autoload

⸻

PSR Standards You Should Actually Follow

PSR-1 / PSR-12

Code style and formatting.

Use:

- 4 spaces
- Strict formatting
- One class per file
- Clear imports

Automate with:

- PHP-CS-Fixer
- Laravel Pint

Never argue about formatting manually in PRs.

⸻

PSR-4

Autoloading standard.

Namespace must mirror folder structure.

namespace App\Services\Billing;

Should exist at:

src/Services/Billing/

⸻

PSR-3

Logging interface.

Use:

Psr\Log\LoggerInterface

instead of custom loggers.

⸻

PSR-7 / PSR-15

HTTP messages and middleware.

Especially valuable in:

- Slim
- Mezzio
- Symfony ecosystems
- Custom APIs

Understanding middleware pipelines is important.

⸻

Strict Typing

Always Enable Strict Types

At the top of every PHP file:

<?php
declare(strict_types=1);

This should be non-negotiable.

⸻

Type Safety Standards

Always Type Everything

Good:

public function calculateTotal(Order $order): Money

Bad:

public function calculateTotal($order)

Type:

* Parameters
* Return values
* Properties
* Collection generics via PHPStan/Psalm annotations

⸻

Static Analysis Is Mandatory

Use PHPStan

Target:

* PHPStan level 8 or max

Example:

composer require --dev phpstan/phpstan

Run:

vendor/bin/phpstan analyse

Static analysis catches enormous amounts of runtime bugs.

Modern PHP without static analysis is incomplete.

Psalm is also excellent.

⸻

Dependency Injection

Prefer Constructor Injection

Good:

final class OrderService
{
    public function __construct(
        private readonly PaymentGateway $payments,
    ) {}
}

Avoid:

* Service locators
* Facade abuse
* Global helpers
* Static singleton state

⸻

Prefer Immutable Objects

Use readonly properties/classes when possible.

Good:

final readonly class Money
{
    public function __construct(
        public int $amount,
        public string $currency,
    ) {}
}

Immutable objects reduce debugging complexity significantly.

⸻

Value Objects Over Primitive Obsession

Avoid passing loose strings and arrays everywhere.

Bad:

createUser(string $email)

Better:

createUser(EmailAddress $email)

Common value objects:

* EmailAddress
* Money
* UserId
* OrderId
* PhoneNumber
* Currency
* DateRange

⸻

Arrays Are Overused in PHP

Avoid “God arrays.”

Bad:

$user['email']

Prefer DTOs or value objects.

Good:

$user->email

Or:

$user->email()

⸻

DTO Standards

DTOs are extremely useful for:

* Request validation
* API boundaries
* Queue payloads
* Service communication

Example:

final readonly class CreateUserDTO
{
    public function __construct(
        public string $name,
        public string $email,
    ) {}
}

⸻

Architecture Recommendations

Recommended Default

For most systems:

* Modular monolith first
* Domain-driven boundaries
* Clear application layer
* Avoid premature microservices

A well-structured modular monolith outperforms poorly managed microservices almost every time.

⸻

Layer Responsibilities

Domain Layer

Contains:

* Business rules
* Entities
* Value objects
* Domain services
* Domain events

Should NOT know about:

* Frameworks
* HTTP
* Databases
* Queues
* Redis
* External APIs

⸻

Application Layer

Coordinates use cases.

Contains:

* Commands
* Queries
* Handlers
* Orchestration
* Transactions

Should be thin.

⸻

Infrastructure Layer

Contains:

* Database access
* Redis
* Filesystems
* APIs
* Queue adapters
* Framework integration

Framework code belongs here.

⸻

Presentation Layer

Contains:

* Controllers
* HTTP handling
* Validation
* Serialization
* Response mapping

Controllers should stay thin.

⸻

Database Standards

Use Migrations

Never manually mutate production databases.

Use:

* Laravel migrations
* Doctrine migrations
* Phinx

⸻

ORM Guidance

ORMs Are Tools, Not Architecture

Use:

* Eloquent
* Doctrine

But avoid leaking ORM models everywhere.

Domain logic should not depend heavily on ORM internals.

⸻

Repository Guidance

Repositories are useful when:

* Abstracting persistence complexity
* Supporting domain boundaries
* Avoiding ORM leakage

Repositories are NOT useful when:

* They simply mirror ORM methods
* They become generic CRUD wrappers

Bad:

UserRepository->find()
UserRepository->save()
UserRepository->delete()

Good:

UserRepository->findActiveSubscribers()

⸻

Validation

Validation belongs at boundaries.

Examples:

* HTTP request validation
* Message validation
* DTO validation

Do not scatter validation logic randomly across services.

⸻

Exceptions

Exceptions Are For Exceptional Situations

Do not use exceptions for standard control flow.

Good candidates:

* Infrastructure failures
* Invalid state
* External service issues
* Security violations

Avoid:

try {
    return false;
} catch (...) {}

⸻

Error Handling

Use structured exception hierarchies.

Example:

DomainException
InfrastructureException
ValidationException
AuthenticationException

Avoid giant catch-all exception patterns.

⸻

Async Processing

Use queues for:

* Emails
* Webhooks
* Heavy processing
* Video/image processing
* AI jobs
* Reporting

Avoid synchronous HTTP chains for long-running work.

⸻

Queue Recommendations

Common options:

* Redis queues
* RabbitMQ
* SQS

Laravel Horizon is excellent for queue visibility.

⸻

API Standards

Prefer JSON APIs

Typical modern stack:

* REST
* GraphQL
* Hybrid approaches

Use:

* OpenAPI/Swagger
* Typed DTOs
* Consistent error structures

⸻

API Response Standards

Good:

{
  "data": {},
  "meta": {},
  "errors": []
}

Avoid inconsistent response shapes.

⸻

Authentication

Prefer:

* OAuth2
* OpenID Connect
* JWT carefully
* Session auth for web apps

Never roll your own crypto/authentication.

⸻

Security Standards

Non-Negotiables

Always:

* Hash passwords with Argon2id or bcrypt
* Escape output
* Use prepared statements
* Validate uploads
* Sanitize file paths
* Implement CSRF protection where relevant
* Rate limit APIs
* Store secrets in environment variables

Never:

* Commit secrets
* Trust user input
* Build SQL strings manually

⸻

Configuration Standards

Use environment-based configuration.

Example:

APP_ENV=production
DB_HOST=localhost

Never read env values directly throughout the app.

Centralize configuration access.

⸻

Testing Standards

Minimum Expectations

Every modern PHP project should have:

* Unit tests
* Integration tests
* Basic end-to-end coverage

Recommended:

* Pest
* PHPUnit

Pest is especially pleasant for modern teams.

⸻

Test Philosophy

Test behavior, not implementation.

Bad:

expects()->method('setValue')

Better:

assertEquals('active', $user->status())

Avoid over-mocking.

⸻

Framework Recommendations

Laravel

Best for:

* Product teams
* Rapid development
* Startups
* Internal systems
* APIs

Strengths:

* Developer experience
* Ecosystem
* Tooling
* Queues
* Authentication
* Testing support

Risks:

* Facade overuse
* Magic-heavy architecture
* Fat models/controllers

Use Laravel carefully and it scales well organizationally.

⸻

Symfony

Best for:

* Large enterprise systems
* Long-lived platforms
* Highly structured teams

Strengths:

* Explicit architecture
* Strong DI container
* Stability
* Mature components

Tradeoff:

* Slower onboarding
* More ceremony

⸻

Slim

Best for:

* Lightweight APIs
* Minimal systems
* Custom architectures

Good when you want maximum control.

⸻

Modern PHP Patterns

CQRS

Useful when:

* Read/write models differ heavily
* Complex workflows exist
* Scaling queries separately matters

Avoid introducing CQRS purely because it sounds advanced.

⸻

Event-Driven Design

Useful for:

* Decoupling workflows
* Notifications
* Auditing
* Integrations

Avoid event explosion.

Not everything should become an event.

⸻

Caching

Use caching intentionally.

Common layers:

* Query caching
* HTTP caching
* Redis caching
* Computed result caching

Never cache blindly.

Measure first.

⸻

Performance Reality

Most PHP performance issues are:

* N+1 queries
* Bad database indexes
* Excessive serialization
* Unbounded loops
* Blocking external APIs
* Memory-heavy collections

Not “PHP is slow.”

⸻

Observability

Minimum production standards:

* Structured logging
* Error tracking
* Metrics
* Health checks
* Request tracing where useful

Recommended tools:

* Sentry
* OpenTelemetry
* Prometheus
* Grafana

⸻

Docker Standards

Prefer containerized local development.

Typical stack:

* PHP-FPM
* Nginx/Caddy
* Redis
* PostgreSQL/MySQL

Avoid “works on my machine” setups.

⸻

Preferred Database Choices

PostgreSQL First

Prefer PostgreSQL unless there is a strong reason otherwise.

Advantages:

* Reliability
* Advanced indexing
* JSON support
* Better SQL features
* Strong concurrency

MySQL is still completely valid.

SQLite is excellent for:

* Local development
* Small apps
* Embedded systems
* Testing

⸻

Frontend Integration

Common modern approaches:

* PHP API + React/Vue frontend
* Laravel + Inertia
* Blade/Twig for server rendering
* HTMX for simpler systems

Avoid prematurely overengineering frontend architecture.

⸻

CI/CD Standards

Every repository should include:

* Linting
* Static analysis
* Tests
* Security scanning
* Build validation

CI should fail on:

* Formatting issues
* Static analysis violations
* Test failures

⸻

Git Standards

Branch Strategy

Simple is usually best:

* main
* feature/*
* fix/*

Avoid overly complicated GitFlow unless organizationally necessary.

⸻

Pull Request Standards

PRs should:

* Be small enough to review
* Include tests
* Explain architectural decisions
* Avoid mixing unrelated concerns

Large PRs reduce review quality dramatically.

⸻

Code Review Standards

Review for:

* Architecture
* Correctness
* Maintainability
* Simplicity
* Naming clarity
* Boundary violations

Avoid nitpicking formatting.

Automation should handle style.

⸻

Naming Standards

Good naming matters enormously in PHP.

Prefer:

CalculateInvoiceTotals

Over:

InvoiceManager

Avoid vague words:

* Manager
* Helper
* Util
* Common
* Base
* Handler (unless actually a handler)

Names should describe responsibility.

⸻

Traits Guidance

Traits are often overused.

Use traits for:

* Shared implementation details
* Truly cross-cutting behavior

Avoid trait pyramids and hidden coupling.

Prefer composition first.

⸻

Inheritance Guidance

Prefer composition over inheritance.

Avoid deep inheritance chains.

Usually:

BaseController
  -> ApiController
    -> VersionedController
      -> UserController

is a design smell.

⸻

Laravel-Specific Best Practices

If using Laravel:

Prefer:

* Form requests
* Service classes
* Jobs/events/listeners
* Policies
* Resource transformers
* Scoped bindings
* Eager loading

Avoid:

* Fat controllers
* Fat Eloquent models
* Business logic in routes
* Massive service providers
* Hidden magic macros everywhere
* Global helpers for core business logic

⸻

AI Engineering + PHP

PHP works surprisingly well for:

* AI orchestration APIs
* Internal tooling
* Queue-based AI workflows
* RAG dashboards
* Embedding pipelines
* CMS-integrated AI features

But Python still dominates:

* ML training
* Data science
* Experimental AI tooling

A practical architecture is often:

PHP -> orchestration/business system
Python -> ML/data pipeline

Connected via:

* HTTP
* Queues
* gRPC
* Kafka

⸻

Recommended Modern PHP Tooling

Core

* Composer
* PHPStan
* Pint or PHP-CS-Fixer
* PHPUnit or Pest
* Rector

⸻

Useful Additions

* Laravel Herd / Valet
* Docker Compose
* Xdebug
* Telescope
* Horizon
* Symfony Profiler

⸻

Rector

Rector is extremely valuable for automated refactors and PHP upgrades.

Example:

composer require rector/rector --dev

Useful for:

* Framework upgrades
* PHP version upgrades
* Automated modernization

⸻

Suggested Default Standards for New PHP Repositories

Baseline

* PHP 8.3+
* Strict types enabled everywhere
* PHPStan max level
* Pint or PHP-CS-Fixer
* Pest or PHPUnit
* Dockerized dev environment
* PostgreSQL
* Redis
* Structured logging
* CI/CD from day one

⸻

Suggested AI Coding Rules for PHP

Architectural Rules

* Domain logic must not depend on framework code
* Controllers stay thin
* No business logic in routes
* Prefer immutable DTOs/value objects
* Prefer constructor injection
* Avoid static state
* Avoid hidden magic
* Prefer explicit return types
* Keep services focused and composable

⸻

Code Quality Rules

* Strict types required
* PHPStan must pass at max level
* No unused public methods
* Avoid giant arrays as data contracts
* Avoid generic “Manager” classes
* Prefer descriptive naming
* Prefer composition over inheritance

⸻

Testing Rules

* New features require tests
* Integration tests for critical workflows
* Avoid excessive mocking
* Test behavior over implementation

⸻

Things Old PHP Codebases Commonly Get Wrong

Warning Signs

* Global state everywhere
* Massive helper files
* Hidden framework magic
* Business logic in controllers
* ActiveRecord abuse
* Mixed HTML/PHP spaghetti
* No static analysis
* No types
* Array-driven architecture
* Singleton-heavy code
* God services
* Fat inheritance trees

These systems become difficult to evolve safely.

⸻

Practical Modern PHP Mindset

Modern PHP is at its best when treated similarly to:

* C#
* Kotlin
* Java
* TypeScript backend systems

Meaning:

* Typed
* Structured
* Explicit
* Layered
* Testable
* Observable
* Automated

Not:

Random PHP files executing hidden side effects.

⸻

Final Recommendation

If you return to PHP today:

Do NOT learn “old PHP.”

Learn:

* PHP 8.3+
* Typed architecture
* Static analysis
* PSR standards
* Modern framework practices
* Modular architecture
* Queue-driven workflows
* Proper testing
* Infrastructure automation

Modern PHP is genuinely productive when approached with strong engineering discipline.
