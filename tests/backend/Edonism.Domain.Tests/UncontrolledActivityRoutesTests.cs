using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class UncontrolledActivityRoutesTests
{
    private static GameMatch NewMatch(int playerCount)
    {
        var ids = Enumerable.Range(0, playerCount)
            .Select(i => $"player-{i}").ToArray();
        return GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(), ids,
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void AllUncontrolledActivitiesAreSortedByVerifiedActorStreetDistance(int playerCount)
    {
        var match = NewMatch(playerCount);
        var board = BoardCatalog.LoadDefault();
        var original = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var state = match.Snapshot();
        var occupied = state.ControlledActivities.Select(a => a.SlotId)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var player in state.Players)
        {
            var plan = match.VerifiedUncontrolledRoutesForActor(player.PlayerId)!;
            Assert.Equal(match.MatchId, plan.MatchId);
            Assert.Equal(player.PlayerId, plan.PlayerId);
            Assert.Equal(1, plan.Round);
            Assert.Equal(0, plan.VerifiedRevision);
            Assert.Equal(player.StreetId, plan.FromStreetId);
            Assert.Equal(30 - playerCount, plan.Routes.Count);
            Assert.Equal(plan.Routes.Count, plan.Routes.Select(a => a.SlotId).Distinct().Count());
            Assert.All(plan.Routes, route =>
            {
                var card = Assert.Single(state.BoardActivities, a => a.SlotId == route.SlotId);
                Assert.DoesNotContain(route.SlotId, occupied);
                Assert.Equal(card.CardId, route.CardId);
                Assert.Equal(card.Category, route.Category);
                var slot = Assert.Single(board.Slots, a => a.Id == route.SlotId);
                Assert.Equal(slot.StreetId, route.StreetId);
                Assert.Equal(board.ShortestStreetDistance(player.StreetId, route.StreetId),
                    route.StreetSteps);
                Assert.Equal(route.StreetSteps + 1, route.StreetPath.Count);
                Assert.Equal(board.ShortestStreetPath(player.StreetId, route.StreetId),
                    route.StreetPath);
                Assert.Throws<NotSupportedException>(() =>
                    ((IList<string>)route.StreetPath)[0] = "forged");
            });
            Assert.Equal(plan.Routes.OrderBy(a => a.StreetSteps)
                .ThenBy(a => a.SlotId, StringComparer.Ordinal), plan.Routes);
            Assert.Throws<NotSupportedException>(() =>
                ((IList<MatchUncontrolledRoute>)plan.Routes).Clear());
            var json = JsonSerializer.Serialize(plan);
            foreach (var secret in match.PrivateHandForActor(player.PlayerId)!.CardIds)
                Assert.DoesNotContain(secret, json);
            Assert.DoesNotContain("Atoms", json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("Token", json, StringComparison.OrdinalIgnoreCase);
        }
        Assert.Null(match.VerifiedUncontrolledRoutesForActor("intruder"));
        Assert.Equal(original, JsonSerializer.Serialize(match.CaptureCheckpoint()));
    }

    [Fact]
    public void MovementChangesOnlyCurrentActorRoutesAndNeverGrantsPurchaseCommands()
    {
        var match = NewMatch(2);
        var board = BoardCatalog.LoadDefault();
        var first = match.Snapshot().Players[0];
        var before = match.VerifiedUncontrolledRoutesForActor(first.PlayerId)!;
        var bobBefore = match.VerifiedUncontrolledRoutesForActor("player-1")!;
        Assert.Contains(before.Routes, a => a.StreetSteps == 0);

        var destination = board.Streets.Single(s => s.Id == first.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove(first.PlayerId, destination, 0).Accepted);
        var after = match.VerifiedUncontrolledRoutesForActor(first.PlayerId)!;
        var bobAfter = match.VerifiedUncontrolledRoutesForActor("player-1")!;
        Assert.Equal(1, after.VerifiedRevision);
        Assert.Equal(destination, after.FromStreetId);
        Assert.All(after.Routes, route =>
            Assert.Equal(destination, route.StreetPath[0]));
        Assert.Equal(before.Routes.Select(r => r.SlotId).Order(StringComparer.Ordinal),
            after.Routes.Select(r => r.SlotId).Order(StringComparer.Ordinal));
        // StreetPath is an immutable collection: record equality compares its
        // reference, not path contents. Verify the public wire projection.
        Assert.Equal(JsonSerializer.Serialize(bobBefore.Routes),
            JsonSerializer.Serialize(bobAfter.Routes));
        Assert.Equal(1, bobAfter.VerifiedRevision);
        Assert.True(match.TryEndTurn(first.PlayerId, 1).Accepted);
        Assert.True(match.TryEndTurn("player-1", 2).Accepted);
        var pending = match.VerifiedUncontrolledRoutesForActor(first.PlayerId)!;
        Assert.Equal(3, pending.VerifiedRevision);
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Snapshot().Phase);
        Assert.Equal(4, match.Snapshot().Players[0].Atoms);
        Assert.Equal(30, match.Snapshot().BoardActivities.Count);
    }

    [Fact]
    public void CheckpointRecoveryKeepsSamePublicRoutePlanAndPrivateHandUnchanged()
    {
        var source = NewMatch(2);
        var originalHand = source.PrivateHandForActor("player-0")!.CardIds.ToArray();
        Assert.True(source.TryEndTurn("player-0", 0).Accepted);
        var expected = source.VerifiedUncontrolledRoutesForActor("player-1");
        var restored = GameMatch.RestoreFromCheckpoint(
            BoardCatalog.LoadDefault(), source.CaptureCheckpoint());
        var actual = restored.VerifiedUncontrolledRoutesForActor("player-1");
        Assert.NotNull(actual);
        Assert.Equal(JsonSerializer.Serialize(expected), JsonSerializer.Serialize(actual));
        Assert.Equal(originalHand, restored.PrivateHandForActor("player-0")!.CardIds);
        Assert.Equal(1, restored.Revision);
    }

    [Fact]
    public void MinimalTrustedFixtureDoesNotInventMissingPublicCards()
    {
        var match = GameMatch.CreateFromTrustedSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(),
            [new MatchParticipantSeed("alice", "N-01"),
             new MatchParticipantSeed("bob", "S-01")]);
        var plan = match.VerifiedUncontrolledRoutesForActor("alice")!;
        Assert.Empty(plan.Routes);
        Assert.Equal(0, plan.VerifiedRevision);
    }
}
