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

    // #149: The city must expose ALL already-public but unowned printed
    // activity cards; it is not a purchase command or a client-generated deck.
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void CompletePrintedBoardPublicUncontrolledCardsMatchAuditedDomainRoutes(int count)
    {
        var match = NewMatch(count);
        var board = BoardCatalog.LoadDefault();
        var before = match.Snapshot();
        var secretBefore = JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal);
        Assert.Equal(30, before.BoardActivities.Count);
        Assert.Equal(30, before.BoardActivities.Select(c => c.SlotId)
            .Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(30, before.BoardActivities.Select(c => c.CardId)
            .Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(count, before.ControlledActivities.Count);

        var quotas = new Dictionary<string, int>(StringComparer.Ordinal)
        {
            ["public-financing"] = 5, ["private-financing"] = 5,
            ["black-market"] = 4, ["corruption"] = 4,
            ["culture"] = 4, ["sport"] = 2,
            ["transport"] = 3, ["bishopric"] = 3,
        };
        Assert.Equal(quotas.Count,
            before.BoardActivities.Select(c => c.Category).Distinct().Count());
        foreach (var (category, expected) in quotas)
            Assert.Equal(expected, before.BoardActivities.Count(c => c.Category == category));

        static string[] PublicFreeSlots(GameMatch game, Edonism.Domain.World.BoardDefinition map)
        {
            var state = game.Snapshot();
            var occupied = state.ControlledActivities.Select(c => c.SlotId)
                .ToHashSet(StringComparer.Ordinal);
            return map.Slots.Where(s => !occupied.Contains(s.Id))
                .Select(s => s.Id).ToArray();
        }

        void AssertPublicAtlas()
        {
            var state = match.Snapshot();
            var free = PublicFreeSlots(match, board);
            Assert.Equal(30 - count, free.Length);
            Assert.Equal(free.Length, free.Distinct(StringComparer.Ordinal).Count());
            foreach (var player in state.Players)
            {
                var routes = Assert.IsType<MatchUncontrolledRoutes>(
                    match.VerifiedUncontrolledRoutesForActor(player.PlayerId));
                var routeIds = routes.Routes.Select(route => route.SlotId)
                    .OrderBy(id => id, StringComparer.Ordinal).ToArray();
                Assert.Equal(free.OrderBy(id => id, StringComparer.Ordinal), routeIds);
                foreach (var slotId in free)
                {
                    var card = Assert.Single(state.BoardActivities,
                        c => c.SlotId == slotId);
                    var route = Assert.Single(routes.Routes,
                        route => route.SlotId == slotId);
                    Assert.Equal(card.CardId, route.CardId);
                    Assert.Equal(card.Category, route.Category);
                    Assert.Equal(board.Slots.Single(s => s.Id == slotId).StreetId,
                        route.StreetId);
                }
            }
            var publicJson = JsonSerializer.Serialize(state);
            foreach (var player in state.Players)
                foreach (var card in match.PrivateHandForActor(player.PlayerId)!.CardIds)
                    Assert.DoesNotContain(card, publicJson, StringComparison.Ordinal);
            Assert.DoesNotContain("RemainingDrawPile", publicJson, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("PrivateDeal", publicJson, StringComparison.OrdinalIgnoreCase);
            Assert.Equal(secretBefore, JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal));
            Assert.True(match.VerifyPublicAudit().IsValid);
        }

        AssertPublicAtlas();
        var actor = before.Players[0];
        var next = board.Streets.Single(s => s.Id == actor.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove(actor.PlayerId, next, match.Revision).Accepted);
        AssertPublicAtlas();
        Assert.True(match.TryEndTurn(actor.PlayerId, match.Revision).Accepted);
        AssertPublicAtlas();
        Assert.Equal(before.BoardActivities, match.Snapshot().BoardActivities);
        Assert.Equal(before.ControlledActivities, match.Snapshot().ControlledActivities);
    }

    // #150: category/street filters are read-only client display, derived
    // strictly from the complete public cards. Assert the underlying Domain
    // projection has the same canonical data for every street/category pair.
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void EveryPrintedStreetAndCategorySubsetMatchesPublicAuditedUnownedCards(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var match = NewMatch(count);
        var state = match.Snapshot();
        var checkpoint = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var controlled = state.ControlledActivities.Select(x => x.SlotId)
            .ToHashSet(StringComparer.Ordinal);
        var free = state.BoardActivities
            .Where(x => !controlled.Contains(x.SlotId)).ToArray();
        var categoryIds = new[] {
            "public-financing", "private-financing", "black-market",
            "corruption", "culture", "sport", "transport", "bishopric",
        };
        Assert.Equal(30 - count, free.Length);

        foreach (var actor in state.Players)
        {
            var routes = Assert.IsType<MatchUncontrolledRoutes>(
                match.VerifiedUncontrolledRoutesForActor(actor.PlayerId));
            foreach (var street in board.Streets)
            {
                foreach (var categoryId in categoryIds)
                {
                    var expected = free.Where(c => c.Category == categoryId
                        && board.Slots.Single(slot => slot.Id == c.SlotId).StreetId == street.Id)
                        .Select(x => x.SlotId).OrderBy(x => x, StringComparer.Ordinal).ToArray();
                    var actual = routes.Routes.Where(x => x.Category == categoryId
                        && x.StreetId == street.Id)
                        .Select(x => x.SlotId).OrderBy(x => x, StringComparer.Ordinal).ToArray();
                    Assert.Equal(expected, actual);
                }
            }
        }
        Assert.Equal(checkpoint, JsonSerializer.Serialize(match.CaptureCheckpoint()));
        Assert.Equal(0, match.Revision);
        Assert.True(match.VerifyPublicAudit().IsValid);
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
