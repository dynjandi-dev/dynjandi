# PHP Tooling

## Core Stack

| Tool | Purpose | Required? |
|---|---|---|
| **Composer** | Dependency management, PSR-4 autoloading | Yes |
| **PHPStan** | Static analysis | Yes — level max |
| **Pint** or **PHP-CS-Fixer** | Formatting | Yes |
| **Pest** or **PHPUnit** | Testing | Yes |
| **Rector** | Automated refactors, PHP/framework upgrades | Strongly recommended |
| **Docker** | Containerized dev environment | Strongly recommended |
| **Xdebug** | Step debugging | Optional but valuable |

## Composer

Never manually `include` files. Use Composer for all autoloading and dependencies.

```bash
composer install         # install from composer.lock
composer require <pkg>   # add a runtime dependency
composer require --dev <pkg>  # dev-only
composer update          # update within composer.json constraints
```

PSR-4 autoload mapping:

```json
{
  "autoload": {
    "psr-4": {
      "App\\": "src/"
    }
  },
  "autoload-dev": {
    "psr-4": {
      "Tests\\": "tests/"
    }
  }
}
```

After changing autoload config, regenerate:

```bash
composer dump-autoload --optimize
```

Always commit `composer.lock`.

## PHPStan

Static analysis is **mandatory**. Modern PHP without it is incomplete.

```bash
composer require --dev phpstan/phpstan

# Run
vendor/bin/phpstan analyse
```

`phpstan.neon` baseline:

```yaml
parameters:
  level: max
  paths:
    - src
    - tests
  excludePaths:
    - vendor
```

Target **level max** (level 10 as of PHPStan 2). If you're adopting PHPStan into an existing codebase, generate a baseline to suppress existing errors and improve from there:

```bash
vendor/bin/phpstan analyse --generate-baseline
```

Then fix baseline entries over time.

### Useful PHPStan Extensions

- `phpstan/phpstan-strict-rules` — additional strictness
- `phpstan/phpstan-deprecation-rules` — flag deprecated API use
- Framework extensions: `nunomaduro/larastan` (Laravel), `phpstan/phpstan-symfony`
- `phpstan/phpstan-phpunit` or `pestphp/pest-plugin-phpstan` for test files

### Psalm Alternative

Psalm is an excellent alternative to PHPStan. Pick one; don't run both.

## Pint / PHP-CS-Fixer

Pick one formatter and let it own style entirely. Never argue about formatting in PRs.

**Pint** (Laravel-flavored, simpler config):

```bash
composer require --dev laravel/pint

vendor/bin/pint           # format
vendor/bin/pint --test    # check without writing (CI)
```

**PHP-CS-Fixer** (more configurable):

```bash
composer require --dev friendsofphp/php-cs-fixer

vendor/bin/php-cs-fixer fix
vendor/bin/php-cs-fixer fix --dry-run --diff  # CI
```

Both default to PSR-12.

## Testing — Pest or PHPUnit

See [`testing.md`](testing.md) for the testing philosophy. Setup:

**Pest:**

```bash
composer require --dev pestphp/pest pestphp/pest-plugin-laravel  # if Laravel
vendor/bin/pest --init

vendor/bin/pest
vendor/bin/pest --coverage
```

**PHPUnit:**

```bash
composer require --dev phpunit/phpunit

vendor/bin/phpunit
```

## Rector

Rector automates refactors — PHP version upgrades, framework upgrades, code modernization. Extremely valuable.

```bash
composer require --dev rector/rector

# Config in rector.php (sets paths, rules, php version target)
vendor/bin/rector process
vendor/bin/rector process --dry-run  # preview without writing
```

Common rule sets:
- `LevelSetList::UP_TO_PHP_83`
- `SetList::CODE_QUALITY`
- `SetList::DEAD_CODE`
- `SetList::TYPE_DECLARATION`

## Docker

Dockerize local dev. Avoid "works on my machine" setups.

Typical `docker-compose.yml` services:

```yaml
services:
  app:
    build: .
    volumes: ['.:/app']
  nginx:
    image: nginx:alpine
    ports: ['8080:80']
  db:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: dev
    ports: ['5432:5432']
  redis:
    image: redis:7-alpine
    ports: ['6379:6379']
```

For Laravel: **Sail** wraps this; **Herd** (macOS) gives a local PHP-FPM + DB stack without containers.

## CI Pipeline (Required Gates)

Every PHP repo should run on PR:

```yaml
# .github/workflows/ci.yml
name: CI
on: [pull_request, push]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: shivammathur/setup-php@v2
        with:
          php-version: '8.3'
          coverage: none
          tools: composer:v2
      - run: composer install --prefer-dist --no-progress
      - run: vendor/bin/pint --test
      - run: vendor/bin/phpstan analyse --no-progress
      - run: vendor/bin/pest --parallel
```

CI must fail on:
- Format violations
- PHPStan errors
- Test failures
- Security audit findings (`composer audit`)

See [`../tooling/ci.md`](../tooling/ci.md) for cross-language CI principles.

## Optional but Useful

- **Telescope** (Laravel) — local request/query/job inspector
- **Horizon** (Laravel) — queue dashboard
- **Symfony Profiler** — request profiling
- **Xdebug** — step debugging
- **PHP Insights** — code quality metrics
- **Deptrac** — enforce architectural boundaries

## DO NOT

- Skip PHPStan to "save time" — bugs cost more than analysis
- Run both Pint and PHP-CS-Fixer in the same project
- Edit `vendor/` files
- Commit `vendor/` to git
- Use globally-installed PHP/Composer in production — pin versions in Docker or Dockerfile

## PRIORITY

```
PHPStan level max > "It runs" as quality bar
Automated formatting > Manual style debates
Rector for upgrades > Manual sed across the codebase
```

## See Also

- [`rules.md`](rules.md) — the rules that PHPStan helps enforce
- [`testing.md`](testing.md) — Pest / PHPUnit setup
- [`frameworks.md`](frameworks.md) — framework-specific tooling additions
- [`../tooling/ci.md`](../tooling/ci.md) — cross-language CI principles
