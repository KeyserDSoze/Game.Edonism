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

    [Fact]
    public void NearbyPublicLotEdgesRemainReadOnlyAndFollowCanonicalFreeMovement()
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board,
        [
            new MatchParticipantSeed("alice", "N-01"),
            new MatchParticipantSeed("bob", "N-02"),
            new MatchParticipantSeed("carol", "W-01"),
            new MatchParticipantSeed("dave", "S-01")
        ]);
        var initialCheckpoint = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var before = match.VerifiedOpponentControlledLotsForActor("alice")!;
        Assert.Equal(new[] { "N-02", "W-01" },
            before.Routes.Where(route => route.StreetSteps <= 1)
                .Select(route => route.SlotId).ToArray());
        Assert.Equal(0, before.Routes.Single(route => route.SlotId == "N-02").StreetSteps);
        Assert.Equal(1, before.Routes.Single(route => route.SlotId == "W-01").StreetSteps);
        Assert.Equal(2, before.Routes.Single(route => route.SlotId == "S-01").StreetSteps);
        Assert.Equal(initialCheckpoint, JsonSerializer.Serialize(match.CaptureCheckpoint()));

        Assert.True(match.TryFreeMove("alice", "main-square", 0).Accepted);
        var movedCheckpoint = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var moved = match.VerifiedOpponentControlledLotsForActor("alice")!;
        Assert.Equal(1, moved.VerifiedRevision);
        Assert.Equal(new[] { "N-02", "S-01" },
            moved.Routes.Where(route => route.StreetSteps <= 1)
                .Select(route => route.SlotId).ToArray());
        Assert.Equal(2, moved.Routes.Single(route => route.SlotId == "W-01").StreetSteps);
        Assert.Equal(movedCheckpoint, JsonSerializer.Serialize(match.CaptureCheckpoint()));
        Assert.True(match.VerifyPublicAudit().IsValid);
    }
    // #89: a browser owner filter is only a grouping of audited PUBLIC
    // owner/slot/path projections, never a permission to attack or purchase.
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void EveryRivalOwnerGroupAndNearbyIntersectionMatchTheAuthoritativePublicBoard(int count)
    {
        var match = FullMatch(count);
        var state = match.Snapshot();
        var board = BoardCatalog.LoadDefault();
        var checkpoint = JsonSerializer.Serialize(match.CaptureCheckpoint());

        foreach (var actor in state.Players)
        {
            var overview = match.VerifiedTacticalOverviewForActor(actor.PlayerId)!;
            Assert.Equal(state.Revision, overview.VerifiedRevision);
            var knownOwners = overview.OtherPlayers.Others
                .Select(other => other.OtherPlayerId).ToHashSet(StringComparer.Ordinal);
            Assert.Equal(count - 1, knownOwners.Count);
            Assert.DoesNotContain(actor.PlayerId, knownOwners);

            var lots = overview.OpponentControlledLots.Routes;
            Assert.All(lots, lot => Assert.Contains(lot.OwnerPlayerId, knownOwners));
            foreach (var rival in knownOwners)
            {
                var all = lots.Where(lot => lot.OwnerPlayerId == rival).ToArray();
                var expected = state.ControlledActivities
                    .Where(lot => lot.OwnerPlayerId == rival)
                    .Select(lot => lot.SlotId).OrderBy(id => id, StringComparer.Ordinal).ToArray();
                Assert.Equal(expected,
                    all.Select(lot => lot.SlotId).OrderBy(id => id, StringComparer.Ordinal));
                foreach (var lot in all)
                {
                    Assert.Equal(board.ShortestStreetPath(actor.StreetId, lot.StreetId),
                        lot.StreetPath);
                    Assert.Equal(lot.StreetPath.Count - 1, lot.StreetSteps);
                    Assert.Contains(state.ControlledActivities,
                        controlled => controlled.SlotId == lot.SlotId
                            && controlled.OwnerPlayerId == rival
                            && controlled.Posture == lot.Posture);
                }

                // Intersect the two independent browser display predicates;
                // filtering must never change order, state, or audit.
                var near = lots.Where(lot => lot.OwnerPlayerId == rival
                    && lot.StreetSteps <= 1).ToArray();
                Assert.Equal(all.Where(lot => lot.StreetSteps <= 1), near);
                Assert.All(near, lot => Assert.InRange(lot.StreetSteps, 0, 1));
            }
        }

        Assert.Equal(checkpoint, JsonSerializer.Serialize(match.CaptureCheckpoint()));
        Assert.True(match.VerifyPublicAudit().IsValid);
    }

    // #90: this UI nearest route is a derived read-only group of the EXACT
    // independently verified public projection; the Domain remains authority.
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void NearestRivalLotUsesCanonicalShortestRouteAndStableTieBreak(int count)
    {
        var match = FullMatch(count);
        var board = BoardCatalog.LoadDefault();
        var state = match.Snapshot();
        var checkpoint = JsonSerializer.Serialize(match.CaptureCheckpoint());

        foreach (var actor in state.Players)
        {
            var overview = match.VerifiedTacticalOverviewForActor(actor.PlayerId)!;
            Assert.Equal(state.Revision, overview.VerifiedRevision);
            var otherIds = overview.OtherPlayers.Others
                .Select(other => other.OtherPlayerId).ToArray();
            Assert.Equal(count - 1, otherIds.Length);
            Assert.DoesNotContain(actor.PlayerId, otherIds);

            foreach (var otherId in otherIds)
            {
                var validPublicRoutes = overview.OpponentControlledLots.Routes
                    .Where(route => route.OwnerPlayerId == otherId).ToArray();

                var canonical = state.ControlledActivities
                    .Where(control => control.OwnerPlayerId == otherId)
                    .Select(control =>
                    {
                        var slot = board.Slots.Single(slot => slot.Id == control.SlotId);
                        var path = board.ShortestStreetPath(actor.StreetId, slot.StreetId)!;
                        return (control.SlotId, StreetSteps: path.Count - 1,
                            StreetPath: path.ToArray());
                    })
                    .OrderBy(route => route.StreetSteps)
                    .ThenBy(route => route.SlotId, StringComparer.Ordinal)
                    .ToArray();

                Assert.Equal(canonical.Length, validPublicRoutes.Length);
                if (canonical.Length == 0)
                {
                    Assert.Empty(validPublicRoutes);
                    continue;
                }
                // The first canonical route is already nearest for that owner
                // because #88 also verifies the full server sorting invariant.
                var nearest = validPublicRoutes[0];
                Assert.Equal(canonical[0].SlotId, nearest.SlotId);
                Assert.Equal(canonical[0].StreetSteps, nearest.StreetSteps);
                Assert.Equal(canonical[0].StreetPath, nearest.StreetPath);

                var nearOnly = validPublicRoutes
                    .Where(route => route.StreetSteps <= 1).ToArray();
                Assert.Equal(canonical.Where(route => route.StreetSteps <= 1)
                    .Select(route => route.SlotId),
                    nearOnly.Select(route => route.SlotId));
                Assert.All(nearOnly, route =>
                    Assert.InRange(route.StreetSteps, 0, 1));
            }
        }

        Assert.Equal(checkpoint, JsonSerializer.Serialize(match.CaptureCheckpoint()));
        Assert.True(match.VerifyPublicAudit().IsValid);
    }

    [Fact]
    public void NearestRivalLotTracksVerifiedRevisionAfterMovementAndRestoration()
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
        Assert.Equal(1, moved.OpponentControlledLots.Routes[0].StreetSteps);
        Assert.Equal(1, moved.VerifiedRevision);
        Assert.Equal(0, initial.VerifiedRevision);
        var stored = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var restored = GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint());
        Assert.Equal(JsonSerializer.Serialize(moved),
            JsonSerializer.Serialize(restored.VerifiedTacticalOverviewForActor("alice")));
        Assert.Equal(stored, JsonSerializer.Serialize(restored.CaptureCheckpoint()));
        Assert.True(restored.VerifyPublicAudit().IsValid);
    }


    // #93: the optional browser posture predicate is only an intersection
    // of the immutable audited PUBLIC routes; no new gameplay permission.
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void VerifiedPublicHenchmanPostureIntersectsOwnerAndNearbyWithoutMutation(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var match = FullMatch(count);
        var state = match.Snapshot();
        var before = JsonSerializer.Serialize(match.CaptureCheckpoint());
        foreach (var actor in state.Players)
        {
            var overview = match.VerifiedTacticalOverviewForActor(actor.PlayerId)!;
            Assert.Equal(state.Revision, overview.VerifiedRevision);
            var all = overview.OpponentControlledLots.Routes;
            var otherIds = overview.OtherPlayers.Others.Select(other => other.OtherPlayerId).ToArray();
            Assert.DoesNotContain(actor.PlayerId, otherIds);

            foreach (var posture in new[] { HenchmanPosture.Standing, HenchmanPosture.Fallen })
            {
                var subset = all.Where(route => route.Posture == posture).ToArray();
                var expectedSlotIds = state.ControlledActivities
                    .Where(lot => lot.OwnerPlayerId != actor.PlayerId
                        && lot.Posture == posture)
                    .Select(lot => lot.SlotId)
                    .OrderBy(id => id, StringComparer.Ordinal);
                Assert.Equal(expectedSlotIds, subset.Select(lot => lot.SlotId)
                    .OrderBy(id => id, StringComparer.Ordinal));

                foreach (var owner in otherIds)
                {
                    var owned = subset.Where(route => route.OwnerPlayerId == owner).ToArray();
                    var nearby = owned.Where(route => route.StreetSteps <= 1).ToArray();
                    Assert.Equal(all.Where(route => route.OwnerPlayerId == owner
                        && route.Posture == posture && route.StreetSteps <= 1), nearby);
                    Assert.Equal(owned.OrderBy(route => route.StreetSteps)
                        .ThenBy(route => route.SlotId, StringComparer.Ordinal), owned);
                    foreach (var route in owned)
                    {
                        Assert.Equal(board.ShortestStreetPath(actor.StreetId, route.StreetId),
                            route.StreetPath);
                        Assert.Equal(route.StreetPath.Count - 1, route.StreetSteps);
                        Assert.Contains(state.ControlledActivities, lot =>
                            lot.SlotId == route.SlotId && lot.OwnerPlayerId == owner
                            && lot.Posture == posture);
                    }
                }
            }
        }
        Assert.Equal(before, JsonSerializer.Serialize(match.CaptureCheckpoint()));
        Assert.True(match.VerifyPublicAudit().IsValid);
    }


    // #94: All street selections are public BOARD IDs; the browser only
    // intersects already-audited routes. Neither route authority nor match
    // state changes when grouping by a particular board street.
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void VerifiedStreetFilterIntersectsRivalOwnerPostureNearbyAndNeverMutatesMatch(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var match = FullMatch(count);
        var state = match.Snapshot();
        var before = JsonSerializer.Serialize(match.CaptureCheckpoint());
        Assert.Equal(7, board.Streets.Count);

        foreach (var actor in state.Players)
        {
            var overview = match.VerifiedTacticalOverviewForActor(actor.PlayerId)!;
            var otherIds = overview.OtherPlayers.Others
                .Select(other => other.OtherPlayerId).ToArray();
            var all = overview.OpponentControlledLots.Routes;
            Assert.Equal(count - 1, otherIds.Length);
            Assert.DoesNotContain(actor.PlayerId, otherIds);
            Assert.Equal(state.Revision, overview.VerifiedRevision);

            foreach (var street in board.Streets)
            {
                var selected = all.Where(route => route.StreetId == street.Id).ToArray();
                var expected = state.ControlledActivities
                    .Where(control => control.OwnerPlayerId != actor.PlayerId
                        && board.Slots.Single(s => s.Id == control.SlotId).StreetId == street.Id)
                    .Select(control => control.SlotId)
                    .OrderBy(id => id, StringComparer.Ordinal);
                Assert.Equal(expected, selected.Select(route => route.SlotId)
                    .OrderBy(id => id, StringComparer.Ordinal));
                Assert.All(selected, route =>
                {
                    Assert.Contains(route.OwnerPlayerId, otherIds);
                    Assert.Equal(street.Id, board.Slots.Single(s => s.Id == route.SlotId).StreetId);
                    Assert.Equal(board.ShortestStreetPath(actor.StreetId, street.Id),
                        route.StreetPath);
                    Assert.Equal(route.StreetPath.Count - 1, route.StreetSteps);
                });
                foreach (var owner in otherIds)
                foreach (var posture in new[] { HenchmanPosture.Standing, HenchmanPosture.Fallen })
                {
                    var sameOwnerAndPosture = selected.Where(route =>
                        route.OwnerPlayerId == owner && route.Posture == posture).ToArray();
                    var nearby = sameOwnerAndPosture
                        .Where(route => route.StreetSteps <= 1).ToArray();
                    Assert.Equal(all.Where(route => route.StreetId == street.Id
                        && route.OwnerPlayerId == owner && route.Posture == posture
                        && route.StreetSteps <= 1), nearby);
                    Assert.Equal(sameOwnerAndPosture.OrderBy(route => route.StreetSteps)
                        .ThenBy(route => route.SlotId, StringComparer.Ordinal),
                        sameOwnerAndPosture);
                }
            }
            // The city hall/main square has no activity slots to control.
            Assert.Empty(all.Where(route => route.StreetId == "main-square"));
            Assert.DoesNotContain(all, route => route.StreetId == "unmapped-road");
        }
        Assert.Equal(before, JsonSerializer.Serialize(match.CaptureCheckpoint()));
        Assert.True(match.VerifyPublicAudit().IsValid);
    }

}
