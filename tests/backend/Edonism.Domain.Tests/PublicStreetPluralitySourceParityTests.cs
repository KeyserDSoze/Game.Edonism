using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #167: the React public street-plurality view must be derivable solely from
/// the pre-existing authenticated, audit-verified Domain territory report.
/// The maximum controlled-lot count is not a street title or a victory rule.
/// </summary>
public sealed class PublicStreetPluralitySourceParityTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void AuditedFullDeckStreetOwnersPermitOnlyPublicLotPlurality(int seats)
    {
        var board = BoardCatalog.LoadDefault();
        var ids = Enumerable.Range(0, seats).Select(i => $"player-{i}").ToArray();
        var match = GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), board, ids,
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);
        var genesis = match.Snapshot();
        var report = match.VerifiedPublicTerritoryForActor(ids[0]);
        Assert.NotNull(report);
        Assert.Equal(30, report.TotalSlots);
        Assert.Equal(seats, report.ControlledLots);
        Assert.Equal(7, report.Streets.Count);
        Assert.Equal(30 - seats, report.FreeLots);
        Assert.Equal(0, report.VerifiedRevision);
        Assert.Equal(ids, genesis.TurnOrder);
        Assert.True(match.VerifyPublicAudit().IsValid);

        var expectedSlots = board.Slots.ToDictionary(slot => slot.Id, slot => slot.StreetId,
            StringComparer.Ordinal);
        var totalControlled = 0;
        foreach (var street in report.Streets)
        {
            Assert.Equal(ids, street.Owners.Select(o => o.PlayerId));
            var raw = genesis.ControlledActivities.Where(lot =>
                expectedSlots[lot.SlotId] == street.StreetId).ToArray();
            Assert.Equal(raw.Length, street.ControlledLots);
            Assert.Equal(street.TotalSlots - raw.Length, street.FreeLots);
            var maximum = Math.Max(0, street.Owners.Max(owner => owner.ControlledLots));
            var leaders = maximum == 0
                ? [] : street.Owners.Where(owner => owner.ControlledLots == maximum)
                    .Select(owner => owner.PlayerId).ToArray();
            Assert.Equal(raw.Length == 0, maximum == 0);
            if (maximum == 0) Assert.Empty(leaders);
            else Assert.NotEmpty(leaders);
            Assert.Equal(raw.Length, street.Owners.Sum(owner => owner.ControlledLots));
            Assert.All(street.Owners, owner => Assert.Equal(
                owner.ControlledLots, owner.Standing + owner.Fallen));
            Assert.Equal(raw.Length, street.Standing + street.Fallen);
            totalControlled += street.ControlledLots;
        }
        Assert.Equal(seats, totalControlled);
        // The view must not expose own action cards, opponents' hands or tokens.
        var wire = JsonSerializer.Serialize(report);
        Assert.DoesNotContain("cardIds", wire, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("remainingDrawPile", wire, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", wire, StringComparison.OrdinalIgnoreCase);

        // Free movement changes only the street of the current pawn, never
        // the printed activity owner's current lot or public plurality.
        var current = genesis.Players[0];
        var neighbor = board.Streets.Single(street => street.Id == current.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove(ids[0], neighbor, match.Revision).Accepted);
        var moved = match.VerifiedPublicTerritoryForActor(ids[0]);
        Assert.NotNull(moved);
        Assert.Equal(1, moved.VerifiedRevision);
        Assert.Equal(report.Streets, moved.Streets, new StreetRowComparer());
        Assert.Equal(genesis.ControlledActivities, match.Snapshot().ControlledActivities);
    }

    private sealed class StreetRowComparer : IEqualityComparer<MatchPublicTerritoryStreet>
    {
        public bool Equals(MatchPublicTerritoryStreet? a, MatchPublicTerritoryStreet? b) =>
            a?.StreetId == b?.StreetId
            && a?.ControlledLots == b?.ControlledLots
            && a?.FreeLots == b?.FreeLots
            && a?.Owners.SequenceEqual(b?.Owners ?? []) == true;

        public int GetHashCode(MatchPublicTerritoryStreet row) =>
            HashCode.Combine(row.StreetId, row.ControlledLots, row.FreeLots);
    }
}
