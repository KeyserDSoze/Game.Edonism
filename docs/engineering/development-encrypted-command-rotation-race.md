# Durable command/rotation race across encrypted HTTP restarts (#83)

## Contract

A Development seat may submit `free-move` or `end-turn` with a UUID idempotency key while another tab rotates its bearer. Under one single-process match lock, either the command commits first (200, one event/revision and durable receipt) or the rotation commits first (old-bearer command receives 404 and writes no event/receipt). In either schedule, the rotation publishes exactly one successor capability and revokes the original.

The edge not previously tested by #79 (memory-only HTTP race) and #81 (encrypted multiple-seat rotations) is the **combined durability boundary**: encrypted command checkpoint + receipt + changed token digests must be restorable together in a fresh ASP.NET Core host.

## Integration matrix

The new xUnit `WebApplicationFactory<Program>` matrix covers **2–8 seats × `free-move`/`end-turn` = 14 scenarios** using the existing 23-character/46-activity/59-action synthetic Development full-deck fixture (fixed valid seed 2026). Both old-token HTTP operations start behind a release barrier; test assertions accept both legal orders.

The first host is disposed. A new host and `DevelopmentMatchStore` read the **real authenticated AES-GCM file**. The test checks revoked tokens cannot read, submit a command, replay a UUID or rotate; each untouched peer retains the correct four private cards. Before retry, the persisted revision and receipt count must correspond exactly to the original 200/404 result. Retrying the same UUID under the new bearer either replays or commits exactly once. After a second cold HTTP restart, the receipt still replays without additional events, while the same public snapshot is visible to every authenticated peer, server audit verifies revision 1 and wallet resources remain unchanged.

This is Development single-process durability regression coverage, **not** multi-instance transactionality, Production identity or approval of unresolved salary/turn/election rules (#4/#6/#13). Never expose token/receipt values in public snapshots or audit.

[Issue #83](https://github.com/KeyserDSoze/Game.Edonism/issues/83).
