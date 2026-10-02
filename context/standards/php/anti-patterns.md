# PHP Anti-Patterns

## God Arrays

```php
// BAD — array as data contract; no type safety, no IDE help
function processUser(array $user): void
{
    $email = $user['email'];        // typo risk, missing key risk
    $name = $user['profile']['name']; // deep array access
}

// GOOD — DTO or value object
function processUser(User $user): void
{
    $email = $user->email;
    $name = $user->profile->name;
}
```

## Static Singleton State

```php
// BAD — hidden global state, untestable
class Settings
{
    private static array $values = [];

    public static function get(string $key): mixed
    {
        return self::$values[$key] ?? null;
    }
}

Settings::get('feature_flag.x');

// GOOD — injected dependency
final class SettingsService
{
    public function __construct(private readonly SettingsRepository $repo) {}

    public function get(string $key): mixed
    {
        return $this->repo->find($key);
    }
}
```

## Service Locator / Facade Abuse in Business Code

```php
// BAD — hidden dependencies, harder to test, magic
class OrderService
{
    public function process(Order $order): void
    {
        $payment = app(PaymentGateway::class);
        $logger = resolve(Logger::class);
        DB::transaction(function () use ($order) { /* ... */ });
        Cache::forget("order:{$order->id}");
    }
}

// GOOD — constructor injection
final class OrderService
{
    public function __construct(
        private readonly PaymentGateway $payments,
        private readonly LoggerInterface $logger,
        private readonly TransactionManager $transactions,
        private readonly CacheInterface $cache,
    ) {}
}
```

## Generic "Manager" / "Helper" Classes

```php
// BAD — vague name, accumulates unrelated methods
class UserManager
{
    public function get(int $id) { /* ... */ }
    public function update(User $user) { /* ... */ }
    public function sendWelcomeEmail(User $user) { /* ... */ }
    public function exportToCsv(array $users) { /* ... */ }
    // ...
}

// GOOD — focused services named by responsibility
final class FindUserById { /* ... */ }
final class UpdateUserProfile { /* ... */ }
final class SendWelcomeEmail { /* ... */ }
final class ExportUsersToCsv { /* ... */ }
```

## Fat Controllers / Fat Models

```php
// BAD — business logic in the controller
class InvoiceController
{
    public function store(Request $request)
    {
        $data = $request->validate([/* ... */]);
        $invoice = new Invoice($data);
        $tax = $invoice->amount * 0.20;
        $invoice->total = $invoice->amount + $tax;
        $invoice->save();
        Mail::to($invoice->customer->email)->send(new InvoiceCreatedMail($invoice));
        Log::info("invoice.created", ['id' => $invoice->id]);
        return response()->json($invoice);
    }
}

// GOOD — controller delegates to an application handler
final class CreateInvoiceController
{
    public function __construct(private readonly CreateInvoiceHandler $handler) {}

    public function __invoke(CreateInvoiceRequest $request): JsonResponse
    {
        $invoice = $this->handler->handle(CreateInvoiceCommand::fromRequest($request));
        return new JsonResponse(InvoiceResource::from($invoice), 201);
    }
}
```

## Trait Pyramids

```php
// BAD — traits stacking hidden behavior
class UserService
{
    use HasCaching;
    use HasLogging;
    use HasEvents;
    use HasValidation;
    use HasNotifications;
    use HasRetries;
    // What does this class actually do? Where does behavior come from?
}

// GOOD — composition
final class UserService
{
    public function __construct(
        private readonly Cache $cache,
        private readonly LoggerInterface $logger,
        private readonly EventDispatcher $events,
    ) {}
}
```

Use traits only for genuinely cross-cutting *implementation details* — not for sharing business behavior.

## Deep Inheritance

```php
// BAD — design smell
abstract class BaseController { /* ... */ }
abstract class ApiController extends BaseController { /* ... */ }
abstract class VersionedController extends ApiController { /* ... */ }
class UserController extends VersionedController { /* ... */ }

// GOOD — composition, often via middleware or invoke handlers
final class UserController
{
    public function __construct(
        private readonly ApiResponseFactory $responses,
        private readonly UserFinder $users,
    ) {}
}
```

## Exceptions for Control Flow

```php
// BAD — exception as a return value
public function findUserByEmail(string $email): User
{
    $user = $this->db->find($email);
    if (!$user) {
        throw new NotFoundException();
    }
    return $user;
}

// In caller:
try {
    $user = $service->findUserByEmail($email);
} catch (NotFoundException) {
    return null; // expected case, not exceptional
}

// GOOD — nullable return for expected absence
public function findUserByEmail(string $email): ?User
{
    return $this->db->find($email);
}
```

Reserve exceptions for genuinely exceptional situations: infrastructure failure, invariant violation, security breach.

## Mixed HTML/PHP

```php
<!-- BAD — PHP and HTML interleaved in business logic -->
<?php
$users = DB::query("SELECT * FROM users");
foreach ($users as $u) {
    if ($u->active) {
        echo "<div>" . htmlspecialchars($u->name) . "</div>";
    }
}
?>
```

Use a template engine (Blade, Twig) for HTML. Keep PHP business logic in classes. Better yet, render the frontend in a SPA or HTMX layer.

## Ignoring Static Analysis

```php
// BAD — silently passing untyped data; PHPStan would catch this
function calculate($data)
{
    return $data['amount'] * $data['tax_rate'];
}

// GOOD — typed and PHPStan-verifiable
function calculate(InvoiceData $data): Money
{
    return $data->amount->multiply($data->taxRate);
}
```

Without PHPStan at high levels, "modern PHP" is incomplete. See [`tooling.md`](tooling.md).

## Generic CRUD Repositories

See [`architecture.md`](architecture.md) for the full pattern. Short version:

```php
// BAD
$user = $userRepository->find($id);
$userRepository->save($user);

// Just use the ORM directly for this:
$user = User::find($id);
$user->save();

// Build a repository only when it expresses domain meaning:
$subscribers = $userRepository->findActiveSubscribers();
```

## See Also

- [`rules.md`](rules.md) — the positive patterns
- [`architecture.md`](architecture.md) — layers, DI, value objects
- [`tooling.md`](tooling.md) — PHPStan to catch many of these automatically
