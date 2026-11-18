# #173 — Exact rotated Development bearer credential wire shape

## Scope and source

The .NET Development API `POST /api/dev/matches/{id}/rotate-token` returns a **single** `DevSeatCredential(string PlayerId, string Token)`, serialized as exactly `{ "playerId": "...", "token": "..." }`. The response is `no-store`, and the server revokes the previous bearer under the match lock before replying. Server authentication, 64-character hexadecimal bearers, case-insensitive token uniqueness, and immutable public game state already exist.

The React `hasValidDevelopmentRotatedCredential` guard (#115) checks that the new bearer belongs to the current actor, differs from the prior bearer and any other held actor capability, and that all 1–8 held credentials are consistent. However, it did not reject unknown properties on the raw HTTP 200. A forged network response containing an extra `otherPlayerTokens`, `privateHand`, `remainingDrawPile`, `secret`, `futureActions`, or even `metadata:null` could pass despite this not matching the .NET DTO. The React code **only copies** the validated `playerId` and `token` into the held in-memory credential, so this was **not** proven leakage or persistence of extra fields, nor a server authorization bypass. This fix strengthens exact DTO ingress before a capability transition.

## Contract and safeguards

- `hasValidDevelopmentRotatedCredential` requires precisely two own enumerable JSON keys: `playerId` and `token`. Insertion order is immaterial; any unexpected or missing key rejects the entire reply. Do not strip fields and bind the remaining data.
- Preserve existing actor equality, 64 hexadecimal bearer shape, case-insensitive collision detection against every held credential and previous bearer, 1–8 local credentials (including single-seat join), and technically valid Unicode actor IDs from the canonical public roster.
- The frontend neither stores extra raw response fields nor persists bearer credentials in URL, DOM or browser storage; bearer scope is per in-memory actor. An invalid rotation acknowledgement does not update this scope or revoke a valid local session. A subsequent genuine server response may succeed, but in real-world ambiguous ACK cases a fresh server-authenticated join may be necessary because the remote store already invalidated the old bearer.
- No new Production login, long-lived credentials, storage, account, gameplay move, skip-turn, tax, action card or multiplayer policy.

## Testing

- The actual browser-imported Vite source in `src/frontend/e2e/verified-development-rotated-credential.spec.ts` tests 2/4/8 known seats, canonical printable Unicode IDs, valid uppercase/lowercase hexadecimal and response key order, unknown properties (including false/null), missing keys, actor/token collisions, invalid containers and input immutability.
- The real React UI is tested in `src/frontend/e2e/development-match.spec.ts`: a syntactically valid forged 200 with a new 64-hex bearer and extra private card field fails **before** rebinding the local actor, preserving the old valid mock bearer. A subsequent proper rotation returns only the two expected keys, rebinds the correct seat and stays secret in the DOM/storage.
- `DevelopmentRotatedCredentialExactWireContractTests` uses real Development WebApplicationFactory HTTP for 2/4/8 actors: exact two-property response, no-store, fresh distinct 64-hex bearer, old bearer and hand rejected, other actor unaffected, public match revision/audit identical; Production 404.
- Track implementation in issue [#173](https://github.com/KeyserDSoze/Game.Edonism/issues/173), parent [#6](https://github.com/KeyserDSoze/Game.Edonism/issues/6) and [#13](https://github.com/KeyserDSoze/Game.Edonism/issues/13). Close only once **all three** GitHub Actions jobs (.NET/xUnit, actual Vite React/Playwright, Live React+.NET/Playwright) have completed/success on the **exact final main SHA**.
