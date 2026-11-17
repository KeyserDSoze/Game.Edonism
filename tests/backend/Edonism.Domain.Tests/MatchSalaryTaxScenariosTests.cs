using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #162: printed tax range is an informational scenario, not elected policy,
/// a salary credit, a treasury transfer or permission to start another round.
/// </summary>
public sealed class MatchSalaryTaxScenariosTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void CanonicalTwoToEightSeatScenariosKeepNetAndTreasuryWhatIfTotals(int count)
    {
        var quotes = Enumerable.Range(0, count)
            .Select(i => new MatchGrossSalaryQuote(
                $"player-{i}", 2, i % 2, 2 + i % 2)).ToArray();
        var unchanged = quotes.ToArray();
        var scenarios = MatchSalaryTaxScenarios.Quote(quotes);
        Assert.Equal(new[] { 0, 1, 2 },
            scenarios.Select(s => s.HypotheticalTaxAtomsPerPlayer));
        foreach (var scenario in scenarios)
        {
            var tax = scenario.HypotheticalTaxAtomsPerPlayer;
            Assert.Equal(count * tax, scenario.PotentialWithheldAtoms);
            Assert.Equal(quotes.Select(q => q.PlayerId),
                scenario.Players.Select(q => q.PlayerId));
            Assert.Equal(count, scenario.Players.Count);
            for (var i = 0; i < count; i++)
            {
                var row = scenario.Players[i];
                Assert.Equal(quotes[i].GrossAtoms, row.GrossAtoms);
                Assert.Equal(tax, row.HypotheticalTaxAtoms);
                Assert.Equal(quotes[i].GrossAtoms - tax, row.HypotheticalNetAtoms);
                Assert.True(row.HypotheticalNetAtoms >= 0);
            }
            Assert.Equal(quotes.Sum(q => q.GrossAtoms),
                scenario.Players.Sum(row => row.HypotheticalNetAtoms)
                + scenario.PotentialWithheldAtoms);
            Assert.Throws<NotSupportedException>(() =>
                ((IList<MatchHypotheticalNetSalary>)scenario.Players).Clear());
        }
        Assert.Throws<NotSupportedException>(() =>
            ((IList<MatchHypotheticalTaxScenario>)scenarios).Clear());
        Assert.Equal(unchanged, quotes);
        Assert.DoesNotContain("Paid", JsonSerializer.Serialize(scenarios));
        Assert.DoesNotContain("Wallet", JsonSerializer.Serialize(scenarios));
    }

    [Fact]
    public void BaseOnlyZeroLotOwnerMayHypotheticallyNetZeroAtPrintedMaximumTax()
    {
        var quotes = new[]
        {
            new MatchGrossSalaryQuote("alice", 2, 0, 2),
            new MatchGrossSalaryQuote("bob", 2, 2, 4)
        };
        var scenarios = MatchSalaryTaxScenarios.Quote(quotes);
        Assert.Equal(new[] { 2, 1, 0 },
            scenarios.Select(s => s.Players[0].HypotheticalNetAtoms));
        Assert.Equal(new[] { 4, 3, 2 },
            scenarios.Select(s => s.Players[1].HypotheticalNetAtoms));
        Assert.Equal(new[] { 0, 2, 4 },
            scenarios.Select(s => s.PotentialWithheldAtoms));
    }

    [Fact]
    public void RejectedFakeQuotesNeverProducePartialOrOverflowedTaxScenarios()
    {
        var good = new MatchGrossSalaryQuote("alice", 2, 1, 3);
        var other = new MatchGrossSalaryQuote("bob", 2, 0, 2);
        Assert.Throws<ArgumentNullException>(() =>
            MatchSalaryTaxScenarios.Quote(null!));
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote([]));
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote([good]));
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote([good, good]));
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote([good, null!]));
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote([good, other with { PlayerId = "system" }]));
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote([good, other with { PlayerId = "bad\u202Ename" }]));
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote([good, other with { BaseAtoms = 0 }]));
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote([good, other with { StandingActivityAtoms = -1 }]));
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote([good, other with { StandingActivityAtoms = 17,
                GrossAtoms = 19 }]));
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote([good, other with { GrossAtoms = int.MaxValue }]));
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote(
                Enumerable.Range(0, 9).Select(i => new MatchGrossSalaryQuote(
                    $"player-{i}", 2, 0, 2)).ToArray()));
        Assert.Throws<ArgumentException>(() =>
            MatchSalaryTaxScenarios.Quote([
                new MatchGrossSalaryQuote("alice", 2, 16, 18),
                new MatchGrossSalaryQuote("bob", 2, 16, 18)
            ]));
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void AuditedPendingFullDeckPreviewMatchesAllThreeScenariosWithoutAnyPayment(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), board,
            Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray(),
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);
        Assert.Null(match.PendingSettlementPreview());
        var before = match.Snapshot();
        var privateBefore = JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal);
        var active = before.Players[0];
        var street = board.Streets.Single(s => s.Id == active.StreetId);
        Assert.True(match.TryFreeMove(active.PlayerId, street.Neighbors[0], match.Revision).Accepted);
        Assert.Null(match.PendingSettlementPreview());
        for (var i = 0; i < count; i++)
        {
            Assert.True(match.TryEndTurn($"player-{i}", match.Revision).Accepted);
            if (i < count - 1) Assert.Null(match.PendingSettlementPreview());
        }
        var checkpointBefore = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var preview = Assert.IsType<MatchPendingSettlementPreview>(match.PendingSettlementPreview());
        Assert.Equal(count + 1, preview.VerifiedRevision);
        Assert.Equal(before.GrossSalaryQuotes, preview.GrossSalaryQuotes);
        Assert.Equal(3, preview.HypotheticalTaxScenarios.Count);
        foreach (var tax in Enumerable.Range(0, 3))
        {
            var scenario = preview.HypotheticalTaxScenarios[tax];
            Assert.Equal(tax, scenario.HypotheticalTaxAtomsPerPlayer);
            Assert.Equal(count * tax, scenario.PotentialWithheldAtoms);
            Assert.Equal(before.Players.Select(p => p.PlayerId),
                scenario.Players.Select(row => row.PlayerId));
            Assert.All(scenario.Players, row =>
            {
                Assert.Equal(3, row.GrossAtoms);
                Assert.Equal(tax, row.HypotheticalTaxAtoms);
                Assert.Equal(3 - tax, row.HypotheticalNetAtoms);
            });
        }
        Assert.Equal(checkpointBefore, JsonSerializer.Serialize(match.CaptureCheckpoint()));
        Assert.Equal(privateBefore, JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal));
        Assert.All(match.Snapshot().Players, player => Assert.Equal(4, player.Atoms));
        Assert.True(match.VerifyPublicAudit().IsValid);
        var restored = GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint());
        Assert.Equal(JsonSerializer.Serialize(preview),
            JsonSerializer.Serialize(restored.PendingSettlementPreview()));
    }
}
