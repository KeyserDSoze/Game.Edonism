# #163 — Typed private Election Day card identity, checkpoint v2 + v1 recovery

## Source and the gap

The Italian printed rulebook `rulebook2.zip` pp. 3–5 contains **58 action cards plus exactly one Election Day physical card**, shuffled into the same 59-card deck; four cards go to each player. The internal `InitialActionDeckComposer.Deal` accepted the trusted election card's physical ID, but previously discarded its **type** after shuffling; a later mayor/election engine could not distinguish it without guessing which technical card ID or asset name meant "Election Day" (not acceptable without canonical card assets, #19).

## New PRIVATE Domain contract

- `InitialActionDeal.ElectionDayCardId` is recorded from the original trusted input, **not** guessed by inspecting opaque action IDs, a filename or a generated text label.
- `Deal` still makes exactly the same deterministic seeded shuffle of 59 IDs, four per each of the 2–8 seats. The marker can be in any private hand or the remaining hidden deck.
- `MatchesRecordedShuffle(deal, ids, requireElectionDayMarker: true)` validates exactly the original 59 unique physical IDs, their deterministic shuffle/seat order, plus one marker that identifies one of those cards. It does **not** prove that an alternative *existing* physical ID would mean Election Day: without canonical card metadata such a semantic test is not possible. Trust originates at the server setup input plus the authenticated AES-GCM encrypted file; do not claim a catalog-free proof of the printed effect.
- `GameMatchCheckpoint` **Domain format v2** requires the marker when a private deal is present. Format v1 checkpoints written by earlier versions still reload with null marker and retain format v1 on later writes; they are **not** silently migrated to v2 or assigned a guessed marker. A v1 with forged v2 metadata or a v2 missing a marker fails closed. Both formats continue to replay public audit events and preserve the exact same private hands.
- **Independent format boundaries:** `DevelopmentMatchCheckpointFiles` AES-GCM **file envelope v2** remains unchanged; its inner Domain checkpoint can be v1 (legacy) or v2 (current). There is no new public route or production session implementation.
- Neither the marker field nor any hidden draw pile/other player hand appears in `MatchSnapshot`, `/audit`, `/history`, `/public-territory`, `/settlement-preview`, `/hand` or React. A player still receives their own originally dealt **four physical IDs** through the existing bearer-bound private endpoint, as before. Initial Election Day placement creates **NO election event**; its effect, first-round trigger, votes and mayor powers remain blocked under #4/R-09 and #8.

## Verification & issue procedure

- xUnit 2/4/8 seed-based composition, exact one Election Day, presence in a hand or hidden deck, immutable shuffled private deal, movement/end-turn/restore/private hand equivalence, public/no-leak.
- xUnit missing/empty/unknown marker, future version, v1 no-marker restoration without silent upgrade, wrong shuffle/seed unchanged regression coverage.
- xUnit API + AES-GCM Development encrypted file 2/4/8: new inner checkpoint v2, restart and rotated bearer, own-hand-only access, no marker in public endpoints or ciphertext.
- Playwright live real React + .NET 2/8: public state/audit/history/settlement never contain typed Election Day marker, no election command/event; previous mock suite remains intact.
- Issue-first [#163](https://github.com/KeyserDSoze/Game.Edonism/issues/163), direct commits to `main`; only close with 3/3 GitHub Actions success on the *exact* final main SHA. Parent #6/#8 remain OPEN along with #4/#7/#9/#13/#19.

Reconcile previous [#162](https://github.com/KeyserDSoze/Game.Edonism/issues/162) with [CI #44010344394](https://github.com/KeyserDSoze/Game.Edonism/actions/runs/44010344394): **865 xUnit + 536 React + 42 live = 1,443/1,443, 3/3 success on `ac91f91`**.
