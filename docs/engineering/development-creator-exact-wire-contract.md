# #169 — Development creator exact wire contract, no over-wide session credentials

## Why this boundary exists

The existing Development-only `DevMatchCreated` DTO, declared in
`src/backend/applications/Edonism.Api/Development/DevelopmentMatchStore.cs`, is precisely

```text
{ matchId: GUID, state: public MatchSnapshot, credentials: [{ playerId, token }, ...] }
```

It has exactly three *top-level* fields, and each `DevSeatCredential` has exactly two fields. The 64-character hex bearers are sent to the local Development fixture creator **only**; Production multiplayer auth/persistence remain blocked by #13.

`DevelopmentMatchLab.createDemo()` receives JSON from `POST /api/dev/matches/from-full-deck` and stores the **whole creator response** in an in-memory React session (`setSession(created)`), including the creator's multiple seat credentials. Previous #114 runtime validation checked GUID, players, audit envelope, credential uniqueness and token shape, but permitted unknown extra JSON keys on the top-level object and individual credential objects. A forged HTTP 201 could therefore place extra private or token metadata in session memory despite the genuine server sending no such fields. This is a *client-side defense-in-depth against a forged transport payload* and is **not** an allegation of a server secret leak.

## Acceptance and compatibility

- Reject the entire creator reply if its set of own top-level keys is not exactly `matchId|state|credentials`, or if any individual credential contains anything besides `playerId|token`. Never silently strip extra keys or store the original forged response. Examples rejected: `remainingDrawPile`, `privateHands`, `token`, `privateDeal`, `otherPlayerCards`, `secret`, unknown metadata.
- Retain the existing narrow, independently validated **public** state envelope and chronology. Do **not** impose an arbitrary exact-key list inside `state`: publicly documented snapshot fields can evolve independently; the source server/audit remains authoritative.
- Retain all 2–8 unique technically valid owners, exact ordinal identity matching, original public order, uppercase/lowercase hex token acceptance with case-insensitive token-uniqueness, canonical printable Unicode player IDs, and wire-compatible **permuted credential order**.
- No new server API, persistent storage, login, game action, salary, combat, private hand access or election mechanic.

## Validation

- Extend the existing Playwright file `src/frontend/e2e/verified-development-creator-response.spec.ts`, importing the *real Vite* guard for 2/4/8 seats. Assert valid and reversed credential order, Unicode actor, existing negative bearer/roster cases, forged extra fields on top-level and first/last credentials, missing required keys and immutability of caller data.
- Add xUnit WAF `DevelopmentCreatorExactWireContractTests`: real Development `POST /api/dev/matches/from-full-deck` for 2/4/8 seats, exactly 3 top-level and 2 credential keys, 64 hex bearers unique by case-insensitive equality, public match ID binding, no-store, no accidental draw-pile/private-hand/typed election marker metadata. Production continues to return 404.
- The full GitHub Actions `.NET 10/xUnit`, `React/Playwright` and `Live React+.NET/Playwright` must all be `completed/success` on the **exact final `main` SHA** before closure. Record CI evidence on #169 and the ledger. Parent #6/#13 remain open.

Issue [#169](https://github.com/KeyserDSoze/Game.Edonism/issues/169); related trust checks [#114](https://github.com/KeyserDSoze/Game.Edonism/issues/114) and [#166](https://github.com/KeyserDSoze/Game.Edonism/issues/166).
