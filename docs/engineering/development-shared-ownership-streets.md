# #157 — Public co-owned streets for PvP reconnaissance

## Scope and source
The #152 verified public territory matrix is the sole input. It checks all 30 printed board cards, seven streets, 2–8 legitimate seats, every lot and henchman posture. This feature lists only roads containing **two or more distinct lot owners**, in canonical street and server-player order. Shared ownership is not an attack permission, purchase, power, movement or victory ranking.

## Fail-closed semantics
The new selector returns `null` for incomplete/forged board snapshots and `[]` for **valid** matches with no co-owned roads; the React panel is absent in the first case and shows an explicit empty message in the second. A 30/30 owned board remains valid when actor IDs pass #155. Reserved `system`, ghost active actors, invalid Unicode/spacing, owner, card, quota, slot and posture data fail closed.

## UX and test matrix
The UI is keyboard-accessible, collapsible and translated IT/EN. Inspecting a row calls only local `chooseStreet`, even in no-WebGL/mobile mode. It never invokes a new endpoint or a game-mutating POST.

- xUnit .NET Domain full-deck 2/4/8: compare per-road distinct owners with actual server snapshot and authenticated opponent-controlled routes; preserve printed cards, ownership, audit and private checkpoint through free move and end-turn.
- Playwright real Vite module 2/4/8: verified zero, two public owners on Gauss, genuine 30/30 ownership, spoofed technical/active actors, invalid board/lot/owner/posture and no private disclosure.
- Playwright React mock 2/8: shared row and empty state, invalid quota hidden, accessible IT/EN/mobile/no WebGL, no commands.
- Playwright live React vs real .NET 2/8: full DOM comparison with actual authenticated public routes/snapshot; inspection must not mutate revision.

## Gate
Parent #6, dependencies #152/#153/#155, feature #157. Close only after all three CI jobs report SUCCESS on the **same exact main HEAD commit**. No unapproved printed rules from #4/#7/#8/#13/#19.
