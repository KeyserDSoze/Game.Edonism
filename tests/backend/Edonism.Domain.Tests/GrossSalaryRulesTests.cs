using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class GrossSalaryRulesTests
{
    private static readonly Edonism.Domain.World.BoardDefinition Board = BoardCatalog.LoadDefault();

    private static GameMatch NewMatch() =>
        GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), Board,
        [new("alice", "N-01"), new("bob", "S-01")]);

    [Fact]
    public void TrustedStartControlsOneRealLotWithStandingHenchmanPerPlayer()
    {
        var match = NewMatch().Snapshot();

        Assert.Equal(["N-01", "S-01"], match.ControlledActivities.Select(a => a.SlotId));
        Assert.Equal(["alice", "bob"], match.ControlledActivities.Select(a => a.OwnerPlayerId));
        Assert.All(match.ControlledActivities, a => Assert.Equal(HenchmanPosture.Standing, a.Posture));
        Assert.All(match.Players, p =>
        {
            Assert.Equal(16, p.HenchmenTotal);
            Assert.Equal(15, p.HenchmenAvailable);
            Assert.Equal(4, p.Atoms);
        });
        Assert.All(match.GrossSalaryQuotes, q =>
        {
            Assert.Equal(2, q.BaseAtoms);
            Assert.Equal(1, q.StandingActivityAtoms);
            Assert.Equal(3, q.GrossAtoms);
        });
        Assert.Equal(0, match.Revision);
    }

    [Theory]
    [InlineData(HenchmanPosture.Standing, 3)]
    [InlineData(HenchmanPosture.Fallen, 2)]
    public void SalaryOnlyCountsStandingControlledActivities(HenchmanPosture posture, int expectedGross)
    {
        var state = NewMatch().Snapshot();
        var controlled = state.ControlledActivities.ToArray();
        controlled[0] = controlled[0] with { Posture = posture };

        var quotes = GrossSalaryRules.Quote(Board, state.Players, controlled);
        Assert.Equal(expectedGross, quotes[0].GrossAtoms);
        Assert.Equal(3, quotes[1].GrossAtoms);
        Assert.Equal(2, quotes[0].BaseAtoms);
        Assert.Equal(expectedGross - 2, quotes[0].StandingActivityAtoms);
    }

    [Fact]
    public void ExtraStandingControlsIncreaseOnlyOwnersGrossQuote()
    {
        var state = NewMatch().Snapshot();
        var players = state.Players.ToArray();
        players[0] = players[0] with { HenchmenAvailable = 13 };
        var controlled = state.ControlledActivities
            .Concat([
                new MatchControlledActivitySnapshot("N-02", "alice", HenchmanPosture.Standing),
                new MatchControlledActivitySnapshot("N-03", "alice", HenchmanPosture.Fallen)
            ]).ToArray();

        var quote = GrossSalaryRules.Quote(Board, players, controlled);
        Assert.Equal(4, quote[0].GrossAtoms);
        Assert.Equal(3, quote[1].GrossAtoms);
    }

    [Fact]
    public void InvalidControlOwnershipAndUnknownLotsAreRejected()
    {
        var state = NewMatch().Snapshot();
        var first = state.ControlledActivities[0];

        Assert.Throws<ArgumentException>(() =>
            GrossSalaryRules.Quote(Board, state.Players,
                [first with { OwnerPlayerId = "someone-else" }]));

        Assert.Throws<ArgumentException>(() =>
            GrossSalaryRules.Quote(Board, state.Players,
                [first with { SlotId = "DOES-NOT-EXIST" }]));

        Assert.Throws<ArgumentException>(() =>
            GrossSalaryRules.Quote(Board, state.Players,
                [first, first with { OwnerPlayerId = "bob" }]));
    }

    [Fact]
    public void UnknownHenchmanPostureIsRejected()
    {
        var state = NewMatch().Snapshot();
        var bad = state.ControlledActivities[0] with { Posture = (HenchmanPosture)999 };
        Assert.Throws<ArgumentException>(() => GrossSalaryRules.Quote(Board, state.Players, [bad]));
    }

    [Fact]
    public void InconsistentReserveAndOverdeployedHenchmenAreRejected()
    {
        var state = NewMatch().Snapshot();
        var players = state.Players.ToArray();
        players[0] = players[0] with { HenchmenAvailable = 16 };
        Assert.Throws<InvalidOperationException>(() =>
            GrossSalaryRules.Quote(Board, players, state.ControlledActivities));

        var slotsForAlice = Board.Slots
            .Where(s => s.Id != "S-01").Take(17)
            .Select(s => new MatchControlledActivitySnapshot(s.Id, "alice", HenchmanPosture.Standing));
        var tooMany = slotsForAlice
            .Append(new MatchControlledActivitySnapshot("S-01", "bob", HenchmanPosture.Standing))
            .ToArray();
        players[0] = players[0] with { HenchmenAvailable = 0 };
        Assert.Throws<InvalidOperationException>(() =>
            GrossSalaryRules.Quote(Board, players, tooMany));
    }

    [Fact]
    public void ReadOnlySalaryQuoteDoesNotCreditWalletOrAdvanceRevision()
    {
        var match = NewMatch();
        var before = match.Snapshot();
        Assert.Equal([3, 3], before.GrossSalaryQuotes.Select(q => q.GrossAtoms));

        Assert.True(match.TryFreeMove("alice", "planck", 0).Accepted);
        Assert.True(match.TryEndTurn("alice", 1).Accepted);
        Assert.True(match.TryEndTurn("bob", 2).Accepted);

        var pending = match.Snapshot();
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, pending.Phase);
        Assert.Equal([3, 3], pending.GrossSalaryQuotes.Select(q => q.GrossAtoms));
        Assert.Equal(["N-01", "S-01"], pending.ControlledActivities.Select(a => a.SlotId));
        Assert.All(pending.Players, p => Assert.Equal(4, p.Atoms));
        Assert.Equal(3, pending.Revision);
        Assert.Equal(4, pending.Events.Count);
        Assert.Equal([4, 4], before.Players.Select(p => p.Atoms));
    }

    [Fact]
    public void SnapshotControlAndQuotesCannotBeMutatedFromOutside()
    {
        var match = NewMatch();
        var snapshot = match.Snapshot();
        Assert.Throws<NotSupportedException>(() =>
            ((IList<MatchControlledActivitySnapshot>)snapshot.ControlledActivities)[0] =
                new MatchControlledActivitySnapshot("E-01", "alice", HenchmanPosture.Fallen));
        Assert.Throws<NotSupportedException>(() =>
            ((IList<MatchGrossSalaryQuote>)snapshot.GrossSalaryQuotes)[0] =
                new MatchGrossSalaryQuote("alice", 99, 99, 198));
        Assert.Equal(3, match.Snapshot().GrossSalaryQuotes[0].GrossAtoms);
    }
}
