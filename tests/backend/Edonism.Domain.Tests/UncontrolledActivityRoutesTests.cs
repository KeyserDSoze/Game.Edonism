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

    // #151: client street-count shortcuts are derived from canonical public
    // uncontrolled cards. All routes for any authenticated actor must agree
    // with the SAME board-wide counts across moves and turn rotation.
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void FreePublicActivityStreetCountsAgreeForAllSeatsAfterMoveAndEndTurn(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var match = NewMatch(count);
        var checkpointSecret = JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal);
        var genesis = match.Snapshot();
        var originalCards = JsonSerializer.Serialize(genesis.BoardActivities);
        var originalControls = JsonSerializer.Serialize(genesis.ControlledActivities);

        void AssertStreetCounts()
        {
            var state = match.Snapshot();
            var owned = state.ControlledActivities.Select(control => control.SlotId)
                .ToHashSet(StringComparer.Ordinal);
            var free = state.BoardActivities.Where(card => !owned.Contains(card.SlotId)).ToArray();
            Assert.Equal(30 - count, free.Length);
            var byStreet = board.Streets.Select(street =>
                (street.Id, Count: free.Count(card =>
                    board.Slots.Single(slot => slot.Id == card.SlotId).StreetId == street.Id)))
                .ToArray();
            Assert.Equal(7, byStreet.Length);
            Assert.Equal(30 - count, byStreet.Sum(row => row.Count));
            foreach (var actor in state.Players)
            {
                var plan = Assert.IsType<MatchUncontrolledRoutes>(
                    match.VerifiedUncontrolledRoutesForActor(actor.PlayerId));
                Assert.Equal(state.Revision, plan.VerifiedRevision);
                foreach (var (streetId, expected) in byStreet)
                    Assert.Equal(expected, plan.Routes.Count(route =>
                        route.StreetId == streetId));
            }
            Assert.Equal(originalCards, JsonSerializer.Serialize(state.BoardActivities));
            Assert.Equal(originalControls, JsonSerializer.Serialize(state.ControlledActivities));
            Assert.Equal(checkpointSecret, JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal));
            Assert.True(match.VerifyPublicAudit().IsValid);
        }

        AssertStreetCounts();
        var actorId = genesis.Players[0].PlayerId;
        var origin = genesis.Players[0].StreetId;
        var neighboringStreet = board.Streets.Single(s => s.Id == origin).Neighbors[0];
        Assert.True(match.TryFreeMove(actorId, neighboringStreet, match.Revision).Accepted);
        AssertStreetCounts();
        Assert.True(match.TryEndTurn(actorId, match.Revision).Accepted);
        AssertStreetCounts();
    }

    // #152: show ownership, deployed henchman posture and *free* lots on
    // each printed road, from the same audited .NET public snapshot only.
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void PublicStreetControlMatrixBalancesAllLotsAndOwnersAcrossTurn(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var match = NewMatch(count);
        var before = match.Snapshot();
        var privateBefore = JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal);
        var cardsBefore = JsonSerializer.Serialize(before.BoardActivities);
        var controlsBefore = JsonSerializer.Serialize(before.ControlledActivities);

        void Verify()
        {
            var state = match.Snapshot();
            Assert.Equal(30, state.BoardActivities.Count);
            Assert.Equal(count, state.ControlledActivities.Count);
            var occupiedIds = state.ControlledActivities
                .Select(lot => lot.SlotId).ToHashSet(StringComparer.Ordinal);
            var free = state.BoardActivities
                .Where(card => !occupiedIds.Contains(card.SlotId)).ToArray();
            Assert.Equal(30 - count, free.Length);

            foreach (var actor in state.Players)
            {
                var publicFree = Assert.IsType<MatchUncontrolledRoutes>(
                    match.VerifiedUncontrolledRoutesForActor(actor.PlayerId));
                var publicOpponents = Assert.IsType<MatchOpponentControlledLotRoutes>(
                    match.VerifiedOpponentControlledLotsForActor(actor.PlayerId));
                Assert.Equal(free.Length, publicFree.Routes.Count);
                Assert.Equal(count - 1, publicOpponents.Routes.Count);
                foreach (var street in board.Streets)
                {
                    var slots = board.Slots.Where(slot => slot.StreetId == street.Id)
                        .Select(slot => slot.Id).ToHashSet(StringComparer.Ordinal);
                    var controlled = state.ControlledActivities
                        .Where(lot => slots.Contains(lot.SlotId)).ToArray();
                    var unowned = free.Where(card => slots.Contains(card.SlotId)).ToArray();
                    var standing = controlled.Count(lot =>
                        lot.Posture == HenchmanPosture.Standing);
                    var fallen = controlled.Count(lot =>
                        lot.Posture == HenchmanPosture.Fallen);
                    Assert.Equal(slots.Count, controlled.Length + unowned.Length);
                    Assert.Equal(controlled.Length, standing + fallen);
                    Assert.Equal(unowned.Length, publicFree.Routes.Count(route =>
                        route.StreetId == street.Id));
                    Assert.Equal(controlled.Count(lot => lot.OwnerPlayerId != actor.PlayerId),
                        publicOpponents.Routes.Count(route => route.StreetId == street.Id));
                    foreach (var owner in state.Players)
                    {
                        var ownerLots = controlled
                            .Where(lot => lot.OwnerPlayerId == owner.PlayerId).ToArray();
                        var ownerStanding = ownerLots.Count(lot =>
                            lot.Posture == HenchmanPosture.Standing);
                        var ownerFallen = ownerLots.Count(lot =>
                            lot.Posture == HenchmanPosture.Fallen);
                        Assert.Equal(ownerLots.Length, ownerStanding + ownerFallen);
                        if (owner.PlayerId != actor.PlayerId)
                        {
                            Assert.Equal(ownerLots.Length, publicOpponents.Routes.Count(route =>
                                route.StreetId == street.Id && route.OwnerPlayerId == owner.PlayerId));
                        }
                    }
                }
                var projection = JsonSerializer.Serialize(publicOpponents);
                foreach (var hand in state.Players)
                    foreach (var cardId in match.PrivateHandForActor(hand.PlayerId)!.CardIds)
                        Assert.DoesNotContain(cardId, projection, StringComparison.Ordinal);
            }
            Assert.Equal(cardsBefore, JsonSerializer.Serialize(state.BoardActivities));
            Assert.Equal(controlsBefore, JsonSerializer.Serialize(state.ControlledActivities));
            Assert.Equal(privateBefore, JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal));
            Assert.True(match.VerifyPublicAudit().IsValid);
        }

        Verify();
        var activeId = before.Players[0].PlayerId;
        var origin = before.Players[0].StreetId;
        var neighbor = board.Streets.Single(street => street.Id == origin).Neighbors[0];
        Assert.True(match.TryFreeMove(activeId, neighbor, match.Revision).Accepted);
        Verify();
        Assert.True(match.TryEndTurn(activeId, match.Revision).Accepted);
        Verify();
    }

    // #153: browser standings compare PUBLIC territory only. Every actor
    // starts with one controlled lot and one standing henchman in the
    // authentic full-deck first-round fixture; all 2/4/8 actors have an
    // honest tie by count, regardless of other public resources/secret cards.
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void PublicTerritoryFootprintsHaveSharedOneLotPositionAcrossTurn(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var match = NewMatch(count);
        var before = match.Snapshot();
        var checkpoint = JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal);
        var publicLots = JsonSerializer.Serialize(before.ControlledActivities);

        void Verify()
        {
            var state = match.Snapshot();
            Assert.Equal(count, state.Players.Count);
            Assert.Equal(30, state.BoardActivities.Count);
            Assert.Equal(count, state.ControlledActivities.Count);
            var footprints = state.Players.Select(player =>
            {
                var own = state.ControlledActivities
                    .Where(lot => lot.OwnerPlayerId == player.PlayerId).ToArray();
                var streets = own.Select(lot =>
                    board.Slots.Single(slot => slot.Id == lot.SlotId).StreetId)
                    .Distinct(StringComparer.Ordinal).ToArray();
                var standing = own.Count(lot =>
                    lot.Posture == HenchmanPosture.Standing);
                var fallen = own.Count(lot =>
                    lot.Posture == HenchmanPosture.Fallen);
                Assert.Equal(own.Length, standing + fallen);
                Assert.Single(own);
                Assert.Single(streets);
                Assert.Equal(1, standing);
                Assert.Equal(0, fallen);
                return (player.PlayerId, Controlled: own.Length,
                    Standing: standing, Fallen: fallen, Streets: streets.Length);
            }).OrderByDescending(item => item.Controlled)
              .ThenBy(item => item.PlayerId, StringComparer.Ordinal).ToArray();
            Assert.Equal(count, footprints.Length);
            Assert.Equal(state.Players.Select(p => p.PlayerId)
                .Order(StringComparer.Ordinal),
                footprints.Select(p => p.PlayerId));
            Assert.All(footprints, item => Assert.Equal(1, item.Controlled));
            foreach (var actor in state.Players)
            {
                var opponents = Assert.IsType<MatchOpponentControlledLotRoutes>(
                    match.VerifiedOpponentControlledLotsForActor(actor.PlayerId));
                Assert.Equal(count - 1, opponents.Routes.Count);
                foreach (var rival in state.Players.Where(p => p.PlayerId != actor.PlayerId))
                    Assert.Single(opponents.Routes,
                        route => route.OwnerPlayerId == rival.PlayerId);
                var serialized = JsonSerializer.Serialize(opponents);
                foreach (var seat in state.Players)
                    foreach (var secret in match.PrivateHandForActor(seat.PlayerId)!.CardIds)
                        Assert.DoesNotContain(secret, serialized, StringComparison.Ordinal);
            }
            Assert.Equal(count, footprints.Sum(x => x.Controlled));
            Assert.Equal(publicLots, JsonSerializer.Serialize(state.ControlledActivities));
            Assert.Equal(checkpoint, JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal));
            Assert.True(match.VerifyPublicAudit().IsValid);
        }

        Verify();
        var actorId = before.Players[0].PlayerId;
        var origin = before.Players[0].StreetId;
        var adjacent = board.Streets.Single(s => s.Id == origin).Neighbors[0];
        Assert.True(match.TryFreeMove(actorId, adjacent, match.Revision).Accepted);
        Verify();
        Assert.True(match.TryEndTurn(actorId, match.Revision).Accepted);
        Verify();
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
