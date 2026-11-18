# #165 — Fail-closed technical seat IDs in hypothetical salary previews

## Verified gap

The Domain source of truth `MatchSalaryTaxScenarios.Quote` rejects any participant ID that fails `MatchParticipantId.IsValid`, plus duplicate owners. The React standalone `hasVerifiedHypotheticalSalaryScenarios` previously checked only `typeof playerId === "string"` and uniqueness. Thus a syntactically self-consistent, attacker-forged group of 0/1/2 read-only scenarios could pass this **independent UI validator** with a reserved `system` actor, invisible format characters, lone UTF-16 surrogates or an overlong actor. The surrounding Development public snapshot validator also checks actor IDs, so this is a boundary-in-depth problem, **not evidence of a real API token bypass, payment or Production exploit**.

## Change

- Reuse `isValidDevelopmentTechnicalPlayerId` (#127/#128) inside the pure hypothetical-scenario checker **on every gross salary owner**, before allowing any 0/1/2 net rows. The ID comparison remains ordinal/case-sensitive; reject the entire result rather than dropping invalid seats or normalizing strings.
- Preserve genuinely valid printable Unicode identities, including `Renée`, `王小明` and emoji, and allow `System` while reserving only exact lowercase `system`.
- Keep all existing checks from #162: 2–8 unique players, base 2, valid 0..16 standing lots with summed maximum 30, exact gross, tax 0/1/2, withheld totals and complete in-order nonnegative net rows.
- No gameplay, voting, tax activation, salary credit, API route or Production authentication change. Scenarios remain **hypothetical** and are never authority to transfer atoms.

## Regression coverage and CI rule

- Playwright imports the **actual Vite module** in a browser for 2, 4 and 8 players. Test cases recompute otherwise self-consistent 0/1/2 payloads around bad owners: `system`, null/number/blank, leading or trailing whitespace, C0/C1, bidi/zero-width/Unicode tag format characters, isolated surrogates, 65 code units, 33 emoji (66 UTF-16 units) and duplicates. Assert the entire preview fails and the input objects are not mutated; preserve valid Unicode cases.
- xUnit mirrors the exact policy for 2/4/8 Domain quote input and verifies accepted scenarios, tax totals and rejected actor IDs. The existing Playwright tampering suite (#162) and real .NET live suite are unchanged, and must remain green.
- Issue-first direct `main` development. Close #165 only after all 3 CI jobs are **completed/success on the final SHA**, with a link to the run on the issue and in the ledger. Parents #6/#8 remain open.
