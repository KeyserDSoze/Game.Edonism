using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class TacticalOverviewTests
{
    private static GameMatch FullMatch(int count) =>
        GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(),
            Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray(),
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public void EveryActorReceivesOneCoherentAuditVerifiedImmutablePublicBundle(int count)
    {
        var match = FullMatch(count);
        var before = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var state = match.Snapshot();
        foreach (var actor in state.Players)
        {
            var overview = match.VerifiedTacticalOverviewForActor(actor.PlayerId)!;
            Assert.Equal(match.MatchId, overview.MatchId);
            Assert.Equal(actor.PlayerId, overview.PlayerId);
            Assert.Equal(state.Revision, overview.VerifiedRevision);
            Assert.Equal(state.Round, overview.Round);
            Assert.Equal(actor.StreetId, overview.FromStreetId);
            Assert.Equal(count - 1, overview.OtherPlayers.Others.Count);
            Assert.Equal(count - 1, overview.OpponentControlledLots.Routes.Count);
            Assert.Equal(30 - count, overview.Uncontrolled.Routes.Count);
            Assert.Equal(JsonSerializer.Serialize(match.VerifiedUncontrolledRoutesForActor(actor.PlayerId)),
                JsonSerializer.Serialize(overview.Uncontrolled));
            Assert.Equal(JsonSerializer.Serialize(match.VerifiedOtherPlayerRoutesForActor(actor.PlayerId)),
                JsonSerializer.Serialize(overview.OtherPlayers));
            Assert.Equal(JsonSerializer.Serialize(match.VerifiedOpponentControlledLotsForActor(actor.PlayerId)),
                JsonSerializer.Serialize(overview.OpponentControlledLots));
            Assert.Throws<NotSupportedException>(() =>
                ((IList<MatchOtherPlayerRoute>)overview.OtherPlayers.Others).Clear());
            Assert.Throws<NotSupportedException>(() =>
                ((IList<MatchOpponentControlledLotRoute>)overview.OpponentControlledLots.Routes).Clear());
            Assert.Throws<NotSupportedException>(() =>
                ((IList<MatchUncontrolledRoute>)overview.Uncontrolled.Routes).Clear());
            var serialized = JsonSerializer.Serialize(overview);
            foreach (var forbidden in new[] { "CardIds", "DrawPile", "Faction", "Atoms", "Token" })
                Assert.DoesNotContain(forbidden, serialized, StringComparison.OrdinalIgnoreCase);
            foreach (var player in state.Players)
                foreach (var secret in match.PrivateHandForActor(player.PlayerId)!.CardIds)
                    Assert.DoesNotContain(secret, serialized);
        }

        Assert.Null(match.VerifiedTacticalOverviewForActor("intruder"));
        Assert.Equal(before, JsonSerializer.Serialize(match.CaptureCheckpoint()));
    }

    [Fact]
    public void MovePendingRoundAndRestoredCheckpointKeepSameThreePublicViews()
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board,
        [
            new MatchParticipantSeed("alice", "N-01"),
            new MatchParticipantSeed("bob", "S-01")
        ]);
        var initial = match.VerifiedTacticalOverviewForActor("alice")!;
        Assert.Equal(2, initial.OpponentControlledLots.Routes[0].StreetSteps);
        Assert.True(match.TryFreeMove("alice", "main-square", 0).Accepted);
        var moved = match.VerifiedTacticalOverviewForActor("alice")!;
        Assert.Equal(1, moved.VerifiedRevision);
        Assert.Equal("main-square", moved.FromStreetId);
        Assert.Equal(1, moved.OpponentControlledLots.Routes[0].StreetSteps);
        Assert.Equal(0, initial.VerifiedRevision);
        Assert.Equal("gauss", initial.FromStreetId);
        Assert.True(match.TryEndTurn("alice", 1).Accepted);
        Assert.True(match.TryEndTurn("bob", 2).Accepted);
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);

        var restored = GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint());
        var checkpoint = JsonSerializer.Serialize(restored.CaptureCheckpoint());
        foreach (var actor in new[] { "alice", "bob" })
        {
            var pending = match.VerifiedTacticalOverviewForActor(actor)!;
            Assert.Equal(3, pending.VerifiedRevision);
            Assert.Equal(JsonSerializer.Serialize(pending),
                JsonSerializer.Serialize(restored.VerifiedTacticalOverviewForActor(actor)));
        }
        Assert.Equal(checkpoint, JsonSerializer.Serialize(restored.CaptureCheckpoint()));
        Assert.True(restored.VerifyPublicAudit().IsValid);
    }
}
