# Parallel Development token rotations survive encrypted restarts (#81)

The opt-in Development AES-GCM checkpoint is an additional trust boundary beyond the in-memory per-match lock. The live capability for each actor must match exactly the latest durably committed digest. A concurrent losing rotation must never leave a second valid bearer or overwrite a successful winner.

The xUnit full-deck test creates **2–8 seats**, all with distinct private four-card hands. Two rotations for each actor run concurrently behind one release barrier. The only accepted outcome per actor is one winner and one rejection. After all writes, the encrypted file is read through the authenticated checkpoint loader; it must hold one unique winning SHA-256 capability digest for each actor, not any original digest.

Then a **new** `DevelopmentMatchStore` reads only that checkpoint: every original bearer is rejected for all public/private reads, while every winning bearer restores the correct original private hand, identical public state, revision zero and a valid audit. A further rotation in the restarted store is checked again after a second cold restart, proving old and intermediate tokens remain revoked.

This test exercises the real `DevelopmentMatchCheckpointFiles` and Domain restore; no mock disk is used. It intentionally excludes Production identity, multi-instance database persistence, and unconfirmed gameplay rules; these remain tracked in #13 and #6.

[GitHub issue #81](https://github.com/KeyserDSoze/Game.Edonism/issues/81).
