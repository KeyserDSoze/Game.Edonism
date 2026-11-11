using System.Globalization;

namespace Edonism.Domain.Matches;

/// <summary>
/// Bounded, display-safe TECHNICAL player/seat identifier for the current
/// Development first-round protocol. Not an account name or nickname policy.
/// Never silently trim, normalize or rewrite an authoritative actor ID.
/// </summary>
public static class MatchParticipantId
{
    public const int MaxLength = 64;

    public static bool IsValid(string? id)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > MaxLength
            || id[0] == ' ' || id[^1] == ' ')
            return false;

        foreach (var codeUnit in id)
        {
            // C0/C1, DEL, bidi isolates/overrides, zero-width format chars
            // and Unicode line/paragraph separators make audit actor IDs
            // ambiguous in JSON/logs/accessible UI.
            var category = CharUnicodeInfo.GetUnicodeCategory(codeUnit);
            if (category is UnicodeCategory.Control or UnicodeCategory.Format
                or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator
                || char.IsWhiteSpace(codeUnit) && codeUnit != ' ')
                return false;
        }

        return true;
    }
}
