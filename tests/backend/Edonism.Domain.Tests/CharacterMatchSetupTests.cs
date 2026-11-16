using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class CharacterMatchSetupTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void PublicFullDeckContainsThirtyCanonicalDistinctLotsIncludingUncontrolledCards(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedCharacterCatalog(
            Guid.NewGuid(), board,
            Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray(),
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(), 140 + count);
        var before = match.Snapshot();
        Assert.Equal(30, before.BoardActivities.Count);
        Assert.Equal(30, before.BoardActivities.Select(card => card.SlotId)
            .Distinct(StringComparer.Ordinal).Count());
        var canonical = board.Slots.Select(slot => slot.Id)
            .ToHashSet(StringComparer.Ordinal);
        Assert.All(before.BoardActivities, card =>
        {
            Assert.Contains(card.SlotId, canonical);
            Assert.False(string.IsNullOrWhiteSpace(card.CardId));
            Assert.False(string.IsNullOrWhiteSpace(card.Category));
        });
        Assert.Equal(count, before.ControlledActivities.Count);
        Assert.Equal(30 - count, before.BoardActivities.Count(card =>
            !before.ControlledActivities.Any(lot => lot.SlotId == card.SlotId)));
        Assert.Equal(count, before.GrossSalaryQuotes.Count);
        Assert.All(before.GrossSalaryQuotes, quote => Assert.Equal(3, quote.GrossAtoms));

        var actor = before.Players[0];
        var next = board.Streets.Single(s => s.Id == actor.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove(actor.PlayerId, next, before.Revision).Accepted);
        Assert.True(match.TryEndTurn(actor.PlayerId, match.Revision).Accepted);
        var after = match.Snapshot();
        Assert.Equal(before.BoardActivities, after.BoardActivities);
        Assert.Equal(before.ControlledActivities, after.ControlledActivities);
        Assert.Equal(before.GrossSalaryQuotes, after.GrossSalaryQuotes);
        Assert.Equal(before.Players.Select(p => p.Atoms),
            after.Players.Select(p => p.Atoms));
        Assert.True(match.VerifyPublicAudit().IsValid);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void FullDeckPublicActivityCardIdsAreDistinctBeforeAndAfterTurn(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedCharacterCatalog(
            Guid.NewGuid(), board,
            Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray(),
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(), 142 + count);
        var before = match.Snapshot();
        Assert.Equal(30, before.BoardActivities.Count);
        Assert.Equal(30, before.BoardActivities.Select(card => card.CardId)
            .Distinct(StringComparer.Ordinal).Count());
        Assert.All(before.BoardActivities,
            card => Assert.False(string.IsNullOrWhiteSpace(card.CardId)));

        var actor = before.Players[0];
        var destination = board.Streets.Single(s => s.Id == actor.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove(actor.PlayerId, destination, before.Revision).Accepted);
        Assert.True(match.TryEndTurn(actor.PlayerId, match.Revision).Accepted);
        var after = match.Snapshot();
        Assert.Equal(before.BoardActivities, after.BoardActivities);
        Assert.Equal(30, after.BoardActivities.Select(card => card.CardId)
            .Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(before.GrossSalaryQuotes, after.GrossSalaryQuotes);
        Assert.True(match.VerifyPublicAudit().IsValid);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void AllPublicFirstRoundHeartsProveTheirUniqueAssignedCharacterAndOriginCard(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedCharacterCatalog(
            Guid.NewGuid(), board,
            Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray(),
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(), 141 + count);
        var before = match.Snapshot();
        Assert.Equal(count, before.Players.Count);
        Assert.Equal(count, before.AssignedCharacters.Count);
        Assert.Equal(count, before.AssignedCharacters.Select(x => x.CharacterId)
            .Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(count, before.AssignedCharacters.Select(x => x.StartingActivityCardId)
            .Distinct(StringComparer.Ordinal).Count());

        foreach (var assigned in before.AssignedCharacters)
        {
            var seat = Assert.Single(before.Players, p => p.PlayerId == assigned.PlayerId);
            var card = Assert.Single(before.BoardActivities,
                placed => placed.CardId == assigned.StartingActivityCardId);
            Assert.Equal(assigned.PrintedInitialHearts, seat.Hearts);
            Assert.Equal(seat.StartingSlotId, card.SlotId);
            Assert.True(assigned.PrintedInitialHearts is >= 1 and <= 5);
        }

        var actor = before.Players[0];
        var destination = board.Streets.Single(s => s.Id == actor.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove(actor.PlayerId, destination, before.Revision).Accepted);
        Assert.True(match.TryEndTurn(actor.PlayerId, match.Revision).Accepted);
        var after = match.Snapshot();
        Assert.Equal(before.AssignedCharacters, after.AssignedCharacters);
        Assert.Equal(before.Players.Select(p => p.Hearts),
            after.Players.Select(p => p.Hearts));
        Assert.True(match.VerifyPublicAudit().IsValid);
    }

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

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void PublicCharacterHeartsMatchPrintedCardsAndStayStableAfterMoveAndEndTurn(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedCharacterCatalog(
            Guid.NewGuid(), board,
            Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray(),
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(), 137 + count);
        var before = match.Snapshot();
        Assert.Equal(count, before.Players.Count);
        Assert.Equal(count, before.AssignedCharacters.Count);
        foreach (var player in before.Players)
        {
            var printed = before.AssignedCharacters.Single(c => c.PlayerId == player.PlayerId);
            Assert.Equal(printed.PrintedInitialHearts, player.Hearts);
            Assert.True(player.Hearts is >= 1 and <= 5);
        }

        var mover = before.Players[0];
        var target = board.Streets.Single(s => s.Id == mover.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove(mover.PlayerId, target, before.Revision).Accepted);
        var moved = match.Snapshot();
        Assert.Equal(before.Players.Select(p => p.Hearts),
            moved.Players.Select(p => p.Hearts));
        Assert.True(match.TryEndTurn(mover.PlayerId, moved.Revision).Accepted);
        var ended = match.Snapshot();
        Assert.Equal(before.Players.Select(p => p.Hearts),
            ended.Players.Select(p => p.Hearts));
        Assert.Equal(before.AssignedCharacters, ended.AssignedCharacters);
        Assert.True(match.VerifyPublicAudit().IsValid);
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
