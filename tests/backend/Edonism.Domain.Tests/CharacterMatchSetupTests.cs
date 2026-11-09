using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class CharacterMatchSetupTests
{
    [Fact]
    public void DrawnCharacterDeterminesStartingLotStreetAndPublicHearts()
    {
        var board = BoardCatalog.LoadDefault();
        var chars = CharacterSetupFixture.Catalog();
        var match = GameMatch.CreateFromTrustedCharacterCatalog(
            Guid.NewGuid(), board, ["alice", "bob"], chars,
            ActivitySetupFixture.Catalog(), 2026);
        var state = match.Snapshot();

        Assert.Equal(2, state.AssignedCharacters.Count);
        Assert.Equal(30, state.BoardActivities.Count);
        foreach (var assigned in state.AssignedCharacters)
        {
            var player = state.Players.Single(p => p.PlayerId == assigned.PlayerId);
            var card = chars.Single(c => c.Id == assigned.CharacterId);
            var lot = state.BoardActivities.Single(x => x.CardId == assigned.StartingActivityCardId);
            var control = state.ControlledActivities.Single(x => x.OwnerPlayerId == player.PlayerId);
            Assert.Equal(card.PrintedInitialHearts, assigned.PrintedInitialHearts);
            Assert.Equal(card.PrintedInitialHearts, player.Hearts);
            Assert.Equal(lot.SlotId, player.StartingSlotId);
            Assert.Equal(lot.SlotId, control.SlotId);
            Assert.Equal(board.Slots.Single(s => s.Id == lot.SlotId).StreetId, player.StreetId);
            Assert.Equal(HenchmanPosture.Standing, control.Posture);
            Assert.Equal(15, player.HenchmenAvailable);
        }

        Assert.Equal(0, state.Revision);
        Assert.Equal(["alice", "bob"], state.TurnOrder);
        Assert.All(state.GrossSalaryQuotes, q => Assert.Equal(3, q.GrossAtoms));
    }

    [Fact]
    public void SetupIsReplayableWithSeedAndIndependentOfCatalogOrder()
    {
        var board = BoardCatalog.LoadDefault();
        var cards = ActivitySetupFixture.Catalog();
        var chars = CharacterSetupFixture.Catalog();
        var a = GameMatch.CreateFromTrustedCharacterCatalog(Guid.NewGuid(), board,
            ["alice", "bob"], chars, cards, 2026).Snapshot();
        var b = GameMatch.CreateFromTrustedCharacterCatalog(Guid.NewGuid(), board,
            ["alice", "bob"], chars.Reverse().ToArray(),
            cards.Reverse().ToArray(), 2026).Snapshot();

        Assert.Equal(
            a.AssignedCharacters.Select(c => $"{c.PlayerId}:{c.CharacterId}:{c.PrintedInitialHearts}"),
            b.AssignedCharacters.Select(c => $"{c.PlayerId}:{c.CharacterId}:{c.PrintedInitialHearts}"));
        Assert.Equal(a.BoardActivities.Select(c => $"{c.SlotId}:{c.CardId}"),
            b.BoardActivities.Select(c => $"{c.SlotId}:{c.CardId}"));
        Assert.Equal(a.Players.Select(p => $"{p.PlayerId}:{p.StreetId}:{p.Hearts}"),
            b.Players.Select(p => $"{p.PlayerId}:{p.StreetId}:{p.Hearts}"));
    }

    [Fact]
    public void CharacterBasedSetupMaintainsMovementTurnAndOwnershipRules()
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedCharacterCatalog(Guid.NewGuid(), board,
            ["alice", "bob"], CharacterSetupFixture.Catalog(),
            ActivitySetupFixture.Catalog(), 2026);
        var before = match.Snapshot();
        var alice = before.Players[0];
        var adjacent = board.Streets.Single(s => s.Id == alice.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove("alice", adjacent, before.Revision).Accepted);
        var moved = match.Snapshot();
        Assert.Equal(adjacent, moved.Players[0].StreetId);
        Assert.Equal(alice.Hearts, moved.Players[0].Hearts);
        Assert.Equal(alice.StartingSlotId, moved.Players[0].StartingSlotId);
        Assert.Equal(before.AssignedCharacters, moved.AssignedCharacters);
        Assert.Equal(before.ControlledActivities, moved.ControlledActivities);
        Assert.Equal(1, moved.Revision);
    }

    [Fact]
    public void LegacyDevelopmentFixtureHasNoInventedCharacterOrHearts()
    {
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(),
            BoardCatalog.LoadDefault(), [new("alice", "N-01"), new("bob", "S-01")]);
        var state = match.Snapshot();
        Assert.Empty(state.AssignedCharacters);
        Assert.All(state.Players, p => Assert.Null(p.Hearts));
    }

    [Fact]
    public void SnapshotDoesNotAllowTamperingWithAssignedCharacters()
    {
        var match = GameMatch.CreateFromTrustedCharacterCatalog(Guid.NewGuid(),
            BoardCatalog.LoadDefault(), ["alice", "bob"],
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(), 2026);
        var original = match.Snapshot().AssignedCharacters[0];
        Assert.Throws<NotSupportedException>(() =>
            ((IList<MatchAssignedCharacterSnapshot>)match.Snapshot().AssignedCharacters)[0] =
                original with { PrintedInitialHearts = 5 });
        Assert.Equal(original, match.Snapshot().AssignedCharacters[0]);
    }
}
