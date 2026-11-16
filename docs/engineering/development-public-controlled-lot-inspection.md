# Read-only inspection of publicly controlled activity lots (#132)

## PvP problem
The city's public control roster displays owner, printed slot, face-up activity card and standing/fallen henchman. The printed 30-slot city can be inspected with the existing `chooseSlot` viewer, but previously the roster's valid lot IDs were inert text: players had to manually locate a rival's activity. #131 already adds this workflow for each player's original starting lot; #132 extends the same accessible pattern to each **currently visible public controlled lot**.

## Narrow UI and authority boundary
In `App.tsx`, the `controlledLotMarkers` **verified public projection** (existing #108) is the only source of links. It already requires a unique card and public controller for a canonical board slot, a known public owner, a valid face-up card ID/category and valid standing/fallen posture. For each marker, display its slot ID inside a native localized, keyboard-actionable button:
- IT: `Esplora l’attività controllata S-01 da bob`.
- EN: `Inspect activity S-01 controlled by bob`.
- Test ID: `match-inspect-controlled-S-01` for that canonical lot; `aria-pressed` reflects ONLY the locally selected board lot.

The action calls the existing `chooseSlot(marker.slotId)` viewer: focus exact original printed lot and its street, using one shared versioned board. It does not rely on the owner's current pawn street, is not a movement or game-control API and never grants ownership, changes henchman posture, alters public state/ETag, actor/hand/salary, or leaks cards beyond already face-up public control. Hide links for ambiguous/malformed/unknown slots; preserve independently valid public lots rather than suppress all card views. Leave/match reset already removes the entire controlled-roster view. Production auth/powers/corruption/elections remain unimplemented and unchanged.

## Verifiable regression gates
- Six real-Vite Playwright tests for 2/4/8 seats: 30 printed lot/road mappings from the shared board; valid card and owner markers; invalid owner/posture/unknown slot and duplicate cards/controls suppress the bad lot but retain unrelated good lots; immutability.
- Four mocked full React Playwright tests: 2/8 player rivals, Bob's S-01 controlled business selected to Einstein while Alice remains in place, later Alice's legal move to Planck and N-01 inspected as Gauss with exactly one original command, actor switch, leave, no hand/ETag leak; English + keyboard Enter + 390px mobile and WebGL fallback; malformed remote control cannot expose an inspect action for that lot.
- A real React + .NET browser test in the first-round live suite: inspect Bob's **real server-assigned** public controlled activity slot and printed street without any game-command POST or revision change; existing actual move continues to work.
- Three authoritative xUnit cases for 2/4/8 initial seats: known unique printed control slots, owners and posture unchanged across free moves, turn endings, pending settlement and checkpoint restore. Read-only inspection never writes server state.
- All 3 CI jobs must succeed on the **exact final main SHA** before closing #132.

Tracking: https://github.com/KeyserDSoze/Game.Edonism/issues/132
