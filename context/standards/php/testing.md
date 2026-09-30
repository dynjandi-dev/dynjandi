# PHP Testing

## Tooling

- **Pest** — preferred for new projects; expressive syntax, great DX
- **PHPUnit** — established standard; use for legacy or teams already on it

Both can coexist in the same project. New tests should follow whichever the codebase uses.

## Test Pyramid

Every modern PHP project should have:

- **Unit tests** — pure logic, value objects, domain services
- **Integration tests** — application handlers with real database, queue, cache (in containers)
- **End-to-end tests** — critical user flows via HTTP

Avoid excessive mocking. Integration tests with real (containerized) dependencies catch bugs that mock-heavy unit tests miss.

## Test Behavior, Not Implementation

```php
// BAD — asserts on method calls (couples test to implementation)
$user->expects()->method('setStatus')->with('active');

// GOOD — asserts on observable behavior
expect($user->status())->toBe(UserStatus::Active);
// or PHPUnit:
$this->assertEquals(UserStatus::Active, $user->status());
```

When the implementation changes but the behavior doesn't, the test should still pass.

## Pest Example

```php
<?php declare(strict_types=1);

use App\Domain\Order;
use App\Domain\Money;

it('calculates the total with tax', function () {
    $order = new Order(amount: new Money(100, 'USD'));

    $total = $order->totalWithTax(taxRate: 0.20);

    expect($total)->toEqual(new Money(120, 'USD'));
});

it('rejects negative amounts', function () {
    expect(fn () => new Money(-1, 'USD'))
        ->toThrow(InvalidArgumentException::class);
});
```

## PHPUnit Example

```php
<?php declare(strict_types=1);

namespace Tests\Domain;

use App\Domain\Order;
use App\Domain\Money;
use PHPUnit\Framework\TestCase;

final class OrderTest extends TestCase
{
    public function test_calculates_total_with_tax(): void
    {
        $order = new Order(amount: new Money(100, 'USD'));

        $total = $order->totalWithTax(taxRate: 0.20);

        $this->assertEquals(new Money(120, 'USD'), $total);
    }
}
```

## Integration Tests

For integration tests, use real (containerized) dependencies — not mocks:

```php
it('creates an invoice and emits an event', function () {
    $handler = $this->app->make(CreateInvoiceHandler::class);

    $invoice = $handler->handle(new CreateInvoiceCommand(
        customerId: $this->testCustomer->id,
        amount: new Money(500, 'USD'),
    ));

    // Asserts against the real database
    expect(Invoice::find($invoice->id))->not->toBeNull();

    // Asserts the event was dispatched
    Event::assertDispatched(InvoiceCreated::class);
});
```

## Test Factories

Use factories (Laravel) or fixtures (Symfony) for test data — never hand-construct entities row by row:

```php
$user = User::factory()->create(['status' => UserStatus::Active]);
$invoices = Invoice::factory()->count(5)->for($user)->create();
```

## Coverage Expectations

- Domain layer: aim for high coverage (it's pure logic)
- Application handlers: integration tests covering happy and error paths
- Infrastructure adapters: minimal — test the adapter contract, not the third-party library
- Presentation: tested via HTTP-level integration tests, not controller unit tests

Coverage percentage is a weak proxy. Prefer "every critical flow has at least one integration test" over "85% coverage."

## DO NOT

- Mock things you own — refactor the design instead
- Use `partialMock`, `Mockery::spy`, or method-call assertions for normal logic
- Write tests that depend on order
- Share mutable state between tests
- Skip writing tests because "it's just a small change"

## PRIORITY

```
Integration tests with real dependencies > Mock-heavy unit tests
Behavior assertions > Method-call assertions
Critical-flow coverage > Coverage percentage
```

## See Also

- [`rules.md`](rules.md) — typed, testable code by construction
- [`tooling.md`](tooling.md) — Pest, PHPUnit, CI integration
- [`../react/testing.md`](../react/testing.md) — same philosophy for the frontend
