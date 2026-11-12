# Auth-first bodyless Development mutations (#82)

The Development `POST /api/dev/matches/{matchId}/rotate-token` and `POST /api/dev/matches/{matchId}/presence` operations do not accept request DTOs. They now enforce **zero payload bytes** before invoking either operation, without changing the existing frontend (both calls already send no body).

A path-specific pre-routing middleware first authenticates the bearer under `DevelopmentMatchStore.HasSeatAccess`. Missing, forged and revoked tokens receive the same generic 404 as before, regardless of payload or Content-Type. Once authorized, any positive Content-Length is rejected without reading the body, and a missing Content-Length is checked by reading **at most one byte**. Zero-byte known/unknown-length requests proceed to the normal endpoint, which reauthenticates under the match lock. A body yields HTTP 413 with JSON code `dev_bodyless_payload_not_allowed`; the existing no-store privacy middleware covers every outcome.

The contract applies to these exact POST routes only. No playerId, private hand, presence status, audit, credential, body reflection or gameplay resource is returned on rejection. A rejected rotation does not revoke a token or allocate a successor; a rejected presence call does not register a heartbeat. Other creator and gameplay command JSON contracts stay unchanged.

The real HTTP xUnit tests cover both routes × known/unknown-length transports, 0/1/65536 bytes, missing/forged/revoked tokens, exact route matching, live successful commands after rejection and no public state changes. Full validation includes Playwright mocked UI and Playwright live with real .NET, all three green on final `main` HEAD.

[Issue #82](https://github.com/KeyserDSoze/Game.Edonism/issues/82).
