# Development rotated credential collision guard (#115)

## Scope and threat

The Development-only local match lab can keep one joined-seat capability or
2–8 creator-issued seat capabilities. #114 rejects duplicate/malformed tokens
**at match creation**. Before #115, `rotateSeatToken()` validated only that the
HTTP response carried the requested player ID, a 64-character hexadecimal
bearer different from the actor's *previous* bearer, and the expected match.
A malformed/forged successful-looking rotation response could still return
**another locally held seat's bearer**, silently replacing Bob's local
capability with Alice's and making their identities appear interchangeable.

## Fail-closed ingress

`hasValidDevelopmentRotatedCredential(response, actorId, previousToken,
heldCredentials)` is pure and checks the response **before** React mutates any
actor scope, local credential, historical selection, ETag, private hand or
success indicator.

- A well-typed response seat ID exactly matches the current actor.
- Both old and replacement bearers have exactly 64 hexadecimal characters.
- Replacement must differ from the old bearer **case-insensitively** and
  from every other currently held local bearer.
- The complete local 1–8-seat set has unique, nonblank IDs, valid unique
  64-hex tokens, exactly one actor record, and that record matches the old
  bearer. Null records, duplicate/malformed local credentials and wrong-seat
  state all fail closed, instead of trusting TypeScript casts.
- The React caller additionally confirms that the match and current
  actor/token scope have not changed during the async HTTP response.
- Failure keeps the previously held credentials and private UI scopes
  untouched and displays the existing localized rotation error **without**
  showing the success notice. No bearer is written to storage or logs.

This is a **Development fixture integrity check**, not a replacement for the
.NET server's bearer authorization and atomic digest rotation (#28), nor
Production login/revocation/persistence (#13). A real remote server might
already have revoked the old bearer before a malformed successful response
is rejected; the browser cannot undo server rotation. In that case, a
subsequent authenticated request will reconcile the revoked capability.
A mock regression can retry only because its deliberately forged first
response does **not** rotate/revoke the server-side mock token.

## Regression coverage

`src/frontend/e2e/verified-development-rotated-credential.spec.ts`
imports the **actual Vite-loaded TypeScript** guard in Playwright: 2/4/8
successful cases, uppercase and single-seat join, malformed response,
incorrect actor/previous-token, same bearer, duplicate other-seat bearer
with mixed casing, duplicate local IDs/tokens and invalid containers.
The helper remains immutable for test fixture input.

`src/frontend/e2e/development-match.spec.ts` adds a full mocked browser
regression where Bob receives Alice's bearer (uppercase) in a fabricated
HTTP 200. No false rotation success is shown; Alice and Bob retain their
independent hands and actor scopes. A second, genuine rotation is accepted,
the private hand reloads using the new credential, public revision stays
unchanged, and tokens remain absent from DOM, URL and Web Storage.
Existing mocked rotation, mobile/IT-EN, real .NET two-client Playwright and
665+ .NET xUnit tests remain mandatory. **Do not close #115 before all
three jobs pass on the final exact `main` SHA.**

[Issue #115](https://github.com/KeyserDSoze/Game.Edonism/issues/115)
