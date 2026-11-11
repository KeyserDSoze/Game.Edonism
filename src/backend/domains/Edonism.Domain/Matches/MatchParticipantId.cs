using System.Buffers;
using System.Globalization;
using System.Text;

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

        // Check Unicode SCALAR VALUES, not isolated UTF-16 code units.
        // A lone surrogate is not a valid actor ID: JSON may substitute it,
        // making server-side identity differ from client-visible identity.
        for (var offset = 0; offset < id.Length;)
        {
            var status = Rune.DecodeFromUtf16(id.AsSpan(offset),
                out var scalar, out var consumed);
            if (status != OperationStatus.Done) return false;

            // C0/C1, DEL, bidi isolates/overrides, zero-width format chars
            // (including supplementary tag characters) and Unicode line/
            // paragraph separators make audit actor IDs ambiguous.
            var category = Rune.GetUnicodeCategory(scalar);
            if (category is UnicodeCategory.Control or UnicodeCategory.Format
                or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator
                || Rune.IsWhiteSpace(scalar) && scalar.Value != ' ')
                return false;
            offset += consumed;
        }

        return true;
    }
}
