# PHP Architecture

## Core Rules

- Default to a **modular monolith** with domain-driven boundaries
- Separate **Domain**, **Application**, **Infrastructure**, and **Presentation** layers
- Domain layer never imports framework code
- Use **constructor injection** for all dependencies — no service locators, no global helpers, no static singletons
- Keep controllers and handlers thin

## Project Structure

### Standard (DDD-flavored)

```
src/
  Domain/         ← business rules, entities, value objects, domain services
  Application/    ← use case orchestration (commands, queries, handlers)
  Infrastructure/ ← database, cache, external APIs, framework adapters
  Presentation/   ← controllers, HTTP, validation, serialization
config/
bootstrap/
public/
storage/
tests/
```

### Lightweight (smaller projects)

```
src/
  Core/
  Services/
  Repositories/
  Http/
  Support/
```

Prefer clear boundaries over deep nesting. If you find yourself creating `src/Everything/Managers/Helpers/Utilities/Common/Shared/`, the architecture has become unclear.

## Layer Responsibilities

### Domain

Contains the business model. Pure PHP. No framework imports.

- Entities (`Order`, `Invoice`, `Subscription`)
- Value objects (`Money`, `EmailAddress`)
- Domain services (logic that doesn't naturally fit on an entity)
- Domain events (`InvoicePaid`, `SubscriptionCancelled`)

Must NOT depend on:
- Frameworks (Laravel, Symfony)
- HTTP
- Databases
- Redis
- Queues
- External APIs

### Application

Coordinates use cases. Thin orchestration.

- Commands (`CreateInvoice`, `RefundOrder`) — write operations
- Queries (`GetActiveSubscribers`) — read operations
- Handlers (one per command/query)
- Transactional boundaries

The Application layer calls domain services and infrastructure adapters. It doesn't contain business logic itself.

### Infrastructure

Framework-aware glue.

- Database access (Eloquent, Doctrine, raw PDO)
- Cache (Redis adapters)
- External API clients
- Queue adapters
- Email sender implementations
- Framework integration (service providers, container bindings)

### Presentation

The edge.

- Controllers (HTTP entry points)
- Form requests / request DTOs
- Response serialization
- API resource transformers

Keep controllers thin:

```php
final class CreateInvoiceController
{
    public function __construct(
        private readonly CreateInvoiceHandler $handler,
    ) {}

    public function __invoke(CreateInvoiceRequest $request): JsonResponse
    {
        $invoice = $this->handler->handle(CreateInvoiceCommand::fromRequest($request));
        return new JsonResponse(InvoiceResource::from($invoice), 201);
    }
}
```

## Dependency Injection

### Constructor Injection (Preferred)

```php
final class OrderService
{
    public function __construct(
        private readonly PaymentGateway $payments,
        private readonly OrderRepository $orders,
        private readonly EventDispatcher $events,
    ) {}
}
```

### Avoid

- `app()`, `resolve()`, `Container::get()` inside business code (service locator)
- Facades inside domain or application layers
- `static` factory methods that reach into the container
- Global helpers (`auth()`, `request()`, `now()`) in domain/application code

Constructor injection makes dependencies explicit, testable, and substitutable.

## Value Objects

Wrap primitives that have rules or constraints:

```php
final readonly class EmailAddress
{
    public function __construct(public string $value)
    {
        if (!filter_var($value, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException("Invalid email: $value");
        }
    }

    public function __toString(): string
    {
        return $this->value;
    }
}
```

The value object guarantees its invariants — once you hold one, you know it's valid.

## DTOs

For boundaries — HTTP requests, queue jobs, service-to-service calls:

```php
final readonly class CreateUserDTO
{
    public function __construct(
        public string $name,
        public EmailAddress $email,
    ) {}
}
```

DTOs are simple data carriers. They don't have business behavior. Methods are limited to construction (`fromRequest`, `fromArray`) and serialization (`toArray`).

## Repositories

Repositories are useful **only** when they encode domain meaning. Generic CRUD wrappers are not useful.

```php
// BAD — generic CRUD, mirrors ORM
interface UserRepository
{
    public function find(int $id): ?User;
    public function save(User $user): void;
    public function delete(User $user): void;
}

// GOOD — domain-shaped queries
interface UserRepository
{
    public function findActiveSubscribers(): UserCollection;
    public function findByEmail(EmailAddress $email): ?User;
    public function countNewThisMonth(): int;
}
```

If a repository's methods read like an ORM, don't bother — use the ORM directly.

## Async Processing

Use queues for:
- Email and notifications
- Webhook dispatch
- Image / video / file processing
- AI jobs (inference, embedding pipelines)
- Reports
- Any long-running operation

Common queue backends: Redis, RabbitMQ, SQS. Laravel Horizon provides excellent queue observability.

Avoid synchronous HTTP chains for work that doesn't need to be inline.

## Modular Monolith First

A well-structured modular monolith outperforms poorly-managed microservices in almost every case.

- Start as a single deployable
- Enforce module boundaries internally
- Extract a service only when there's a clear scaling or team-ownership reason

See [`../architecture/refactoring.md`](../architecture/refactoring.md) — extraction is a refactor, not a fresh build.

## DO NOT

- Put business logic in routes or controllers
- Make the domain layer depend on a framework
- Reach for CQRS, event sourcing, or microservices because they "sound advanced"
- Build deep inheritance chains (`BaseController → ApiController → VersionedController → UserController`)
- Use traits to share business behavior — use composition

## PRIORITY

```
Layered boundaries > Framework convenience
Constructor injection > Service locator / globals
Domain-shaped repositories > Generic CRUD wrappers
Modular monolith > Premature microservices
```

## See Also

- [`rules.md`](rules.md) — strict typing for the layered code
- [`anti-patterns.md`](anti-patterns.md) — what breaks layered architecture
- [`frameworks.md`](frameworks.md) — framework-specific guidance
- [`../architecture/refactoring.md`](../architecture/refactoring.md) — extracting modules
