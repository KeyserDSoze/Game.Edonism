# Nearby public opponent-lot filter (#85)

The Development laboratory's opponent-controlled-lot section (built in #84) has a keyboard-operable, `aria-pressed` IT/EN toggle to display only lots controlled by **other seats** on the current authenticated actor's public street or at most one **canonical street edge** away. The default is the full server-defined distance/owner/slot order. A visible count and explicit zero-nearby empty state appear when filtered.

Filtering happens **after** the full #84 HTTP projection is validated against the current public match snapshot, the canonical board graph, and the match/seat/bearer/revision lease. A filter toggle does not issue HTTP requests or mutate any state. Switching match, local actor or bearer resets the toggle, and invalid/revoked/late responses cannot manufacture a lot or map focus.

Street edges are geometric game-board topology only. They are **not** distance in turns, danger level, hostility, attack/purchase/movement permission, or a new printed-rule mechanic. All unapproved actions remain blocked by #4/#6/#7/#8; Production identity and persistence remain #13.

Tests: xUnit same-street (0), adjacent (1) and farther (2+) public controlled lots with a first-round free move; Playwright mocked narrow-screen seat switching/empty state; Playwright with a real .NET Development API proving visibility and no public match mutation. Close only after all three CI jobs succeed on the exact final main HEAD.
