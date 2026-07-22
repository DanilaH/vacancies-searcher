# Research: `rabota.sber.ru`

Date: 2026-07-22

## Real active vacancy URL

```
https://rabota.sber.ru/vacancy/customer-journey-expert/
```

## URL patterns checked

| Pattern | HTTP status | Notes |
|---|---|---|
| `/vacancy/{kebab-slug}/` | 200 | Valid slug — active vacancy page |
| `/vacancy/{kebab-slug}` | 308 → `/vacancy/{kebab-slug}/` | Trailing slash enforced |
| `/vacancy/{numeric-id}/` | 404 | No numeric ID routing |
| `/vacancies` | 308 → `/vacancies/` | Listing page redirect |
| `/vacancies/` | 200 (SPA shell) | No server-rendered vacancy list |
| `/search/{slug}-{id}/` | 404 | Stale Google index only |
| `/this-slug-definitely-does-not-exist/` | 404 | Unknown slug → 404 |
| `/sitemap.xml` | 404 | No sitemap |

## HTTP statuses for existing vs missing

- **Active** (`/vacancy/{valid-slug}/`): returned HTTP 200 from the executor's probe environment on 2026-07-22, with `page: "/[directory]/[alias]"` in `__NEXT_DATA__` and SEO meta tags in `pageProps.data.head`.
- **Missing** (`/vacancy/{invalid-slug}/`): returned HTTP 404 in the same environment, with `page: "/404"`, `pageProps: {}`, and `og:title: "Работа в Сбере"`.
- **Independent availability check**: another public fetch environment returned HTTP 403 for the active URL. Access can therefore vary by region, CDN edge, or anti-bot policy. The URL must not be treated as guaranteed to return 200 from every runtime; this instability is an additional reason not to add a production adapter.

## Exact allowed URL shape

```
https://rabota.sber.ru/vacancy/{kebab-case-slug}/
```

- Host: `rabota.sber.ru` only (subdomains not supported).
- Path: `/vacancy/{slug}/` — trailing slash required (server enforces 308 redirect without it).
- Slug: kebab-case word sequence (Cyrillic or Latin), e.g. `customer-journey-expert`, `specialist-po-pryamym-prodazham`.
- No numeric IDs — `/vacancy/1/` returns 404.

## JSON-LD

**None.** Zero `JobPosting` or `Product` schema nodes in any response.

## SEO meta tags (only server-rendered content)

The `__NEXT_DATA__` JSON contains a `data.head` HTML string with:

- `<title>` — vacancy title (e.g. `Customer Journey Expert (CJE)`)
- `og:title` — same as title
- `og:description` — generic recruitment pitch, not vacancy-specific
- `og:image` — generic banner image
- `og:url` — points to `hr.sberbank.ru/landing/...` (different domain, TLS cert error)

No vacancy body, requirements, salary, responsibilities, or location are present.

## Next.js data endpoint

```
GET /_next/data/{buildId}/vacancy/{slug}.json
```

Response: `{ pageProps: { data: { head: "..." } }, __N_SSG: true }`.

Same SEO-only content as the HTML page. No structured vacancy fields.

## Missing server-rendered vacancy body

The site is a Next.js SPA. The actual vacancy content is fetched client-side from a private API. The server-rendered response contains:

- SEO meta tags (title, description, image)
- CSS/JS bundles
- React hydration data (`__NEXT_DATA__`)

No `<article>`, `<main>`, or other content containers with vacancy text.

## Why `og:title` / `og:description` are insufficient

- `og:title` alone (~50 chars) provides a job title but no way to confirm the page is about an actual vacancy (could be any content page).
- `og:description` is a generic HR pitch reused across vacancies, not vacancy-specific text.
- `hasConfidentVacancyContent()` requires ≥180 chars of description + strong sections (requirements, responsibilities, salary) — neither exists server-side.
- Without a server-rendered body, the confidence check cannot pass.

## Why private client-side API is not used

- The API is not public, undocumented, and may require cookies/session tokens.
- Using it would create an unstable dependency on internal implementation details.
- It would bypass the trusted-service security model (HTTP-only fetch of public HTML).
- It cannot be verified by simple HTTP requests in tests.

## Verdict

**Research-only.** No production adapter is added for `rabota.sber.ru`.

There is no reliable parser signal in the server-rendered HTML (no JSON-LD, no vacancy body, only SEO meta tags). The private client-side API is not a viable integration target. The domain is documented for future reference in case the site adds structured data or SSR content.
