/**
 * #127: Narrow display-safe DEVELOPMENT technical player identifier shape.
 * Mirror the existing .NET MatchParticipantId public protocol boundary;
 * this is not authentication, nickname policy or a gameplay rule.
 *
 * JS string.length counts UTF-16 code units (same 64-unit server limit).
 * Never trim/normalize: ordinal exact IDs protect the actor binding.
 */
const unsafeScalar = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const whiteSpace = /\p{White_Space}/u;

export function isValidDevelopmentTechnicalPlayerId(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64
    || !value.trim() || value[0] === " " || value[value.length - 1] === " ")
    return false;

  for (const rune of value) {
    const point = rune.codePointAt(0);
    // JavaScript's iterator yields each complete surrogate pair as one rune,
    // but a lone high/low surrogate is a non-Unicode scalar.
    if (point === undefined || (point >= 0xd800 && point <= 0xdfff)
      || unsafeScalar.test(rune)
      || (whiteSpace.test(rune) && rune !== " "))
      return false;
  }
  return true;
}
