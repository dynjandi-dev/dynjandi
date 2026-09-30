# PHP Rules

## DO

- `declare(strict_types=1);` at the top of every PHP file
- Type every parameter, return value, and property
- Use modern PHP 8.3+ features: constructor property promotion, readonly properties/classes, enums, match expressions, attributes, union/intersection types, first-class callable syntax
- Use value objects for domain concepts (Money, EmailAddress, UserId) — not raw strings/ints
- Use DTOs for API/queue payloads — readonly classes, no setters
- Follow PSR-12 formatting (auto-enforced by Pint or PHP-CS-Fixer)
- Follow PSR-4 autoloading via Composer
- Use PSR-3 (`LoggerInterface`) for logging — not custom logger classes
- Name things by responsibility (`CalculateInvoiceTotals`) — not by role (`InvoiceManager`)

## DO NOT

- Use untyped parameters or return values
- Pass `array` as a data contract — use DTOs or value objects
- Use generic class names: `Manager`, `Helper`, `Util`, `Common`, `Base`, `Handler` (unless it's actually a PSR-15 handler)
- Use deep inheritance chains — prefer composition
- Use traits for hidden cross-cutting behavior — prefer composition
- Use global state, service locators, static singletons, or facade abuse
- Reach for magic methods (`__call`, `__get`) when explicit code works
- Mix HTML and PHP in the same file (use Blade, Twig, or a frontend)

## Strict Types

```php
<?php declare(strict_types=1);

namespace App\Billing;

final class OrderService
{
    public function calculateTotal(Order $order): Money
    {
        // ...
    }
}
```

Without `strict_types`, PHP silently coerces types — `int(5)` becomes `string("5")`, `string("abc")` becomes `int(0)`. Strict types make these errors loud at the call site.

## Type Everything

```php
// BAD — implicit any
public function process($order)
{
    return $order->total;
}

// GOOD — explicit input and output types
public function process(Order $order): Money
{
    return $order->total;
}
```

For collections, use PHPStan/Psalm generics annotations since PHP doesn't have native generics:

```php
/**
 * @param list<Order> $orders
 * @return list<Money>
 */
public function extractTotals(array $orders): array
{
    return array_map(fn (Order $o) => $o->total, $orders);
}
```

## Modern Features in Action

### Constructor Property Promotion

```php
// GOOD — concise, no boilerplate
final class OrderService
{
    public function __construct(
        private readonly PaymentGateway $payments,
        private readonly OrderRepository $orders,
    ) {}
}

// BAD — manual property declaration and assignment
final class OrderService
{
    private PaymentGateway $payments;
    private OrderRepository $orders;

    public function __construct(PaymentGateway $payments, OrderRepository $orders)
    {
        $this->payments = $payments;
        $this->orders = $orders;
    }
}
```

### Readonly Classes (PHP 8.2+)

```php
final readonly class Money
{
    public function __construct(
        public int $amount,
        public string $currency,
    ) {}
}
```

All properties are immutable after construction. Add a method that returns a new instance for "mutations":

```php
public function add(Money $other): Money
{
    return new Money($this->amount + $other->amount, $this->currency);
}
```

### Enums

```php
enum InvoiceStatus: string
{
    case Draft = 'draft';
    case Open = 'open';
    case Paid = 'paid';
    case Void = 'void';
}

// Pattern match
$label = match ($invoice->status) {
    InvoiceStatus::Draft => 'Draft',
    InvoiceStatus::Open => 'Awaiting payment',
    InvoiceStatus::Paid => 'Paid',
    InvoiceStatus::Void => 'Voided',
};
```

### Value Objects Over Primitives

```php
// BAD — primitive obsession; what's $email's shape? validated?
public function createUser(string $email, string $name): User

// GOOD — types enforce the contract
public function createUser(EmailAddress $email, FullName $name): User
```

Common value objects to introduce early:
- `EmailAddress`, `PhoneNumber`, `Url`
- `Money`, `Currency`, `Percentage`
- `UserId`, `OrderId`, `InvoiceId` (typed IDs prevent passing the wrong one)
- `DateRange`, `TimeOfDay`

## DTOs

For API requests, queue payloads, and service-to-service messages:

```php
final readonly class CreateUserDTO
{
    public function __construct(
        public string $name,
        public EmailAddress $email,
    ) {}

    public static function fromRequest(Request $request): self
    {
        return new self(
            name: $request->validated('name'),
            email: new EmailAddress($request->validated('email')),
        );
    }
}
```

## Naming

| Pattern | Convention | Example |
|---|---|---|
| Classes | `PascalCase` | `OrderService`, `EmailAddress` |
| Methods | `camelCase` | `calculateTotal`, `findActiveSubscribers` |
| Properties | `camelCase` | `$totalAmount` |
| Constants | `SCREAMING_SNAKE_CASE` | `MAX_RETRIES` |
| Interfaces | `PascalCase`, no `I` prefix | `PaymentGateway` not `IPaymentGateway` |
| Namespaces | match folder structure (PSR-4) | `App\Billing\OrderService` in `src/Billing/OrderService.php` |

## PRIORITY

```
Strict types > Loose types
Value objects > Primitive obsession
DTOs > Arrays as contracts
Composition > Inheritance
Explicit > Magic
```

## See Also

- [`anti-patterns.md`](anti-patterns.md) — what to avoid
- [`architecture.md`](architecture.md) — where typed code lives
- [`tooling.md`](tooling.md) — PHPStan, Pint, Rector
