using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// The frontend's controlled-lot render must rely only on these public,
/// server-authored relationships, not on a guessed activity-owner mapping.
/// </summary>
public sealed class PublicControlledLotProjectionTests
{
    private static GameMatch NewFullDeckMatch() =>
        GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(),
            BoardCatalog.LoadDefault(),
            ["alice", "bob"],
            CharacterSetupFixture.Catalog(),
            ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(),
            ActionDeckFixture.ElectionDayId,
            2026);

    [Fact]
    public void FullDeckExposesExactlyOneStartingControlledCardAndStandingHenchmanPerPlayer()
    {
        var board = BoardCatalog.LoadDefault();
        var snapshot = NewFullDeckMatch().Snapshot();

        Assert.Equal(30, snapshot.BoardActivities.Count);
        Assert.Equal(30, snapshot.BoardActivities.Select(c => c.SlotId).Distinct().Count());
        Assert.Equal(2, snapshot.ControlledActivities.Count);
        Assert.Equal(2, snapshot.ControlledActivities.Select(a => a.SlotId).Distinct().Count());
        foreach (var player in snapshot.Players)
        {
            var owned = Assert.Single(snapshot.ControlledActivities,
                control => control.OwnerPlayerId == player.PlayerId);
            var startingCard = Assert.Single(snapshot.BoardActivities,
                card => card.SlotId == owned.SlotId);
            Assert.Equal(player.StartingSlotId, owned.SlotId);
            Assert.Equal(HenchmanPosture.Standing, owned.Posture);
            Assert.Contains(board.Slots, s => s.Id == startingCard.SlotId);
            Assert.Equal(15, player.HenchmenAvailable);
            Assert.Equal(4, player.Atoms); // quoted wages are NOT credited
            var salary = Assert.Single(snapshot.GrossSalaryQuotes,
                quote => quote.PlayerId == player.PlayerId);
            Assert.Equal(2, salary.BaseAtoms);
            Assert.Equal(1, salary.StandingActivityAtoms);
            Assert.Equal(3, salary.GrossAtoms);
        }

        var serialized = JsonSerializer.Serialize(snapshot);
        Assert.DoesNotContain("test:action:", serialized);
        Assert.DoesNotContain(ActionDeckFixture.ElectionDayId, serialized);
    }

    [Fact]
    public void RejectedMovesSuccessfulMovesAndTurnChangeDoNotMutateActivityOwnershipOrGrossQuotes()
    {
        var board = BoardCatalog.LoadDefault();
        var match = NewFullDeckMatch();
        var before = match.Snapshot();
        var alice = before.Players.Single(p => p.PlayerId == "alice");

        var rejected = match.TryFreeMove("alice", "unknown-street", before.Revision);
        Assert.False(rejected.Accepted);
        Assert.Equal("unknown_street", rejected.Code);
        Assert.Equal(0, match.Snapshot().Revision);

        var destination = board.Streets.Single(s => s.Id == alice.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove("alice", destination, 0).Accepted);
        Assert.True(match.TryEndTurn("alice", 1).Accepted);
        var after = match.Snapshot();

        Assert.Equal(2, after.Revision);
        Assert.Equal("bob", after.ActivePlayerId);
        Assert.Equal(destination, after.Players.Single(p => p.PlayerId == "alice").StreetId);
        Assert.Equal(before.BoardActivities, after.BoardActivities);
        Assert.Equal(before.ControlledActivities, after.ControlledActivities);
        Assert.Equal(before.GrossSalaryQuotes, after.GrossSalaryQuotes);
        Assert.Equal(before.Players.Select(p => p.Atoms), after.Players.Select(p => p.Atoms));
    }
}
