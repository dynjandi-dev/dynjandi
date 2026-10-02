# PHP Frameworks

## Decision Matrix

| Project type | Recommended framework |
|---|---|
| Product team, API, internal tool, startup | **Laravel** |
| Large enterprise, long-lived platform, complex domain | **Symfony** |
| Lightweight API, custom architecture, minimal system | **Slim** |
| No framework needed | Plain PHP with chosen PSR components |

Pick one and stick with it. Don't mix frameworks in the same service.

## Laravel

Best for: product teams, rapid development, startups, internal systems, APIs.

### Strengths

- Excellent developer experience
- Mature ecosystem (Cashier, Horizon, Nova, Telescope, Sanctum)
- Strong tooling for queues, auth, testing
- Eloquent for fast development

### Risks

- Facade overuse leads to hidden coupling
- Magic-heavy patterns hurt long-term maintainability
- Fat models and fat controllers are common anti-patterns
- Easy to skip layered architecture and regret it later

### Laravel-Specific Patterns

#### DO

- **Form Requests** for validation — keep validation out of controllers
- **Service classes / Application handlers** for business logic — keep controllers thin
- **Jobs, Events, Listeners** for async work and decoupling
- **Policies** for authorization
- **API Resources** for response serialization
- **Scoped bindings** to avoid duplicated singletons
- **Eager loading** (`with()`) to prevent N+1 queries
- **Form requests + DTOs together** — Form Request validates, then maps to a DTO that the handler consumes

#### DO NOT

- Put business logic in routes (`Route::post('/...', fn () => /* logic */)`)
- Put business logic in controllers
- Put business logic in Eloquent models (keep them as data + relationships)
- Build massive `AppServiceProvider`s — split into focused providers
- Define magic macros for core business logic — use explicit classes
- Use global helpers (`auth()`, `request()`, `now()`) inside domain/application code — inject instead

### Example: Thin Controller + Handler + DTO

```php
// app/Http/Requests/CreateInvoiceRequest.php
final class CreateInvoiceRequest extends FormRequest
{
    public function rules(): array
    {
        return [
            'customer_id' => ['required', 'uuid'],
            'amount' => ['required', 'integer', 'min:1'],
            'currency' => ['required', 'in:USD,EUR,GBP'],
        ];
    }

    public function toDto(): CreateInvoiceDto
    {
        return new CreateInvoiceDto(
            customerId: $this->validated('customer_id'),
            amount: new Money($this->validated('amount'), $this->validated('currency')),
        );
    }
}

// app/Application/Invoices/CreateInvoiceHandler.php
final readonly class CreateInvoiceHandler
{
    public function __construct(
        private InvoiceRepository $invoices,
        private EventDispatcher $events,
    ) {}

    public function handle(CreateInvoiceDto $dto): Invoice
    {
        $invoice = Invoice::create($dto);
        $this->events->dispatch(new InvoiceCreated($invoice));
        return $invoice;
    }
}

// app/Http/Controllers/CreateInvoiceController.php
final class CreateInvoiceController
{
    public function __construct(private CreateInvoiceHandler $handler) {}

    public function __invoke(CreateInvoiceRequest $request): JsonResponse
    {
        $invoice = $this->handler->handle($request->toDto());
        return new JsonResponse(InvoiceResource::from($invoice), 201);
    }
}
```

### Recommended Companions

- **Pest** — testing
- **Larastan** (`nunomaduro/larastan`) — PHPStan for Laravel
- **Pint** — formatting
- **Horizon** — queue dashboard
- **Telescope** — local debugging
- **Sanctum** — API tokens / SPA auth

## Symfony

Best for: large enterprise systems, long-lived platforms, highly structured teams, complex domains.

### Strengths

- Explicit, predictable architecture
- Powerful DI container with autowiring
- Stable, mature, conservative release cadence
- Reusable components (HttpFoundation, Console, Messenger) work outside the full framework
- Strong typing throughout

### Trade-offs

- Steeper learning curve
- More ceremony than Laravel
- Slower initial development velocity

### Symfony Patterns

- **Controllers** are services; inject dependencies via constructor
- **Form component** for HTML forms; **Validator component** for any validation
- **Messenger** for commands, queries, async messages
- **API Platform** for fast typed REST/GraphQL APIs
- **Doctrine** for the ORM (more explicit than Eloquent, better for complex domains)

### Recommended Companions

- **Pest** or **PHPUnit**
- **PHPStan** with `phpstan/phpstan-symfony`
- **PHP-CS-Fixer** with Symfony preset
- **API Platform** for typed APIs

## Slim

Best for: lightweight APIs, custom architectures, embedded services, projects that need maximum control with minimum framework opinions.

### Strengths

- Tiny, PSR-7/PSR-15 native
- You assemble the pieces (DI container, ORM, validation) yourself
- Zero magic

### Trade-offs

- You build everything beyond routing
- Less ecosystem support than Laravel/Symfony

### When to Pick Slim Over Plain PHP

If you need routing + middleware and want PSR conformance without committing to a full framework.

## No Framework

For very small services (a single endpoint, a CLI tool), plain PHP with carefully chosen libraries is fine:

- Routing: `nikic/fast-route`
- HTTP: `guzzlehttp/psr7`, `laminas/laminas-diactoros`
- DI: `php-di/php-di`
- Validation: `symfony/validator` or `respect/validation`
- ORM: `doctrine/dbal` (lightweight) or just PDO

## DO NOT

- Pick a framework based on tutorials you've seen recently — pick based on project shape and team experience
- Mix frameworks (Laravel + Symfony components fight each other's conventions)
- Build a custom mini-framework when Slim or Symfony covers the use case
- Skip a framework "because it's just a small project" and reimplement routing, DI, validation, and logging from scratch

## PRIORITY

```
Right framework for the project shape > Familiar framework
Thin controllers + handlers > Fat controllers
Symfony Messenger / Laravel Jobs > Inline synchronous processing
```

## See Also

- [`architecture.md`](architecture.md) — layered architecture works under any framework
- [`tooling.md`](tooling.md) — framework-specific tooling (Larastan, Symfony PHPStan)
- [`anti-patterns.md`](anti-patterns.md) — fat controllers, facade abuse
