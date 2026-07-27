# Org-scoped authentication, authorization & distributed rate limiting

> SPIKE design document for [issue #22](https://github.com/OBP-ORG/orbitpay-backend/issues/22).
> This document describes the tenancy model, authorization approach, and
> distributed rate-limiting design for the OrbitPay API.

## 1. Tenancy model

### 1.1 Organization as the tenant boundary

The `Organization` model (in Prisma) is the unit of tenancy. Every data entity
(`Stream`, `VestingSchedule`, `Proposal`, `TreasuryEvent`) carries an optional
`organizationId` foreign key, scoping it to exactly one org.

```
Organization ──┬── Stream(s)
               ├── VestingSchedule(s)
               ├── Proposal(s)
               └── TreasuryEvent(s)
```

### 1.2 Principal → org mapping

Three actor roles exist within an org:

| Role | Source of truth | Scope |
|---|---|---|
| **Org admin** | `Organization.admin` (Stellar wallet address) | Full control over org resources, signer management, policy changes |
| **Member** | Stream sender/recipient or VestingSchedule grantor/beneficiary within the org | Read access and write access to resources they participate in |
| **External** | Not associated with the org | No access |

### 1.3 Authentication flow

The existing auth flow (issue #16) is retained:

```
1. POST /auth/nonce   { walletAddress }
   ← { nonce, message, expiresInSeconds }

2. POST /auth/verify  { walletAddress, signature }
   ← { token }                // JWT with sub: walletAddress

3. All subsequent requests:
   Authorization: Bearer <token>
```

**No changes** to the JWT or nonce flow. The JWT payload is intentionally lean
(`{ sub, iat, exp }`) — role lookups happen at the middleware layer against
the database, keeping the token small and avoiding stale claims.

## 2. Authorization approach

### 2.1 Layered guard model

We use **per-route middleware guards** rather than a policy-as-code layer. This
keeps authorization logic explicit at the route level and composes cleanly with
Express error handling.

```
Request
  │
  ▼
requireAuth        ←  JWT verification (already implemented)
  │
  ▼
requireOrgAdmin | requireOrgMember
                     ←  Org role check (already implemented)
  │
  ▼
Route handler
```

### 2.2 Middleware chain

| Middleware | Purpose | Status |
|---|---|---|
| `requireAuth` | Validates JWT, sets `req.walletAddress` | Implemented, unused |
| `requireOrgAdmin` | Checks `req.walletAddress === org.admin` | Implemented, unused |
| `requireOrgMember` | Checks admin or stream/vesting association | Implemented, unused |

### 2.3 Route application plan

All data routes (`/api/vesting`, `/api/proposals`, `/api/streams`, `/api/treasury`)
are currently public-read. The migration plan:

1. **Phase 1** — Apply `requireAuth` + `requireOrgMember` to all GET routes.
   Org-scoped query filters are added at the Prisma layer (see §4).

2. **Phase 2** — Apply `requireOrgAdmin` to write endpoints
   (`POST/PUT/DELETE`).

3. **Phase 3** — Remove public fallback; all routes require authentication.

### 2.4 Org-scoped query filters

Data isolation is enforced at the query layer. Every route that accepts
`orgId` filters by it:

```typescript
// Before (current — returns all orgs' data)
prisma.stream.findMany({ where: { ... } })

// After (org-scoped)
prisma.stream.findMany({ where: { organizationId: orgId, ... } })
```

The `organizationId` is never inferred from the JWT — it is an explicit path
parameter (`/api/vesting/:orgId/...`). This keeps the API RESTful and avoids
confusion when admin users manage multiple orgs.

### 2.5 Error handling

| Condition | Status | Response |
|---|---|---|
| No/invalid JWT | 401 | `{ error: "Unauthorized" }` |
| Valid JWT, not org member | 403 | `{ error: "Forbidden", message: "Cross-org access denied" }` |
| Org not found | 404 | `{ error: "Not Found" }` |

### 2.6 Why not a policy layer?

A policy-as-code layer (e.g., OPA, Casbin) adds:
- A new evaluation engine and DSL to learn
- Serialization overhead for every request
- Latency for policy compilation

For OrbitPay's current scale (handful of roles, simple hierarchical scoping),
Express middleware is sufficient and more transparent. If the role model grows
to include fine-grained resource-level permissions (e.g., "read-only on streams,
full access on vesting"), a policy layer can be introduced behind the same
middleware interface.

## 3. Distributed rate limiting

### 3.1 Current state

The existing `rateLimitMiddleware` (`src/middleware/rateLimit.ts`) uses an
**in-memory `Map<string, RateLimitEntry>`** keyed by client IP. This has two
limitations:

1. **Not shared across instances** — each process has its own counter. A
   user rotating across N instances gets N × `maxRequests` capacity.

2. **Lost on restart** — in-memory state disappears on process crash or
   deploy, resetting all counters and violation histories.

### 3.2 Design: Redis-backed token bucket with in-memory fallback

We extend the existing middleware to use **Redis** as the shared state layer
while falling back to in-memory when Redis is unavailable.

#### Key schema

```
orbitpay:ratelimit:{key}:count      →  integer (current request count)
orbitpay:ratelimit:{key}:window     →  timestamp (window start)
orbitpay:ratelimit:{key}:violations →  integer (backoff violations)
```

`{key}` is a configurable discriminator — by default the client IP, but
extensible to `walletAddress` for authenticated endpoints.

#### Algorithm

```
1. Compute key (ip | walletAddress)
2. If Redis is available:
   a. MULTI/EXEC block to fetch or initialize window atomically
   b. INCR count; if first in window, set window start + TTL
   c. If count > maxRequests, record violation, compute backoff, return 429
3. If Redis is unavailable:
   a. Fall back to in-memory map (current behavior)
4. Exponential backoff:
   backoffMs = backoffBaseMs × 2^(violations - 1)
```

#### Redis Lua script (atomic)

```lua
local key = KEYS[1]
local maxReq = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local window = redis.call('GET', key .. ':window')
if not window or (now - tonumber(window)) >= windowMs then
  redis.call('SET', key .. ':window', now, 'PX', windowMs)
  redis.call('SET', key .. ':count', 1, 'PX', windowMs)
  return {1, 0}
end

local count = redis.call('INCR', key .. ':count')
redis.call('PEXPIRE', key .. ':count', windowMs)

if count > maxReq then
  local violations = redis.call('INCR', key .. ':violations')
  redis.call('PEXPIRE', key .. ':violations', windowMs * 10)
  local backoff = ARGV[4] * (2 ^ (violations - 1))
  return {count, backoff}
end

return {count, 0}
```

### 3.3 Key strategies

| Strategy | Key | Use case |
|---|---|---|
| Per-IP | `client_ip` | Unauthenticated endpoints (`/auth/*`, `/health`) |
| Per-wallet | `walletAddress` | Authenticated endpoints — user cannot bypass by rotating IPs |
| Per-org (future) | `orgId` | Prevent one org's heavy usage from starving another |

### 3.4 Hybrid fallback

```typescript
const redis = await tryGetRedisClient();
if (redis?.isOpen) {
  return await redisRateLimit(redis, key, config);
}
return inMemoryRateLimit(key, config);  // current path
```

Redis connectivity is checked per-request; a transient Redis outage degrades to
in-memory without rejecting traffic.

### 3.5 Config additions

```typescript
// Added to src/config.ts
rateLimit: {
  maxRequests: number,      // existing
  windowMs: number,         // existing
  backoffBaseMs: number,    // existing
  strategy: 'ip' | 'wallet', // new — default 'ip'
  useRedis: boolean,         // new — default true
}
```

### 3.6 Abuse/DoS considerations

| Threat | Mitigation |
|---|---|
| IP rotation to bypass per-IP limit | Per-wallet key for authenticated routes ties limit to identity |
| Redis exhaustion from key spam | Per-key TTL equal to window + key namespacing prevents unbounded growth |
| Backoff reset via crash | Violations persisted in Redis across restarts; in-memory fallback resets on crash (acceptable for unauthenticated) |
| Coordinated low-and-slow | Per-wallet tracking + anomaly detection from metrics (future) |

## 4. Data isolation

### 4.1 Query layer

Every Prisma query that returns org-scoped data MUST include an
`organizationId` filter. The `requireOrgMember` middleware guarantees
`req.walletAddress` is authenticated, and the route handler receives
`req.params.orgId` plus `req.organization` (the verified org record).

```typescript
// Pattern for all routes
router.get('/api/vesting/:orgId/schedules',
  requireAuth,
  requireOrgMember,
  async (req, res) => {
    const schedules = await prisma.vestingSchedule.findMany({
      where: { organizationId: req.params.orgId },
    });
    res.json(schedules);
  },
);
```

### 4.2 Cross-org leak prevention

- `req.organization` is set by the middleware after verifying membership —
  never by the route from user-supplied params alone.
- Audit logs include `orgId + walletAddress` for every 403, making
  enumeration attempts visible.
- No wildcard or admin-bypass routes expose data across org boundaries.

### 4.3 Future: column-level encryption

For sensitive fields (beneficiary identity, memo text), column-level
encryption with per-org keys can be added at the Prisma middleware layer
without changing route handlers.

## 5. Migration / rollout plan

### Phase 1 — Foundation (this SPIKE + issue #15)

- [x] `Organization` model and `organizationId` FKs on entities
- [x] `requireAuth`, `requireOrgAdmin`, `requireOrgMember` middleware
- [ ] **Apply `requireAuth` + `requireOrgMember` to GET routes**
- [ ] **Add org-scoped Prisma filters to all route queries**
- [ ] **Redis-backed rate limiting middleware**
- [ ] Config for rate-limit strategy and Redis toggle

### Phase 2 — Write protection

- [ ] Apply `requireOrgAdmin` to POST/PUT/DELETE endpoints
- [ ] Add `walletAddress` key strategy for authenticated rate limiting

### Phase 3 — Enforcement & observability

- [ ] Remove public-read fallback
- [ ] Rate-limit metrics (Prometheus counters per key strategy)
- [ ] Automated cross-org access audit

### Rollback

Each phase can be rolled back independently:
- Remove middleware from route (`requireAuth` / `requireOrgMember`)
- Toggle `rateLimit.useRedis = false` to revert to in-memory
- Remove `organizationId` filter from queries
