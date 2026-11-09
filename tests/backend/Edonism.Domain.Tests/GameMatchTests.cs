using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class GameMatchTests
{
    private static GameMatch NewMatch(params MatchParticipantSeed[] players) =>
        GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), BoardCatalog.LoadDefault(),
            players.Length > 0 ? players : [new("alice", "N-01"), new("bob", "E-01"), new("cara", "S-01")]);

    [Fact]
    public void TrustedSetupDerivesStreetsFromRealLotsAndPrintedInitialResources()
    {
        var match = NewMatch();
        var snapshot = match.Snapshot();
        Assert.Equal(0, snapshot.Revision);
        Assert.Equal(1, snapshot.Round);
        Assert.Equal("edonism-streets-v1", snapshot.BoardVersion);
        Assert.Equal(MatchPhase.PlayerTurns, snapshot.Phase);
        Assert.Equal("alice", snapshot.ActivePlayerId);
        Assert.Equal(["alice", "bob", "cara"], snapshot.TurnOrder);
        Assert.Equal(["cara", "alice", "bob"], snapshot.ProposedNextRoundOrder);
        Assert.Equal(["gauss", "planck", "einstein"], snapshot.Players.Select(p => p.StreetId));
        Assert.All(snapshot.Players, p =>
        {
            Assert.Equal(4, p.Atoms);
            Assert.Equal(2, p.DiplomacyTokens);
            Assert.Equal(16, p.HenchmenTotal);
            Assert.Equal(15, p.HenchmenAvailable);
            Assert.False(p.FreeMoveUsed);
        });
        Assert.Single(snapshot.Events);
        Assert.Equal("match-created", snapshot.Events[0].Kind);
    }

    [Theory]
    [InlineData("gauss", true)]
    [InlineData("newton", false)]
    [InlineData("main-square", false)]
    [InlineData("meson", true)]
    [InlineData("einstein", true)]
    [InlineData("unknown", false)]
    [InlineData("planck", false)]
    public void OneFreeMoveMustFollowPrintedAdjacency(string destination, bool shouldAccept)
    {
        var match = NewMatch(new("alice", "E-01"), new("bob", "N-01"));
        var before = match.Snapshot();
        var outcome = match.TryFreeMove("alice", destination, 0);
        Assert.Equal(shouldAccept, outcome.Accepted);
        Assert.Equal(shouldAccept ? 1 : 0, match.Revision);
        if (!shouldAccept)
        {
            Assert.Equal(before.Revision, match.Revision);
            Assert.Equal(before.Players.Select(p => p.StreetId), match.Snapshot().Players.Select(p => p.StreetId));
            Assert.Equal(before.Events.Select(e => e.Kind), match.Snapshot().Events.Select(e => e.Kind));
        }
    }

    [Fact]
    public void SuccessfulMoveConsumesFreeMovementAndCannotBeReplayed()
    {
        var match = NewMatch(new("alice", "N-01"), new("bob", "S-01"));
        var first = match.TryFreeMove("alice", "planck", 0);
        Assert.True(first.Accepted);
        Assert.Equal("planck", first.State.Players[0].StreetId);
        Assert.True(first.State.Players[0].FreeMoveUsed);
        Assert.Equal("free-move", first.State.Events[^1].Kind);
        Assert.Equal("gauss", first.State.Events[^1].FromStreetId);
        Assert.Equal("planck", first.State.Events[^1].ToStreetId);
        Assert.Equal("revision_conflict", match.TryFreeMove("alice", "meson", 0).Code);
        Assert.Equal("free_move_already_used", match.TryFreeMove("alice", "meson", 1).Code);
        Assert.Equal(1, match.Revision);
        Assert.Equal(2, match.Snapshot().Events.Count);
    }

    [Theory]
    [InlineData("bob", "planck", "not_your_turn")]
    [InlineData("alice", "nonexistent", "unknown_street")]
    [InlineData("alice", "einstein", "not_adjacent")]
    [InlineData("alice", "gauss", "not_adjacent")]
    public void InvalidCommandsDoNotAlterState(string actor, string destination, string expected)
    {
        var match = NewMatch(new("alice", "N-01"), new("bob", "S-01"));
        var before = match.Snapshot();
        var result = match.TryFreeMove(actor, destination, 0);
        Assert.False(result.Accepted);
        Assert.Equal(expected, result.Code);
        Assert.Equal(before.Revision, match.Revision);
        Assert.Equal(before.Players.Select(p => p.StreetId), match.Snapshot().Players.Select(p => p.StreetId));
        Assert.Equal(before.Events.Select(e => e.Kind), match.Snapshot().Events.Select(e => e.Kind));
    }

    [Fact]
    public void TurnChangesToNextPlayerAndRoundPausesBeforeUnimplementedSalaryAndDraw()
    {
        var match = NewMatch(new("alice", "N-01"), new("bob", "S-01"));
        Assert.True(match.TryEndTurn("alice", 0).Accepted);
        Assert.Equal("bob", match.Snapshot().ActivePlayerId);
        Assert.Equal("not_your_turn", match.TryFreeMove("alice", "planck", 1).Code);
        Assert.True(match.TryFreeMove("bob", "newton", 1).Accepted);
        Assert.True(match.TryEndTurn("bob", 2).Accepted);
        var pending = match.Snapshot();
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, pending.Phase);
        Assert.Null(pending.ActivePlayerId);
        Assert.Equal(["bob", "alice"], pending.ProposedNextRoundOrder);
        Assert.Equal("round-settlement-pending", pending.Events[^1].Kind);
        Assert.Equal("round_settlement_pending", match.TryEndTurn("bob", 3).Code);
        Assert.Equal("round_settlement_pending", match.TryFreeMove("bob", "einstein", 3).Code);
        Assert.Equal(3, match.Revision);
    }

    [Theory]
    [InlineData("N-01", "N-01")]
    [InlineData("INVALID", "S-01")]
    public void InvalidPreconfiguredStartSlotsAreRejected(string a, string b)
    {
        Assert.Throws<ArgumentException>(() =>
            NewMatch(new("alice", a), new("bob", b)));
    }

    [Fact]
    public void DuplicatePlayerIdsAreRejected()
    {
        Assert.Throws<ArgumentException>(() =>
            NewMatch(new("alice", "N-01"), new("alice", "S-01")));
    }

    [Fact]
    public void MoreThanEightPlayersAreRejected()
    {
        Assert.Throws<ArgumentException>(() => NewMatch(
            Enumerable.Range(1, 9).Select(i =>
                new MatchParticipantSeed($"player-{i}", BoardCatalog.LoadDefault().Slots[i - 1].Id))
            .ToArray()));
    }

    [Fact]
    public void SnapshotsAreCopiedAndCannotModifyMatchState()
    {
        var match = NewMatch();
        var old = match.Snapshot();
        Assert.True(match.TryFreeMove("alice", "planck", 0).Accepted);
        Assert.Equal("gauss", old.Players[0].StreetId);
        Assert.Equal("planck", match.Snapshot().Players[0].StreetId);
        Assert.Single(old.Events);
    }

    [Fact]
    public void TurnOrderRotationIsPureAndMatchesLastFirstRule()
    {
        string[] original = ["a", "b", "c", "d"];
        Assert.Equal(["d", "a", "b", "c"], GameMatch.RotateLastToFirst(original));
        Assert.Equal(["a", "b", "c", "d"], original);
    }
}
