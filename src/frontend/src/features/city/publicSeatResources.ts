import { verifiedPublicSeatEconomy } from "./publicSeatEconomy";
import type { PublicMatchSceneState } from "./activityMarkers";

/**
 * #139: Only the existing public .NET MatchPlayerSnapshot resource fields.
 * This is a read-only Development view, NOT spendable gross salary, a
 * client wallet, an attack rule or a command capability.
 */
export type PublicSeatResources = Readonly<{
  atoms: number;
  diplomacyTokens: number;
  henchmenTotal: number;
  henchmenAvailable: number;
}>;

/**
 * All-or-nothing verification against the ALREADY independently validated
 * public economic projection (#138). Each deployed henchman occupies one
 * verified controlled lot; a 0-lot rival has the entire reserve free.
 * Never display a partial or mismatched public roster as authoritative.
 * This checks transport consistency, not game mechanics or future payouts.
 */
export function verifiedPublicSeatResources(value: unknown): ReadonlyMap<string, PublicSeatResources> {
  const empty = () => new Map<string, PublicSeatResources>();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return empty();
  const state = value as PublicMatchSceneState;
  const economy = verifiedPublicSeatEconomy(value);
  if (!Array.isArray(state.players) || economy.size !== state.players.length
    || economy.size < 2 || economy.size > 8)
    return empty();
  const result = new Map<string, PublicSeatResources>();
  for (const player of state.players) {
    const verified = economy.get(player.playerId);
    if (!verified
      || !Number.isSafeInteger(player.atoms) || player.atoms! < 0
      || !Number.isSafeInteger(player.diplomacyTokens) || player.diplomacyTokens! < 0
      // #168: The printed per-seat reserve is 16; .NET GrossSalaryRules
      // rejects even a self-consistent forged 15/14 or 17/16 owner.
      || player.henchmenTotal !== 16
      || !Number.isSafeInteger(player.henchmenAvailable) || player.henchmenAvailable! < 0
      || player.henchmenAvailable! > player.henchmenTotal!
      || player.henchmenTotal! - player.henchmenAvailable! !== verified.controlledLots)
      return empty();
    result.set(player.playerId, {
      atoms: player.atoms!,
      diplomacyTokens: player.diplomacyTokens!,
      henchmenTotal: player.henchmenTotal!,
      henchmenAvailable: player.henchmenAvailable!,
    });
  }
  return result.size === economy.size ? result : empty();
}
