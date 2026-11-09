# ADR 0002: Original street graph is authoritative for movement

**Status:** accepted design direction (user confirmation 2026-11-09, issue #5). Inferred edge details remain subject to review.

## Decision
Keep the **original board**, including 30 activity slots and the central City Hall, the seven named streets and the original adjacency-based movement. Three.js merely *draws* the city in 3D. The axial hexagonal foundation prototype is removed (including HexCoordinate); no hex-distance, freeform collision or WebGL coordinate governs turns.

Board data is versioned in `src/shared/board/edonism-board.v1.json`. It is compiled into the backend Infrastructure assembly as an embedded resource and consumed from the same path by the frontend. Domain types validate topology and provide `CanMoveOneStreet` / `ShortestStreetDistance`. The API publishes the static board at `GET /api/v1/board`.

**The server remains authoritative** when actual matches start in #6: clients will send intent referencing stable street/slot IDs and the server will validate distance, speed, turn limits, ownership, costs and other rules (not yet implemented).

## Non-authoritative visual details
Coordinates in the JSON use a **1504×998 approximate design viewbox** mapped from the **2048×1371 original uploaded board image**; they are not native source image pixel coordinates. They represent rough slot/road placement. Rendering translates to Three.js world units. Positions, placeholder building heights/colors, and ornamental Pucciottini do not belong to gameplay state.

## Seeded assignment
`ActivityPlacement.Assign` shuffles only a fully supplied and validated 30-card set (strict printed category quotas). It is NOT the deck selection algorithm. Mandatory character activities, quota overflows and authoritative random setup must be handled in #6 with a documented rule/versioned test.

## Provenance & acceptance
See [board topology v1](../game-design/board-topology-v1.md) for explicit source-derived and image-inferred edges. New rule variations require new versioned data + issue + xUnit/Playwright coverage. Avoid direct artifact reuse without asset rights review.

## Follow-ups
- #6 server match state, game action authorization and setup (including seeded mandatory-card selection).
- #7 card catalog/powers/abilities.
- #9 replace placeholder meshes with project-original models.
