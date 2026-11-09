using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class MatchPrivateHandsTests
{
    private static GameMatch NewMatch() => GameMatch.CreateFromTrustedFullDeckSetup(
        Guid.NewGuid(),
        BoardCatalog.LoadDefault(),
        ["alice", "bob"],
        CharacterSetupFixture.Catalog(),
        ActivitySetupFixture.Catalog(),
        ActionDeckFixture.ActionIds(),
        ActionDeckFixture.ElectionDayId,
        2026);

    [Fact]
    public void PlayerCanOnlyReadTheirOwnInitialFourCards()
    {
        var match = NewMatch();
        var alice = match.PrivateHandForActor("alice");
        var bob = match.PrivateHandForActor("bob");

        Assert.NotNull(alice);
        Assert.NotNull(bob);
        Assert.Equal(match.MatchId, alice.MatchId);
        Assert.Equal("alice", alice.PlayerId);
        Assert.Equal("bob", bob.PlayerId);
        Assert.Equal(4, alice.CardIds.Count);
        Assert.Equal(4, bob.CardIds.Count);
        Assert.Empty(alice.CardIds.Intersect(bob.CardIds));
        Assert.Null(match.PrivateHandForActor("unknown"));
        Assert.Null(match.PrivateHandForActor(""));
    }

    [Fact]
    public void PublicSnapshotNeverIncludesSecretActionIdsOrDrawPile()
    {
        var match = NewMatch();
        var snapshot = match.Snapshot();
        var serialized = JsonSerializer.Serialize(snapshot);
        var aliceHand = match.PrivateHandForActor("alice")!;
        var bobHand = match.PrivateHandForActor("bob")!;

        Assert.Equal(2, snapshot.AssignedCharacters.Count);
        Assert.Equal(30, snapshot.BoardActivities.Count);
        Assert.DoesNotContain("test:action:", serialized);
        Assert.DoesNotContain(ActionDeckFixture.ElectionDayId, serialized);
        Assert.DoesNotContain("RemainingDrawPile", serialized);
        Assert.DoesNotContain("CardIds", serialized);
        Assert.All(aliceHand.CardIds.Concat(bobHand.CardIds),
            card => Assert.DoesNotContain(card, serialized));
    }

    [Fact]
    public void ExistingMatchCommandsCannotChangeOrRevealPrivateHands()
    {
        var match = NewMatch();
        var before = match.PrivateHandForActor("alice")!;
        var board = BoardCatalog.LoadDefault();
        var from = match.Snapshot().Players[0].StreetId;
        var next = board.Streets.Single(s => s.Id == from).Neighbors[0];
        Assert.True(match.TryFreeMove("alice", next, 0).Accepted);
        Assert.True(match.TryEndTurn("alice", 1).Accepted);
        Assert.Equal(before.CardIds, match.PrivateHandForActor("alice")!.CardIds);
        Assert.DoesNotContain("test:action:", JsonSerializer.Serialize(match.Snapshot()));
    }

    [Fact]
    public void PrivateHandIsReadOnlyAndLegacyFixturesHaveNoInventedCards()
    {
        var match = NewMatch();
        var hand = match.PrivateHandForActor("alice")!;
        Assert.Throws<NotSupportedException>(() =>
            ((IList<string>)hand.CardIds)[0] = "fake");

        var legacy = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(),
            BoardCatalog.LoadDefault(), [new("alice", "N-01"), new("bob", "S-01")]);
        Assert.Null(legacy.PrivateHandForActor("alice"));
    }

    [Fact]
    public void InvalidActionDeckRejectsFullSetupBeforeCreatingAMatch()
    {
        Assert.Throws<ArgumentException>(() =>
            GameMatch.CreateFromTrustedFullDeckSetup(Guid.NewGuid(),
                BoardCatalog.LoadDefault(), ["alice", "bob"],
                CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
                ActionDeckFixture.ActionIds()[..57],
                ActionDeckFixture.ElectionDayId, 2026));
    }
}
