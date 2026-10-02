# PHP Security

PHP-specific security non-negotiables. For cross-language concerns (secrets, auth, API security), see also [`../security/`](../security/).

## Passwords

```php
// Hashing — use password_hash with Argon2id (preferred) or bcrypt
$hash = password_hash($plaintext, PASSWORD_ARGON2ID);

// Verification — timing-safe
if (password_verify($plaintext, $user->password_hash)) {
    // ...
}

// Rehash if algorithm or cost has been upgraded
if (password_needs_rehash($user->password_hash, PASSWORD_ARGON2ID)) {
    $user->password_hash = password_hash($plaintext, PASSWORD_ARGON2ID);
    $user->save();
}
```

Never store plaintext passwords. Never use MD5, SHA-1, or unsalted hashes.

## SQL Injection Prevention

Always use prepared statements. Never concatenate user input into SQL.

```php
// SAFE — parameterized via PDO
$stmt = $pdo->prepare("SELECT * FROM users WHERE email = :email");
$stmt->execute(['email' => $email]);

// SAFE — Eloquent / Doctrine parameterize automatically
$user = User::where('email', $email)->first();

// DANGEROUS — string concatenation
$users = $pdo->query("SELECT * FROM users WHERE email = '$email'");

// SAFE — raw queries WITH bindings if you must
$users = DB::select("SELECT * FROM users WHERE email = ?", [$email]);
```

## XSS Prevention

Escape all output rendered to HTML. Templating engines do this by default:

```php
// Blade — auto-escapes
{{ $user->name }}

// Twig — auto-escapes
{{ user.name }}

// Manual — escape with htmlspecialchars
<?= htmlspecialchars($user->name, ENT_QUOTES, 'UTF-8') ?>

// DANGEROUS — raw output
{!! $user->name !!}        // Blade unescaped
{{ user.name|raw }}        // Twig unescaped
<?= $user->name ?>          // manual unescaped
```

Use `{!!` or `|raw` only for trusted content you control (e.g., rendered markdown that you sanitized yourself).

## CSRF Protection

Web forms must include and validate CSRF tokens.

- **Laravel** — the `web` middleware group includes `VerifyCsrfToken`; templates use `@csrf`
- **Symfony** — the form component includes CSRF protection by default
- **Slim / custom** — use a CSRF middleware (`slim/csrf` or similar)

APIs that use session cookies need CSRF protection too. APIs using bearer tokens generally don't (the cross-origin protection comes from CORS + the token header).

## File Upload Validation

```php
final class UploadInvoicePdfController
{
    public function __invoke(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'file' => [
                'required',
                'file',
                'mimes:pdf',
                'max:5120',         // 5MB
            ],
        ]);

        $path = $validated['file']->store('invoices');
        // ...
    }
}
```

Validate:
- File size (reject huge uploads early)
- MIME type (verify the actual content, not just the extension or `Content-Type` header)
- File extension (whitelist, not blacklist)
- Image dimensions (for images, to prevent decompression attacks)

Store uploads outside the web root or behind an authenticated handler.

## Path Traversal Prevention

```php
// BAD — user input flows directly into a file path
$filename = $_GET['file'];
return readfile("/uploads/$filename");
// Attacker: ?file=../../../etc/passwd

// GOOD — validate against an allow-list or sanitize
$allowed = ['report.pdf', 'invoice.pdf'];
if (!in_array($filename, $allowed, true)) {
    abort(404);
}
return readfile("/uploads/$filename");

// GOOD — use realpath and verify it stays inside the allowed directory
$base = realpath('/uploads');
$path = realpath("/uploads/$filename");
if ($path === false || !str_starts_with($path, $base)) {
    abort(404);
}
```

## Rate Limiting

Apply rate limits to all public APIs and especially to auth endpoints.

- **Laravel** — `throttle` middleware: `Route::middleware('throttle:60,1')->...`
- **Symfony** — `RateLimiter` component

```php
Route::post('/login', LoginController::class)
    ->middleware('throttle:5,15');  // 5 attempts per 15 minutes
```

## Secrets

Never commit secrets. Always load from environment:

```php
// Read at config layer once, not throughout the app
return [
    'stripe' => [
        'secret' => env('STRIPE_SECRET_KEY'),
    ],
];

// Access via config()
$stripeKey = config('services.stripe.secret');
```

For environment variable validation at startup, see [`../security/secrets.md`](../security/secrets.md).

## Session Security

- Use `HttpOnly`, `Secure`, `SameSite=Lax` (or `Strict`) cookies
- Regenerate session ID on login (`session_regenerate_id(true)` in raw PHP; framework handles it usually)
- Set a session timeout
- Invalidate the session on logout

## DO NOT

- Build SQL strings manually
- Trust `$_GET` / `$_POST` / `$_REQUEST` / `$_FILES` without validation
- Use `eval()` or `unserialize()` on user input
- Store sensitive data in `$_SESSION` without encryption if the session driver writes to disk
- Log passwords, tokens, or credit card data
- Use `Content-Type` header alone to determine file type
- Roll your own crypto or auth — use a battle-tested library

## PRIORITY

```
Parameterized queries > String SQL
Argon2id > bcrypt > anything else
Validated, allow-listed inputs > Defensive sanitization
HttpOnly cookies > localStorage for auth
```

## See Also

- [`../security/secrets.md`](../security/secrets.md) — env vars, rotation, scanning
- [`../security/auth.md`](../security/auth.md) — auth patterns (cross-language)
- [`../security/api-security.md`](../security/api-security.md) — CORS, error responses, rate limiting
- [`rules.md`](rules.md) — strict types prevent many injection paths at compile time
