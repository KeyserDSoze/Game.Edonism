# Development public technical player ID ingress (#127)

## Risk
Authoritative .NET Development match creation and replay already enforce MatchParticipantId.IsValid (#57), rejecting control/format/bidi/invisible Unicode, isolated UTF-16 surrogates, edge ASCII spaces and >64 UTF-16 units. The browser's shared Development public envelope previously checked only a nonblank string and exact uniqueness. An otherwise coherent forged HTTP 200 could therefore bind an invisible or enormous player ID to the public roster, revision and ETag, despite never being server-authored.

## Browser compatibility policy
`isValidDevelopmentTechnicalPlayerId` is a small pure TypeScript transport-shape guard. It preserves the server's 64-UTF-16-code-unit limit; accepts printable Unicode, emoji and internal ASCII spaces; forbids empty or whitespace-only strings, leading/trailing ASCII spaces, isolated surrogate code units, Unicode Control (Cc), Format (Cf: bidi and zero width), Line/Paragraph Separator (Zl/Zp), and all whitespace scalars other than internal ordinary ASCII space. It neither trims, normalizes, changes case, authenticates the actor nor computes a gameplay action.

The existing public envelope invokes the helper for **every** 2–8-seat `playerId` before match session, revision, ETag, actor-bound options or join acceptance. The same roster is already used to check turn order and audit event actor membership (#120/#126). This is a defensive frontend check of a .NET authored contract, not a new account nickname policy or Production security feature. Unicode category data versions may differ between JS and .NET, so .NET remains authoritative; tests cover the named policy boundaries.

## Tests
- Six real Vite-imported TypeScript Playwright tests for 2/4/8 seats: valid accented/Han/emoji/inner ASCII space technical IDs and 64-code-unit boundaries, 27 invalid/null/bidi/zero-width/non-ASCII spaces/surrogates/65-unit candidates including final-seat injection, immutability and no silent ID normalization.
- One full mocked React browser poll: forged higher-revision, ETag, audit and *coherent public roster* with an invisible bidi actor is ignored before public/private session mutation. The previous hand/actor/revision stays valid, and one genuine end-turn succeeds.
- Three .NET xUnit theories: printable technical IDs, length boundaries and server-authoritative first-round/restore parity for 2/4/8 players.
- All three GitHub Actions gates must pass on the exact final `main` SHA before issue closure.

Related #13, #57, #112, #126.
Issue: https://github.com/KeyserDSoze/Game.Edonism/issues/127
