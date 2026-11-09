using Edonism.Domain.Matches;
using Edonism.Domain.World;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class CardSetupMatchTests
{
    [Fact]
    public void InitialPlayerStreetsAndControlledLotsComeFromTheirMandatoryCards()
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedCardSetup(Guid.NewGuid(), board,
            [new("alice", "sport:01"), new("bob", "public-financing:01")],
            ActivitySetupFixture.Catalog(), 784);
        var state = match.Snapshot();

        Assert.Equal(30, state.BoardActivities.Count);
        Assert.Equal(2, state.ControlledActivities.Count);
        foreach (var player in state.Players)
        {
            var card = player.PlayerId == "alice" ? "sport:01" : "public-financing:01";
            var lot = state.BoardActivities.Single(a => a.CardId == card);
            Assert.Equal(lot.SlotId, player.StartingSlotId);
            Assert.Equal(board.Slots.Single(s => s.Id == lot.SlotId).StreetId, player.StreetId);
            var controlled = Assert.Single(state.ControlledActivities,
                a => a.OwnerPlayerId == player.PlayerId);
            Assert.Equal(lot.SlotId, controlled.SlotId);
            Assert.Equal(HenchmanPosture.Standing, controlled.Posture);
            Assert.Equal(15, player.HenchmenAvailable);
        }
        Assert.All(state.GrossSalaryQuotes, q => Assert.Equal(3, q.GrossAtoms));
        Assert.Equal(0, state.Revision);
        Assert.Single(state.Events);
    }

    [Fact]
    public void LayoutAndStartingStreetsReproduceAcrossInputReorder()
    {
        var board = BoardCatalog.LoadDefault();
        var cards = ActivitySetupFixture.Catalog();
        MatchParticipantCardSeed[] players =
            [new("alice", "sport:01"), new("bob", "public-financing:01")];
        var a = GameMatch.CreateFromTrustedCardSetup(
            Guid.NewGuid(), board, players, cards, 2026).Snapshot();
        var b = GameMatch.CreateFromTrustedCardSetup(
            Guid.NewGuid(), board, players, cards.Reverse().ToArray(), 2026).Snapshot();

        Assert.Equal(a.BoardActivities.Select(x => $"{x.SlotId}/{x.CardId}"),
            b.BoardActivities.Select(x => $"{x.SlotId}/{x.CardId}"));
        Assert.Equal(a.Players.Select(x => x.StartingSlotId),
            b.Players.Select(x => x.StartingSlotId));
    }

    [Fact]
    public void FreeMovePreservesActivityLayoutAndOwnership()
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedCardSetup(Guid.NewGuid(), board,
            [new("alice", "sport:01"), new("bob", "public-financing:01")],
            ActivitySetupFixture.Catalog(), 11);
        var before = match.Snapshot();
        var player = before.Players[0];
        var adjacent = board.Streets.Single(s => s.Id == player.StreetId).Neighbors[0];

        var outcome = match.TryFreeMove("alice", adjacent, 0);
        Assert.True(outcome.Accepted);
        Assert.Equal(adjacent, outcome.State.Players[0].StreetId);
        Assert.Equal(player.StartingSlotId, outcome.State.Players[0].StartingSlotId);
        Assert.Equal(before.BoardActivities, outcome.State.BoardActivities);
        Assert.Equal(before.ControlledActivities, outcome.State.ControlledActivities);
        Assert.Equal(1, outcome.State.Revision);
    }

    [Fact]
    public void DuplicatePlayersAndStartingCardsAreRejected()
    {
        var board = BoardCatalog.LoadDefault();
        var catalog = ActivitySetupFixture.Catalog();
        Assert.Throws<ArgumentException>(() => GameMatch.CreateFromTrustedCardSetup(
            Guid.NewGuid(), board,
            [new("alice", "sport:01"), new("alice", "public-financing:01")],
            catalog, 1));
        Assert.Throws<ArgumentException>(() => GameMatch.CreateFromTrustedCardSetup(
            Guid.NewGuid(), board,
            [new("alice", "sport:01"), new("bob", "sport:01")],
            catalog, 1));
    }

    [Fact]
    public void CallerCannotChangePlacedCardDataViaSnapshot()
    {
        var match = GameMatch.CreateFromTrustedCardSetup(Guid.NewGuid(),
            BoardCatalog.LoadDefault(),
            [new("alice", "sport:01"), new("bob", "public-financing:01")],
            ActivitySetupFixture.Catalog(), 77);
        var first = match.Snapshot().BoardActivities[0];
        Assert.Throws<NotSupportedException>(() =>
            ((IList<PlacedActivityCard>)match.Snapshot().BoardActivities)[0] =
                new PlacedActivityCard(first.SlotId, "IMPOSTOR", first.Category));
        Assert.Equal(first, match.Snapshot().BoardActivities[0]);
    }
}
