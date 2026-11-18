using Edonism.Domain.Matches;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #165: .NET is the reference for allowed technical seat IDs in 0/1/2
/// hypothetical salary projections. React must mirror this boundary even
/// when the public snapshot validator is not its immediate caller.
/// </summary>
public sealed class MatchSalaryTaxTechnicalSeatIdsTests
{
    private static readonly string[] ValidSeats =
    [
        "Renée", "王小明", "System", "🙂",
        "alpha", "bravo", "charlie", "delta"
    ];

    private static MatchGrossSalaryQuote[] Gross(string[] seats) =>
        seats.Select((id, i) => new MatchGrossSalaryQuote(
            id, 2, i % 2, 2 + i % 2)).ToArray();

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void ValidUnicodeAndNonReservedCasingPreserveAllThreeScenarios(int count)
    {
        var seats = ValidSeats.Take(count).ToArray();
        Assert.All(seats, id => Assert.True(MatchParticipantId.IsValid(id)));
        var original = Gross(seats);
        var scenarios = MatchSalaryTaxScenarios.Quote(original);

        Assert.Equal(new[] { 0, 1, 2 },
            scenarios.Select(s => s.HypotheticalTaxAtomsPerPlayer));
        Assert.Equal(original.Select(q => q.PlayerId),
            scenarios[0].Players.Select(p => p.PlayerId));
        foreach (var scenario in scenarios)
        {
            var tax = scenario.HypotheticalTaxAtomsPerPlayer;
            Assert.Equal(tax * count, scenario.PotentialWithheldAtoms);
            Assert.Equal(original.Select(q => q.GrossAtoms - tax),
                scenario.Players.Select(p => p.HypotheticalNetAtoms));
        }
        Assert.Equal(seats, original.Select(q => q.PlayerId));
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void ReservedControlInvisibleSurrogateAndOverlongOwnersRejectWholeQuote(int count)
    {
        var original = Gross(ValidSeats.Take(count).ToArray());
        string?[] badIds =
        [
            "system", null, "", " ", " Renée", "Renée ",
            "alice\nbob", "alice\tbob", "alice\u202Eevil",
            "alice\u200B", "alice\u0085", "\uD800", "\uDC00",
            new string('A', 65),
            string.Concat(Enumerable.Repeat("🙂", 33)),
            "alice\U000E0001other"
        ];

        foreach (var badId in badIds)
        {
            Assert.False(MatchParticipantId.IsValid(badId));
            var forged = original.ToArray();
            forged[^1] = forged[^1] with { PlayerId = badId! };
            Assert.Throws<ArgumentException>(() =>
                MatchSalaryTaxScenarios.Quote(forged));
        }

        var duplicated = original.ToArray();
        duplicated[^1] = duplicated[^1] with { PlayerId = original[0].PlayerId };
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote(duplicated));
        Assert.All(original, quote =>
            Assert.True(MatchParticipantId.IsValid(quote.PlayerId)));
    }
}
