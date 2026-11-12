using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class OpponentControlledLotsTests
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
    public void AllOtherControlledLotsHaveAuditedCanonicalImmutablePaths(int count)
    {
        var match = FullMatch(count);
        var board = BoardCatalog.LoadDefault();
        var original = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var state = match.Snapshot();

        foreach (var actor in state.Players)
        {
            var projection = match.VerifiedOpponentControlledLotsForActor(actor.PlayerId)!;
            Assert.Equal(match.MatchId, projection.MatchId);
            Assert.Equal(actor.PlayerId, projection.PlayerId);
            Assert.Equal(actor.StreetId, projection.FromStreetId);
            Assert.Equal(state.Revision, projection.VerifiedRevision);
            Assert.Equal(count - 1, projection.Routes.Count);
            Assert.Equal(count - 1, projection.Routes.Select(r => r.SlotId).Distinct().Count());
            Assert.DoesNotContain(projection.Routes, r => r.OwnerPlayerId == actor.PlayerId);
            Assert.Equal(projection.Routes.OrderBy(r => r.StreetSteps)
                .ThenBy(r => r.OwnerPlayerId, StringComparer.Ordinal)
                .ThenBy(r => r.SlotId, StringComparer.Ordinal), projection.Routes);

            foreach (var route in projection.Routes)
            {
                var control = Assert.Single(state.ControlledActivities,
                    c => c.SlotId == route.SlotId);
                Assert.Equal(control.OwnerPlayerId, route.OwnerPlayerId);
                Assert.Equal(control.Posture, route.Posture);
                Assert.Equal(board.Slots.Single(s => s.Id == route.SlotId).StreetId,
                    route.StreetId);
                Assert.Equal(board.ShortestStreetPath(actor.StreetId, route.StreetId),
                    route.StreetPath);
                Assert.Equal(route.StreetPath.Count - 1, route.StreetSteps);
                Assert.Throws<NotSupportedException>(() =>
                    ((IList<string>)route.StreetPath)[0] = "fake");
            }

            Assert.Throws<NotSupportedException>(() =>
                ((IList<MatchOpponentControlledLotRoute>)projection.Routes).Clear());
            var json = JsonSerializer.Serialize(projection);
            Assert.DoesNotContain("cardIds", json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("faction", json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("atoms", json, StringComparison.OrdinalIgnoreCase);
            foreach (var hand in state.Players.Select(p =>
                match.PrivateHandForActor(p.PlayerId)!.CardIds))
                foreach (var secret in hand)
                    Assert.DoesNotContain(secret, json);
        }
        Assert.Null(match.VerifiedOpponentControlledLotsForActor("outsider"));
        Assert.Equal(original, JsonSerializer.Serialize(match.CaptureCheckpoint()));
    }

    [Fact]
    public void MoveTurnAndCheckpointRestoreKeepReadOnlyPublicLotPathsConsistent()
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board,
        [
            new MatchParticipantSeed("alice", "N-01"),
            new MatchParticipantSeed("bob", "S-01")
        ]);
        var before = match.VerifiedOpponentControlledLotsForActor("alice")!;
        var bobLot = Assert.Single(before.Routes);
        Assert.Equal("S-01", bobLot.SlotId);
        Assert.Equal("bob", bobLot.OwnerPlayerId);
        Assert.Equal(HenchmanPosture.Standing, bobLot.Posture);
        Assert.Equal(2, bobLot.StreetSteps);

        Assert.True(match.TryFreeMove("alice", "main-square", 0).Accepted);
        var moved = match.VerifiedOpponentControlledLotsForActor("alice")!;
        Assert.Equal(1, moved.VerifiedRevision);
        Assert.Equal(1, Assert.Single(moved.Routes).StreetSteps);
        Assert.True(match.TryEndTurn("alice", 1).Accepted);
        Assert.True(match.TryEndTurn("bob", 2).Accepted);
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);

        var restored = GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint());
        foreach (var actor in new[] { "alice", "bob" })
            Assert.Equal(JsonSerializer.Serialize(match.VerifiedOpponentControlledLotsForActor(actor)),
                JsonSerializer.Serialize(restored.VerifiedOpponentControlledLotsForActor(actor)));
        Assert.Equal(3, restored.Revision);
        Assert.True(restored.VerifyPublicAudit().IsValid);
    }
}
