# Public Development audit event JSON boundary (#113)

The Development lab accepts publicly scoped snapshots after the #112 envelope
guard. Before #113, that guard confirmed only that `events` was an array,
without validating its **elements**. A forged `events:[null]` could pass the
pre-revision check, advance the browser revision, session and poll ETag and
then crash React: `visiblePublicAuditEvents` read `entry.revision` on
an unvalidated object. Even after the server supplied a legitimate revision,
the browser could believe that an earlier forged higher revision was newer.

The pure `isPublicMatchEventRecord(value)` now checks record shape only:
nonnegative safe integer revision, positive safe integer round, nonempty
string event kind and actor ID, and string-or-null source/destination streets.
The Development envelope validates **every** event before accepting the
state or caching its ETag, for create/join and poll/command refresh as well.
The read-only audit filter independently rejects malformed arrays or
individual entries **as a whole**, never throwing or displaying an
apparently complete partial public audit.

Importantly, this is **not** a game-event verifier. Unknown but
well-formed future event kinds pass the narrow ingress schema for forward
compatibility, while `visiblePublicAuditEvents` still displays only the
reviewed first-round genesis, free-move, turn-ended and
round-settlement-pending kinds and hides unknown/private kinds. Only the
authoritative .NET `MatchAuditReplay` enforces event chronology, actor
permissions and legal movements. Invalid *individual board cards* still
belong to the independent UI filters of #108/#111 and must not revoke
unrelated authenticated commands.

Regression tests: seven Playwright cases importing the real Vite-backed
TypeScript, including valid 2/4/8-seat first-round records, 16 malformed
record variants per size, and malformed array/actor containers. A further
full browser regression injects forged revision **98** with
`events:[null]`; asserts that the original revision **0**, actor,
private hand and server-authorized turn permission survive, the forged
ETag is never sent, and an actual end-turn advances to **revision 1**.
No global worker, retry or timeout change; all xUnit and live .NET
two-bearer Playwright scenarios remain mandatory on final exact `main`.

[Issue #113](https://github.com/KeyserDSoze/Game.Edonism/issues/113)
