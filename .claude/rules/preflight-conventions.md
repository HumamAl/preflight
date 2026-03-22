# Preflight Convention Detection Rules

These rules guide preflight agents in detecting project-specific conventions and
determining what constitutes a real finding versus acceptable code.

---

## 1. Project Detection Heuristics

Before analyzing any diff, preflight agents MUST fingerprint the project to
understand its stack, conventions, and error-handling norms. Use the checks
below in order; stop as soon as a category is resolved.

### Language and Runtime

| Signal File                | Conclusion                        |
|----------------------------|-----------------------------------|
| `package.json`             | Node.js / JavaScript / TypeScript |
| `tsconfig.json`            | TypeScript project                |
| `pyproject.toml`           | Python (modern)                   |
| `requirements.txt`         | Python (pip-based)                |
| `go.mod`                   | Go module                         |
| `Cargo.toml`               | Rust crate                        |
| `Gemfile`                  | Ruby / Rails                      |
| `pom.xml` / `build.gradle` | Java / Kotlin (JVM)              |
| `mix.exs`                  | Elixir                            |
| `composer.json`            | PHP                               |

### Framework Detection

Run these checks to narrow the framework before applying framework-specific
rules.

**Next.js**
- `next.config.js` or `next.config.mjs` or `next.config.ts` exists
- `package.json` lists `next` as a dependency
- Presence of `app/` directory indicates App Router; presence of `pages/`
  indicates Pages Router; both can coexist
- Check `next` version in package.json to determine API surface:
  - v12 and below: Pages Router only
  - v13+: App Router introduced, Server Components, `metadata` export
  - v14+: Server Actions stable, Partial Prerendering preview
  - v15+: Async request APIs (`cookies()`, `headers()` return Promises)
  - v16+: `proxy.ts` route convention, Cache Components (`"use cache"`
    directive), `connection()` API, async request APIs are the only API
    (sync variants removed), `forbidden()` / `unauthorized()` helpers,
    Composable Caching with `cacheLife()` and `cacheTag()`

**Vue.js / Nuxt**
- `package.json` lists `vue` as a dependency
- `nuxt.config.ts` or `nuxt.config.js` exists -> Nuxt project
- Check Vue version: v2 uses Options API by default; v3 uses Composition API
- Check for `<script setup>` in `.vue` files to confirm Composition API usage
- Nuxt auto-imports: `ref`, `computed`, `watch`, `useRoute`, `useRouter`,
  `useFetch`, `useAsyncData`, `useState`, `navigateTo`, `definePageMeta` are
  all available without explicit imports in Nuxt 3
- `server/api/` and `server/routes/` directories indicate Nitro server routes
- `composables/` directory contents are auto-imported
- `middleware/` directory holds route middleware (not Express middleware)

**SvelteKit**
- `svelte.config.js` or `svelte.config.ts` exists
- `package.json` lists `@sveltejs/kit` as a dependency
- `src/routes/` directory holds file-based routes
- `+page.svelte`, `+layout.svelte`, `+page.server.ts`, `+server.ts` are the
  file conventions
- Check Svelte version: v4 uses `export let` for props; v5 uses `$props()` rune
- Runes mode (`$state`, `$derived`, `$effect`) in Svelte 5+

**Express**
- `package.json` lists `express` as a dependency
- Entry point imports from `express` and calls `express()`
- Check Express version: v4 vs v5 have different API surfaces

**React (standalone, not Next.js)**
- `package.json` lists `react` and `react-dom` but NOT `next`
- Presence of `vite.config.*` or `webpack.config.*` or `craco.config.*`
- Check React version for hook availability and concurrent features

**Fastify**
- `package.json` lists `fastify`
- Entry point calls `fastify()` or `Fastify()`

**Django**
- `manage.py` at the project root -> Django project
- `settings.py` or a `settings/` package with `base.py`, `dev.py`, `prod.py`
- `urls.py` files define URL routing
- `apps.py` in subdirectories identifies Django apps
- Check for Django REST Framework: `rest_framework` in `INSTALLED_APPS` or
  `package.json` is irrelevant; look in `settings.py`
- `serializers.py` files indicate DRF serializer layer
- Check Django version: v4.0+ requires `async`-compatible middleware;
  v5.0+ uses `LoginRequiredMiddleware`, simplified `Field.db_default`

**Flask**
- Entry point imports `Flask` -> Flask
- `app = Flask(__name__)` is the conventional instantiation

**FastAPI**
- Entry point imports `FastAPI` -> FastAPI project
- `app = FastAPI()` is the conventional instantiation
- Look for `Depends()` usage to confirm dependency injection patterns
- `routers/` or `api/` directories with `APIRouter` instances
- Pydantic models in `schemas/` or `models/` directories (separate from
  ORM models)
- Check for `async def` vs `def` route handlers -- FastAPI supports both but
  they have different concurrency implications

### Package Manager Detection

| Lock File              | Manager    |
|------------------------|------------|
| `package-lock.json`    | npm        |
| `yarn.lock`            | yarn       |
| `pnpm-lock.yaml`      | pnpm       |
| `bun.lockb` / `bun.lock` | bun     |
| `poetry.lock`          | poetry     |
| `Pipfile.lock`         | pipenv     |
| `uv.lock`             | uv         |
| `Cargo.lock`           | cargo      |
| `go.sum`               | go modules |

### Monorepo Detection

Check for monorepo tooling before analyzing workspace structure. Monorepo
detection changes how you resolve imports, find conventions, and scope findings.

| Signal File               | Monorepo Tool     |
|---------------------------|-------------------|
| `turbo.json`              | Turborepo         |
| `nx.json`                 | Nx                |
| `lerna.json`              | Lerna             |
| `pnpm-workspace.yaml`    | pnpm workspaces   |
| `rush.json`               | Rush              |

Additional checks:
- `package.json` with `"workspaces"` field -> npm/yarn workspaces
- `packages/`, `apps/`, or `libs/` directories containing their own
  `package.json` -> workspace packages
- When in a monorepo, scope convention detection to the **specific package**
  being modified, not the root. A `packages/api` may use Express conventions
  while `packages/web` uses Next.js conventions.
- Cross-package imports should use the package name from `package.json`, not
  relative paths traversing above the package root (e.g.,
  `import { x } from "@myorg/shared"` not `import { x } from "../../shared"`).

### Docker / Container Detection

| Signal File               | Conclusion                        |
|---------------------------|-----------------------------------|
| `Dockerfile`              | Containerized application         |
| `docker-compose.yml` / `docker-compose.yaml` / `compose.yml` | Multi-container setup |
| `.dockerignore`           | Confirms Docker usage             |
| `devcontainer.json`       | VS Code dev container             |

Container-specific conventions:
- Environment variables should be read from `process.env` / `os.environ` /
  `os.Getenv` -- never hardcoded, especially in images
- Health check endpoints should exist if a `HEALTHCHECK` instruction is in the
  Dockerfile
- Multi-stage builds: code changes in later stages do not invalidate earlier
  cached stages. Verify `COPY` instructions still capture modified files.
- `.dockerignore` should exclude `node_modules`, `.git`, `*.env`, and build
  artifacts to prevent bloated images
- If `docker-compose.yml` defines `depends_on`, the application code should
  still handle the dependency being temporarily unavailable (depends_on does
  not wait for readiness, only for container start)

### Testing Library Detection

Detecting the correct testing library prevents false positives from flagging
valid test patterns as errors.

**JavaScript / TypeScript test runners:**

| Signal                                      | Runner       |
|---------------------------------------------|-------------|
| `jest.config.*` or `"jest"` in package.json | Jest        |
| `vitest.config.*` or `vitest` in deps       | Vitest      |
| `.mocharc.*` or `mocha` in deps             | Mocha       |
| `playwright.config.*`                       | Playwright  |
| `cypress.config.*` or `cypress/` dir        | Cypress     |

**Component testing libraries:**

| Signal                                         | Library                  |
|------------------------------------------------|--------------------------|
| `@testing-library/react` in deps              | React Testing Library    |
| `enzyme` or `enzyme-adapter-*` in deps        | Enzyme (legacy)          |
| `@testing-library/vue` in deps                | Vue Testing Library      |
| `@testing-library/svelte` in deps             | Svelte Testing Library   |
| `@vue/test-utils` in deps                     | Vue Test Utils           |

Conventions:
- React Testing Library uses `screen.getByRole`, `screen.getByText`,
  `userEvent.click` -- do NOT flag missing `getByTestId` if the project
  prefers accessible queries
- Enzyme uses `shallow()`, `mount()`, `wrapper.find()` -- these are valid
  patterns even though Enzyme is deprecated
- Vitest and Jest have nearly identical APIs (`describe`, `it`, `expect`), but
  Vitest uses `vi.fn()` / `vi.spyOn()` where Jest uses `jest.fn()` /
  `jest.spyOn()`. Mixing them is always a bug.
- If both Jest and Vitest configs exist, check which package directories use
  which runner; monorepos commonly mix them

**Python test frameworks:**

| Signal                          | Framework    |
|---------------------------------|-------------|
| `pytest.ini` or `conftest.py`  | pytest       |
| `unittest` imports             | unittest     |

**Go:**
- Files ending in `_test.go` use the standard `testing` package
- `testify` in `go.mod` indicates `assert` / `require` / `suite` helpers

### CSS / Styling Detection

**Tailwind CSS:**

| Signal                                         | Version    |
|------------------------------------------------|-----------|
| `tailwind.config.js` / `tailwind.config.ts`   | v3         |
| `@tailwindcss/` packages in deps, `@import "tailwindcss"` in CSS | v4 |
| `@config` directive in CSS                     | v4         |
| `theme()` function in CSS files                | v3 or v4   |

Tailwind v3 vs v4 differences:
- v3 uses `tailwind.config.js` with `theme.extend` object; v4 uses CSS-first
  configuration with `@theme` directive
- v3 uses `@tailwind base; @tailwind components; @tailwind utilities;`
  directives; v4 uses `@import "tailwindcss";`
- v3 uses `darkMode: 'class'` in config; v4 uses CSS custom properties and
  automatic dark mode via `@media (prefers-color-scheme: dark)`
- v4 uses CSS variables (`--color-blue-500`) instead of config objects for
  theme values; access via `var(--color-blue-500)` in CSS or `text-blue-500`
  in HTML
- v4 has automatic content detection (no `content` array needed in config)
- Check if project uses CSS variables approach (`--tw-*` variables in a
  globals file) or static config approach

**Other styling:**

| Signal                              | Approach          |
|-------------------------------------|-------------------|
| `*.module.css` / `*.module.scss`    | CSS Modules       |
| `styled-components` in deps        | Styled Components |
| `@emotion/react` in deps           | Emotion           |
| `*.css` with `@apply` directives   | Tailwind + CSS    |
| `sass` or `node-sass` in deps      | Sass/SCSS         |

---

## 2. Convention Inference Rules

Preflight agents must infer the project's own conventions from existing code
rather than imposing external standards. The following process applies.

### Error Handling Conventions

1. **Sample the codebase.** Run a count of try/catch blocks, `.catch()`
   handlers, error-first callbacks, `Result<>` returns, or `if err != nil`
   blocks in the `src/` (or equivalent) directory.
2. **Calculate the error-handling ratio.** Divide the number of error-handled
   operations by the total number of failable operations.
3. **Apply the convention threshold:**
   - If >= 80% of failable operations have error handling, the project
     convention is "always handle errors." Flag new code without error handling.
   - If 40-79%, the project convention is "selective error handling." Only flag
     missing error handling on I/O operations (network, filesystem, database).
   - If < 40%, the project does not have a strong error-handling convention.
     Only flag missing error handling on operations where a crash is certain
     (e.g., `JSON.parse` on untrusted input).

4. **Contextual error-handling heuristics.** Beyond the ratio, use these
   signals to determine whether missing error handling is a real problem:

   **Strong signals that error handling IS expected:**
   - The function writes to a database, filesystem, or external service
   - The function parses user input or network responses
   - The function is a request handler (route/controller/resolver)
   - The function is called at the boundary between trusted and untrusted data
   - Surrounding functions in the same module all handle errors
   - The project uses a typed error approach (Go `error` returns, Rust
     `Result`, TypeScript `Either`/discriminated unions)

   **Strong signals that error handling may be INTENTIONALLY absent:**
   - The function is a pure computation with no I/O
   - A global error boundary, middleware, or panic recovery exists upstream
   - The project uses an error-monitoring service (Sentry, Datadog, Bugsnag)
     with a global handler
   - The function is wrapped by a higher-order function that handles errors
     (e.g., `withErrorHandler(fn)`, `catchAsync(fn)`)
   - The function is in test code
   - The function calls `process.exit()` or equivalent on failure (CLI tools)

   **Language-specific error-handling norms:**
   - **Go:** Every function returning `error` must have its error checked by
     the caller. `_ = fn()` explicitly discards the error and is acceptable.
     Bare `fn()` without capturing the error return is always a bug.
   - **Rust:** `unwrap()` and `expect()` are acceptable in tests and CLI tools
     but are bugs in library code and server handlers. Check if the project
     uses `anyhow` (application code) vs `thiserror` (library code).
   - **Python:** Bare `except:` or `except Exception:` that silently passes is
     almost always a bug. `except SpecificError:` is fine.
   - **TypeScript:** Floating promises (promise returned but not awaited or
     `.catch()`-ed) are bugs. Check if eslint
     `@typescript-eslint/no-floating-promises` is enabled.

### Import Style Conventions

1. **Detect module system.** Check for `"type": "module"` in package.json, or
   presence of `.mjs`/`.cjs` extensions, or `tsconfig.json` module setting.
2. **Detect import style.** Sample 10 files: are they using ES modules
   (`import/export`) or CommonJS (`require/module.exports`)?
3. **Only flag import style mismatches if the project is > 90% consistent** in
   one direction.

### Naming Conventions

1. **File naming.** Sample existing files: kebab-case, camelCase, PascalCase,
   snake_case.
2. **Variable/function naming.** Sample existing source files for dominant
   convention.
3. **Do NOT flag naming issues.** These are style concerns, not bugs. Record
   the convention only so you understand the codebase context (e.g., a file
   named `authService.ts` likely exports a class, while `auth-service.ts`
   likely exports functions).

### Test Conventions

1. **Test location.** Check for `__tests__/` co-located dirs, top-level
   `test/` or `tests/` directory, or `.test.*`/`.spec.*` files next to source.
2. **Test runner.** Check `package.json` scripts or config files for jest,
   vitest, mocha, pytest, go test, etc. (see Testing Library Detection above
   for detailed signals).
3. **Assertion style.** Sample test files for `expect()`, `assert.*`,
   `should.*`, or built-in `testing.T`.
4. **Record but do not enforce** unless the test-gap-analyzer agent is active.

---

## 3. Framework-Specific Verification Rules

### Next.js App Router

- Server Components (files in `app/` without `"use client"`) MUST NOT use
  `useState`, `useEffect`, `useRef`, or any React hooks that require client
  state.
- Client Components (`"use client"` directive) MUST NOT use `async/await` at
  the component level -- they cannot be async functions.
- `cookies()`, `headers()`, and `draftMode()` return Promises in Next.js 15+.
  Check the installed version before flagging missing `await`.
- Route Handlers (`app/**/route.ts`) must export named HTTP method functions
  (`GET`, `POST`, etc.), not default exports.
- `metadata` and `generateMetadata` are only valid in `layout.tsx` and
  `page.tsx`, not in components.
- `useRouter` from `next/navigation` does NOT have `.query` -- use
  `useSearchParams()` instead.
- `usePathname()` returns the path without query string.
- Dynamic route params are passed as props to page components, not accessed via
  hooks.

**Next.js 16 specific rules:**
- `proxy.ts` in route directories defines API proxy rules. It exports a config
  object, not a function. Do not confuse with `route.ts`.
- Cache Components use the `"use cache"` directive. Files with `"use cache"`
  must not contain side effects, `useState`, or any client hooks. They are
  cached on the server.
- `cacheLife()` controls cache TTL and must be called inside a `"use cache"`
  boundary. Valid presets: `"seconds"`, `"minutes"`, `"hours"`, `"days"`,
  `"weeks"`, `"max"`, or a custom `{ stale, revalidate, expire }` object.
- `cacheTag()` is used inside `"use cache"` functions for on-demand
  revalidation via `revalidateTag()`.
- `connection()` from `next/server` signals that the response depends on the
  incoming request and opts out of static rendering. It replaces the old
  pattern of reading `headers()` just to force dynamic rendering.
- All request APIs (`cookies()`, `headers()`, `params`, `searchParams`) are
  async-only in v16 -- the synchronous versions from v14 no longer exist.
  Missing `await` is always a bug.
- `forbidden()` and `unauthorized()` throw special errors that render
  `forbidden.tsx` and `unauthorized.tsx` boundary files respectively.
- `unstable_cache` is removed; use `"use cache"` with `cacheLife()` instead.

### Next.js Pages Router

- `getServerSideProps`, `getStaticProps`, `getStaticPaths` are only valid in
  files under `pages/`.
- These functions must be exported as named exports, not default exports.
- `useRouter` from `next/router` (not `next/navigation`) provides `.query`.

### Vue.js (Composition API)

- `<script setup>` is the recommended syntax in Vue 3. It auto-exposes all
  top-level bindings to the template.
- `ref()` creates a reactive reference; access the value via `.value` in script
  but directly in template. Forgetting `.value` in script is always a bug.
  Using `.value` in template is always a bug.
- `reactive()` returns a reactive proxy. Destructuring a `reactive()` object
  breaks reactivity -- this is always a bug. Use `toRefs()` if destructuring
  is needed.
- `computed()` returns a read-only ref. Assigning to `computed().value` is
  always a bug unless it was created with a getter/setter pair.
- `watch()` and `watchEffect()` return a stop handle. Not calling it on
  component unmount causes memory leaks in non-SFC contexts.
- Props declared with `defineProps()` are read-only. Mutating a prop is always
  a bug.
- `defineEmits()` must declare all emitted events. Emitting an undeclared event
  is a bug in TypeScript mode.
- `defineModel()` (Vue 3.4+) replaces the `modelValue` prop + `update:modelValue`
  emit pattern.
- `provide()` / `inject()` -- if `inject()` is called without a default value
  and no ancestor provides the key, it returns `undefined` at runtime. In
  TypeScript, check if the type is marked as possibly undefined.

### Nuxt 3

- Nuxt auto-imports: `ref`, `computed`, `reactive`, `watch`, `watchEffect`,
  `useRoute`, `useRouter`, `useFetch`, `useAsyncData`, `useState`,
  `navigateTo`, `definePageMeta`, `useRuntimeConfig`, `useHead`,
  `useSeoMeta`, `useNuxtApp`, `createError`, `showError`, `clearError`. Do
  NOT flag these as "missing imports."
- `useFetch` and `useAsyncData` are SSR-aware and deduplicate requests. Using
  raw `fetch` or `axios` in a component `setup()` instead of these composables
  causes hydration mismatches -- flag this.
- Server routes live in `server/api/` (auto-prefixed with `/api/`) and
  `server/routes/` (no prefix). The handler exports `defineEventHandler()`.
- Server utilities in `server/utils/` are auto-imported in server routes.
- Middleware in `middleware/` runs on every navigation. Named middleware must be
  applied with `definePageMeta({ middleware: 'auth' })`.
- `useRuntimeConfig()` reads `runtimeConfig` from `nuxt.config.ts`. Public
  keys are under `runtimeConfig.public`; non-public keys are only available
  server-side. Accessing a non-public key in client code is always a bug.
- Pages in `pages/` are auto-registered as routes. Components in `components/`
  are auto-imported. Layouts in `layouts/` are applied via
  `definePageMeta({ layout: 'custom' })`.

### SvelteKit

- `+page.svelte` -- page component rendered on the route
- `+page.ts` / `+page.js` -- `load` function that runs on both server and
  client. Must return a plain object. Must NOT import server-only modules
  (database clients, secrets, file system).
- `+page.server.ts` / `+page.server.js` -- `load` function that runs ONLY on
  the server. CAN import server-only modules. Also exports `actions` object
  for form actions.
- `+server.ts` -- API endpoint, exports `GET`, `POST`, `PUT`, `PATCH`,
  `DELETE` functions.
- `+layout.ts` / `+layout.server.ts` -- layout-level load functions. Data
  cascades down to child routes.
- `+error.svelte` -- error boundary for the route segment.
- Form actions: `+page.server.ts` exports `actions = { default: ..., named: ... }`.
  Forms POST to the page route with `method="POST"`. The `use:enhance`
  directive enables progressive enhancement.
- `$app/environment` exports `browser` (boolean) and `building` (boolean).
  Using `browser` to guard client-only code is the correct pattern.
- Modules in `$lib/server/` are server-only. Importing them from a universal
  `load` function or from `+page.svelte` is always a build error.
- `error()`, `redirect()`, and `fail()` from `@sveltejs/kit` throw special
  objects. They must NOT be caught by try/catch in `load` functions or actions.
  Wrapping them in try/catch is always a bug.

**Svelte 5 (Runes):**
- `$state()` replaces `let x = value` for reactive declarations.
- `$derived()` replaces `$:` reactive statements.
- `$effect()` replaces `$:` side-effect statements and `onMount` in many cases.
- `$props()` replaces `export let` for component props.
- `$bindable()` marks a prop as bindable.
- Mixing Svelte 4 and Svelte 5 syntax in the same component is a bug.

### Express

- Middleware must call `next()` to pass control, or send a response. Failing
  to do either causes the request to hang.
- Error-handling middleware has the signature `(err, req, res, next)` -- all
  four parameters are required even if `next` is unused, because Express
  identifies error middleware by argument count.
- `res.json()`, `res.send()`, `res.end()` do not implicitly return. Code after
  these calls still executes. Use `return res.json(...)` if early exit is
  intended.
- Route parameters are strings. `req.params.id` from `/users/:id` is always
  a string, never a number.

### Django

- **Views:** Function-based views receive `(request)` and must return an
  `HttpResponse`. Class-based views extend `View`, `APIView`,
  `GenericAPIView`, etc. Forgetting to call `super()` in class-based view
  methods like `dispatch` is a bug.
- **URL patterns:** `path()` uses angle-bracket converters (`<int:pk>`);
  `re_path()` uses regex. Mixing them or using regex syntax in `path()` is a
  bug.
- **Models:**
  - `ForeignKey` requires `on_delete` argument (since Django 2.0). Missing it
    is always an error.
  - `unique_together` in `Meta` should use `UniqueConstraint` in Django 4.0+.
  - `default=[]` or `default={}` on a model field is a mutable default bug.
    Use `default=list` or `default=dict`.
  - `TextField` with `max_length` is misleading -- it is not enforced at the
    database level (use `CharField` if a max length is needed).
- **Serializers (DRF):**
  - `ModelSerializer` requires a `Meta` class with `model` and `fields`.
  - `fields = '__all__'` is a security risk if the model has sensitive fields.
    Flag it only if the serializer is used in a write endpoint.
  - `read_only_fields` in `Meta` is ignored for fields explicitly declared on
    the serializer class. This is a common source of bugs.
  - `validate_<field_name>` methods must return the validated value. Forgetting
    the return statement silently sets the field to `None`.
- **Middleware:** Django middleware in 2.0+ uses the `__init__` / `__call__`
  pattern (not the old `process_request`/`process_response` hooks). Using the
  old-style hooks in new middleware is a bug.
- **Async views (Django 4.1+):** `async def` views work natively but must not
  call synchronous ORM operations without `sync_to_async`. Doing so raises
  `SynchronousOnlyOperation` at runtime.
- **Signals:** `@receiver(post_save, sender=MyModel)` must import from
  `django.dispatch`. Signal handlers that raise exceptions break the save
  flow.

### FastAPI

- **Dependency injection:** `Depends()` resolves at request time. Dependencies
  can be `async def` or `def`. Mixing sync dependencies with async route
  handlers works but the sync dependency runs in a thread pool.
- **Pydantic models:**
  - Pydantic v1 uses `class Config`; Pydantic v2 uses `model_config =
    ConfigDict(...)`. Mixing them is a bug.
  - `Optional[X]` in Pydantic v2 means the field can be `None` but is still
    required unless `= None` is provided as a default. This catches many
    developers off guard.
  - `Field(alias="...")` requires `model_config = ConfigDict(populate_by_name=True)`
    for the original field name to also work.
- **Async vs sync routes:**
  - `async def` routes run on the main event loop. Calling blocking I/O
    (sync database drivers, `time.sleep`, `open()`) inside them blocks the
    entire server. This is always a critical bug.
  - `def` routes (non-async) automatically run in a thread pool, so blocking
    I/O is safe.
  - If the project uses SQLAlchemy, check whether it uses the async engine
    (`create_async_engine`) or the sync engine. Using the sync engine inside
    `async def` routes is a bug.
- **Response models:** `response_model=MyModel` on a route decorator controls
  serialization. Returning data that does not match the response model causes
  a 500 error at runtime, not a validation error for the client.
- **Path parameters:** `@app.get("/items/{item_id}")` requires `item_id` as a
  function parameter. Missing it causes a startup error. Type annotations on
  path parameters are enforced (e.g., `item_id: int` rejects non-integer
  paths).
- **Background tasks:** `BackgroundTasks` must be a function parameter, not
  instantiated manually. `background_tasks.add_task(fn, args)` queues work
  after the response is sent.

### React (General)

- Hook rules: hooks must not be called conditionally, inside loops, or inside
  nested functions. They must be called at the top level of the component or
  custom hook.
- `useEffect` cleanup functions run on unmount AND before re-running the
  effect. Ensure cleanup logic does not assume it only runs on unmount.
- `useState` setter functions are stable references -- they do not need to be
  in `useEffect` dependency arrays. But values from state DO need to be
  included.
- `useMemo` and `useCallback` dependency arrays must include ALL values
  referenced inside the callback. Missing dependencies cause stale closures.
- Event handlers in JSX receive a `SyntheticEvent`, not the raw DOM event.
  `event.target.value` works but `event.nativeEvent` is needed for certain
  properties.

### Go

- **Error handling:** Every function that returns `error` as part of its return
  values MUST have the error checked by the caller. The pattern is:
  ```
  val, err := someFunc()
  if err != nil {
      return fmt.Errorf("context: %w", err)
  }
  ```
  The following are bugs:
  - Ignoring the error return entirely: `val := someFunc()` when `someFunc`
    returns `(T, error)` -- this does not compile, but `someFunc()` called as
    a statement discards both returns silently.
  - Using `val` before checking `err` -- the value is undefined if `err != nil`.
  - Checking `err == nil` (inverted logic) and proceeding on error.
  - Wrapping errors without `%w` verb when the caller needs `errors.Is()` /
    `errors.As()` upstream.

- **Interface implementation:** Go interfaces are implemented implicitly. There
  is no compile-time check that a struct implements an interface UNLESS you
  add a compile-time assertion: `var _ MyInterface = (*MyStruct)(nil)`. If
  the project uses this pattern, new structs that claim to implement an
  interface should also have this assertion.

- **Goroutine safety:**
  - Shared mutable state accessed from multiple goroutines without a mutex or
    channel is always a race condition bug.
  - `go func()` closures that capture loop variables must either shadow the
    variable or pass it as a parameter. In Go 1.22+, loop variables are
    per-iteration, so this is only a bug in Go < 1.22.
  - `sync.WaitGroup.Add()` must be called BEFORE `go func()`, not inside it.
  - `defer` runs at function exit, not at block exit. `defer` inside a loop
    defers all calls to function return, potentially leaking resources.

- **Context:** Functions that perform I/O should accept `context.Context` as
  their first parameter. Passing `context.Background()` where a request
  context is available indicates a potential cancellation/timeout leak.

- **nil slices vs empty slices:** `var s []int` (nil) and `s := []int{}` (empty)
  behave identically for `len`, `cap`, `range`, and `append`, but they marshal
  to JSON differently (`null` vs `[]`). Flag this only in API response code.

### Rust

- **Result/Option handling:**
  - `unwrap()` on `Result` or `Option` panics on `Err`/`None`. Acceptable in
    tests, examples, and CLI `main()`. Always a bug in library code and
    server request handlers.
  - `expect("message")` is the same as `unwrap()` but with a custom panic
    message. Same rules apply.
  - Prefer `?` operator for propagating errors in functions that return
    `Result`. If a function uses `unwrap()` but its signature returns
    `Result`, it should use `?` instead.
  - `.unwrap_or_default()`, `.unwrap_or(value)`, `.unwrap_or_else(|| ...)`
    are safe alternatives. Do not flag these.
  - `if let Some(x) = val` and `match` are the idiomatic ways to handle
    `Option`. Do not flag these as "missing error handling."

- **Borrow checker patterns:**
  - Returning a reference to a local variable is always a compile error, but
    returning a reference to a field of `&self` is fine. If you see complex
    lifetime annotations, do not flag them unless they are clearly wrong.
  - Holding a `MutexGuard` across an `.await` point causes the guard to be
    held across a potential thread yield. This is a deadlock risk and should
    be flagged.
  - Using `clone()` to satisfy the borrow checker is acceptable if the data
    is small. Flag it only if cloning is inside a hot loop on a large data
    structure.

- **Unsafe blocks:**
  - `unsafe` blocks must have a `// SAFETY:` comment explaining the invariant
    that makes the unsafe code sound. Missing safety comments on new `unsafe`
    blocks should be flagged.
  - Raw pointer dereferences (`*ptr`) must be inside `unsafe`. If they are
    not, this is a compile error, not a preflight concern.
  - `unsafe impl Send for T` and `unsafe impl Sync for T` are extremely
    dangerous. Flag these unless the struct genuinely only contains types that
    are `Send`/`Sync` but the compiler cannot prove it.

- **Common Rust bugs:**
  - `Iterator::map()` is lazy. `v.iter().map(|x| side_effect(x))` without
    `.collect()` or `.for_each()` does nothing. This is always a bug.
  - `String` vs `&str`: functions that only read a string should accept
    `&str`, not `String`. Do not flag this (style concern), but DO flag
    `to_string()` called on a `&str` that is immediately passed to a
    function accepting `&str`.

---

## 4. When to Flag vs When to Accept

### Always Flag (Regardless of Project Convention)

- Imports of packages not in the dependency manifest or standard library
- Method calls on APIs that do not expose that method (verified against types)
- `bcrypt.compare(hash, plain)` -- arguments are always in the wrong order
- `JSON.parse()` on user/network input without try/catch
- `await` inside `.forEach()` -- never works as expected
- Missing `await` on a function whose return value is used as if resolved
- Type assertions that bypass runtime checks on untrusted data (API responses,
  user input)
- Accessing `.query` on `useRouter()` from `next/navigation`
- `ref()` value accessed without `.value` in Vue `<script>` (or with `.value`
  in Vue `<template>`)
- Destructuring a Vue `reactive()` object without `toRefs()`
- `error()` / `redirect()` / `fail()` from SvelteKit caught by a try/catch in
  a load function or action
- Importing from `$lib/server/` in a universal (non-server) SvelteKit module
- Go error return values that are not checked
- `unwrap()` on `Result`/`Option` in Rust library code or server handlers
- Calling blocking I/O inside a Python `async def` route handler (FastAPI)
- Django `ForeignKey` without `on_delete`
- Django mutable default (`default=[]` or `default={}`) on model fields
- Rust `unsafe` blocks without `// SAFETY:` comment
- Holding a Rust `MutexGuard` across an `.await` point
- `.map()` on a Rust iterator without consuming the result

### Flag Only If Project Convention Supports It

- Missing try/catch on database queries (check if the project wraps queries
  in a utility that handles errors)
- Missing `.catch()` on promise chains (check if there is a global unhandled
  rejection handler)
- Missing input validation (check if the project uses middleware like zod,
  joi, or express-validator at the router level)
- Missing null checks (check if the project uses strict TypeScript with
  `strictNullChecks` enabled -- if so, the type system handles this)

### Never Flag

- Code style, formatting, or naming preferences
- Missing comments or documentation (except `// SAFETY:` on Rust `unsafe`)
- "Could be more efficient" suggestions without a concrete bug
- Use of `any` type (this is a linting concern, not a runtime bug)
- Missing return type annotations
- Unused variables or imports (handled by linters)
- Preference for one library over another (e.g., axios vs fetch)
- Nuxt auto-imported functions used without explicit imports
- Use of `clone()` in Rust (style concern unless in a proven hot path)

---

## 5. Confidence Calibration

Confidence scores must reflect how certain you are that a finding is a real bug,
not how severe the bug would be if it existed.

| Confidence Range | Meaning                                              | Action       |
|------------------|------------------------------------------------------|--------------|
| 90-100           | Verified with tool evidence; will break at runtime   | Report       |
| 75-89            | Strong evidence from types or docs; very likely wrong | Report       |
| 60-74            | Probable issue; evidence is indirect or partial      | Report       |
| 40-59            | Suspicious but cannot confirm; might be intentional  | Do NOT report |
| 0-39             | Gut feeling; no hard evidence                        | Do NOT report |

The reporting threshold is 60. Findings below 60 confidence MUST be discarded.
This threshold exists because false positives are more damaging to developer
trust than missed bugs.
