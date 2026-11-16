using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class PublicTerritoryReportTests
{
    private static GameMatch FullMatch(int count) =>
        GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(),
            Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray(),
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void VerifiedPublicTerritoryBalancesAllOwnersAcrossTheRound(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var match = FullMatch(count);
        var state = match.Snapshot();
        var privateBefore = JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal);
        var cardsBefore = JsonSerializer.Serialize(state.BoardActivities);
        var ownershipBefore = JsonSerializer.Serialize(state.ControlledActivities);

        void Verify()
        {
            var snapshot = match.Snapshot();
            foreach (var actor in snapshot.Players)
            {
                var report = Assert.IsType<MatchPublicTerritoryReport>(
                    match.VerifiedPublicTerritoryForActor(actor.PlayerId));
                Assert.Equal(match.MatchId, report.MatchId);
                Assert.Equal(actor.PlayerId, report.PlayerId);
                Assert.Equal(snapshot.Revision, report.VerifiedRevision);
                Assert.Equal(1, report.Round);
                Assert.Equal(30, report.TotalSlots);
                Assert.Equal(count, report.ControlledLots);
                Assert.Equal(30 - count, report.FreeLots);
                Assert.Equal(board.Streets.Select(street => street.Id),
                    report.Streets.Select(street => street.StreetId));

                foreach (var street in report.Streets)
                {
                    var original = board.Streets.Single(s => s.Id == street.StreetId);
                    var slots = board.Slots.Where(slot => slot.StreetId == street.StreetId)
                        .Select(slot => slot.Id).ToHashSet(StringComparer.Ordinal);
                    var held = snapshot.ControlledActivities
                        .Where(lot => slots.Contains(lot.SlotId)).ToArray();
                    Assert.Equal(original.Name, street.StreetName);
                    Assert.Equal(slots.Count, street.TotalSlots);
                    Assert.Equal(held.Length, street.ControlledLots);
                    Assert.Equal(slots.Count - held.Length, street.FreeLots);
                    Assert.Equal(held.Count(lot => lot.Posture == HenchmanPosture.Standing),
                        street.Standing);
                    Assert.Equal(held.Count(lot => lot.Posture == HenchmanPosture.Fallen),
                        street.Fallen);
                    Assert.Equal(snapshot.Players.Select(p => p.PlayerId),
                        street.Owners.Select(owner => owner.PlayerId));
                    Assert.Equal(street.DistinctOwnerCount >= 2, street.IsShared);
                    Assert.Equal(street.DistinctOwnerCount,
                        held.Select(lot => lot.OwnerPlayerId)
                            .Distinct(StringComparer.Ordinal).Count());
                    Assert.Equal(held.Length, street.Owners.Sum(owner => owner.ControlledLots));
                    foreach (var owner in street.Owners)
                    {
                        var own = held.Where(lot => lot.OwnerPlayerId == owner.PlayerId).ToArray();
                        Assert.Equal(own.Length, owner.ControlledLots);
                        Assert.Equal(own.Count(lot => lot.Posture == HenchmanPosture.Standing),
                            owner.Standing);
                        Assert.Equal(own.Count(lot => lot.Posture == HenchmanPosture.Fallen),
                            owner.Fallen);
                    }
                }
                // #159: every player, including any with zero lots, comes
                // solely from the same Domain-authenticated 7-street matrix.
                var totals = snapshot.Players.Select(player =>
                {
                    var held = snapshot.ControlledActivities
                        .Where(lot => lot.OwnerPlayerId == player.PlayerId).ToArray();
                    var occupied = held.Select(lot =>
                        board.Slots.Single(slot => slot.Id == lot.SlotId).StreetId)
                        .Distinct(StringComparer.Ordinal).Count();
                    return new MatchPublicTerritoryFootprintTotals(
                        player.PlayerId, held.Length,
                        held.Count(lot => lot.Posture == HenchmanPosture.Standing),
                        held.Count(lot => lot.Posture == HenchmanPosture.Fallen),
                        occupied);
                }).ToArray();
                var expected = PublicTerritoryFootprintOrdering.Rank(totals);
                Assert.Equal(expected, report.Footprints);
                Assert.Equal(count, report.Footprints.Count);
                Assert.All(report.Footprints, item => Assert.Equal(1, item.Place));
                Assert.All(report.Footprints, item => Assert.Equal(1, item.ControlledLots));
                Assert.All(report.Footprints, item => Assert.Equal(1, item.OccupiedStreets));
                Assert.Equal(count, report.Footprints.Sum(item => item.ControlledLots));
                Assert.Throws<NotSupportedException>(() =>
                    ((IList<MatchPublicTerritoryFootprint>)report.Footprints).Clear());
                Assert.Equal(report.SharedStreetCount, report.Streets.Count(s => s.IsShared));
                Assert.Equal(30, report.Streets.Sum(s => s.TotalSlots));
                Assert.Equal(count, report.Streets.Sum(s => s.ControlledLots));
                Assert.Throws<NotSupportedException>(() =>
                    ((IList<MatchPublicTerritoryStreet>)report.Streets).Clear());
                Assert.Throws<NotSupportedException>(() =>
                    ((IList<MatchPublicTerritoryOwner>)report.Streets[0].Owners).Clear());
                var rivals = Assert.IsType<MatchOpponentControlledLotRoutes>(
                    match.VerifiedOpponentControlledLotsForActor(actor.PlayerId));
                Assert.Equal(report.ControlledLots -
                    snapshot.ControlledActivities.Count(lot => lot.OwnerPlayerId == actor.PlayerId),
                    rivals.Routes.Count);
                var wire = JsonSerializer.Serialize(report);
                Assert.DoesNotContain("cardId", wire, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("token", wire, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("atoms", wire, StringComparison.OrdinalIgnoreCase);
                foreach (var seat in snapshot.Players)
                    foreach (var secret in match.PrivateHandForActor(seat.PlayerId)!.CardIds)
                        Assert.DoesNotContain(secret, wire, StringComparison.Ordinal);
            }
            Assert.Null(match.VerifiedPublicTerritoryForActor("intruder"));
            Assert.Equal(cardsBefore, JsonSerializer.Serialize(snapshot.BoardActivities));
            Assert.Equal(ownershipBefore, JsonSerializer.Serialize(snapshot.ControlledActivities));
            Assert.Equal(privateBefore, JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal));
            Assert.True(match.VerifyPublicAudit().IsValid);
        }

        Verify();
        var first = state.Players[0];
        var neighbor = board.Streets.Single(s => s.Id == first.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove(first.PlayerId, neighbor, match.Revision).Accepted);
        Verify();
        foreach (var player in state.Players)
        {
            Assert.True(match.TryEndTurn(player.PlayerId, match.Revision).Accepted);
            Verify();
        }
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);

        var restored = GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint());
        foreach (var actor in state.Players)
            Assert.Equal(JsonSerializer.Serialize(match.VerifiedPublicTerritoryForActor(actor.PlayerId)),
                JsonSerializer.Serialize(restored.VerifiedPublicTerritoryForActor(actor.PlayerId)));
    }

    [Fact]
    public void PartialLegacyFixtureNeverClaimsSevenAuthoritativeStreets()
    {
        var match = GameMatch.CreateFromTrustedSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(),
            [new MatchParticipantSeed("alice", "N-01"),
             new MatchParticipantSeed("bob", "S-01")]);
        Assert.True(match.VerifyPublicAudit().IsValid);
        Assert.Null(match.VerifiedPublicTerritoryForActor("alice"));
        Assert.Null(match.VerifiedPublicTerritoryForActor("bob"));
        Assert.Null(match.VerifiedPublicTerritoryForActor("intruder"));
        Assert.Equal(0, match.Revision);
    }
}
