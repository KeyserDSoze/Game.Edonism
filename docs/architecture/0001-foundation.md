# ADR 0001: 3D hex city foundation

**Status:** accepted for the technical foundation (gameplay rules pending).

## Context
Edonism is a browser city board game with hexagonal land plots, businesses and collectible small characters. Visual perspective should be isometric-ish with full 3D meshes even though turns/strategy are board-oriented.

## Decision
- React/TypeScript + Vite for the browser application.
- Three.js rendered through React Three Fiber v9, with Drei for camera controls; WebGL with geometric placeholders until original assets exist. Use glTF/GLB for future models.
- A DOM shell built from shadcn/ui and Tailwind CSS, separated from the world scene. Theme follows light/dark/system.
- Backend ASP.NET Core 10, domain/application/infrastructure/API boundaries copied in spirit from Vuxo.
- Single-player map preview is non-authoritative **art only**. No economy, ownership, movement, turns, rewards or PvP state is calculated in the client.
- When rules arrive, define server-side domain aggregates and explicit commands/validation, API contracts, and (if appropriate) SignalR updates. Then connect UI to authoritative state.

## Alternatives
- Phaser: optimized for 2D, not natural for actual 3D hex terrain and figurines.
- Babylon.js: valid mature 3D engine, but React Three Fiber better matches component-oriented React architecture and our lightweight board rendering need.
- Full 3D physics: not needed for a board game foundation; defer until mechanics justify it.

## Future risks and follow-ups
- WebGL availability/mobile performance; keep accessible HTML controls and fallbacks.
- Future big maps: instanced meshes, asset LOD and culling; measure before optimizing.
- Multiplayer synchronization and anti-cheat: wait for canonical game design.
- Real characters/assets, persistence, auth, observability and deployments are out of scope of issue #1.


## Update — issue #5 (2026-11-09)

The game designer approved **preserving the original street topology and movement rules** when rebuilding the city as 3D. The original axial hex city was a throwaway visualization and has been removed. See [ADR 0002](0002-original-street-board.md) and [board topology](../game-design/board-topology-v1.md). The 30 activity lots and seven streets, including Main Square/City Hall, now have a single versioned geometry definition. The source graph (not distance in Three.js) is the movement adjacency reference.
