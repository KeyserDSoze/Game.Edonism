using Edonism.Domain.Matches;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class InitialActionDeckComposerTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(-2026)]
    [InlineData(987654)]
    public void DeterministicDealDoesNotDependOnSourceCardOrder(int seed)
    {
        var cards = ActionDeckFixture.ActionIds();
        string[] players = ["alice", "bob", "cara"];
        var a = InitialActionDeckComposer.Deal(cards, ActionDeckFixture.ElectionDayId, players, seed);
        var b = InitialActionDeckComposer.Deal(cards.Reverse().ToArray(),
            ActionDeckFixture.ElectionDayId, players, seed);

        Assert.Equal(InitialActionDeckComposer.AlgorithmVersion, a.AlgorithmVersion);
        Assert.Equal(seed, a.Seed);
        Assert.Equal(players, a.Hands.Select(h => h.PlayerId));
        Assert.Equal(a.Hands.SelectMany(h => h.CardIds),
            b.Hands.SelectMany(h => h.CardIds));
        Assert.Equal(a.RemainingDrawPile, b.RemainingDrawPile);
    }

    [Theory]
    [InlineData(2, 51)]
    [InlineData(3, 47)]
    [InlineData(5, 39)]
    [InlineData(8, 27)]
    public void ExactlyFourCardsPerPlayerAndEveryPhysicalCardOccursOnce(int count, int remaining)
    {
        var players = Enumerable.Range(1, count).Select(i => $"p{i}").ToArray();
        var deal = InitialActionDeckComposer.Deal(
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, players, 2026);

        Assert.Equal(count, deal.Hands.Count);
        Assert.All(deal.Hands, h => Assert.Equal(4, h.CardIds.Count));
        Assert.Equal(remaining, deal.RemainingDrawPile.Count);
        var all = deal.Hands.SelectMany(h => h.CardIds)
            .Concat(deal.RemainingDrawPile).ToArray();
        Assert.Equal(59, all.Length);
        Assert.Equal(59, all.Distinct(StringComparer.Ordinal).Count());
        Assert.Single(all, card => card == ActionDeckFixture.ElectionDayId);
    }

    [Fact]
    public void ElectionDayIsShuffledWithActionsNotSpecialCasedOutOfInitialHands()
    {
        var foundInHand = Enumerable.Range(0, 150).Any(seed =>
        {
            var deal = InitialActionDeckComposer.Deal(ActionDeckFixture.ActionIds(),
                ActionDeckFixture.ElectionDayId, ["alice", "bob"], seed);
            return deal.Hands.Any(h => h.CardIds.Contains(ActionDeckFixture.ElectionDayId));
        });
        Assert.True(foundInHand);
    }

    [Fact]
    public void DifferentSeedsProduceDifferentHands()
    {
        var ids = ActionDeckFixture.ActionIds();
        var a = InitialActionDeckComposer.Deal(ids, ActionDeckFixture.ElectionDayId,
            ["alice", "bob"], 100);
        var b = InitialActionDeckComposer.Deal(ids, ActionDeckFixture.ElectionDayId,
            ["alice", "bob"], 200);
        Assert.NotEqual(string.Join(",", a.Hands.SelectMany(h => h.CardIds)),
            string.Join(",", b.Hands.SelectMany(h => h.CardIds)));
    }

    [Fact]
    public void InvalidCatalogAndElectionDayCollisionsAreRejected()
    {
        var ids = ActionDeckFixture.ActionIds();
        Assert.Throws<ArgumentException>(() => InitialActionDeckComposer.Deal(
            ids[..57], ActionDeckFixture.ElectionDayId, ["alice", "bob"], 1));
        ids[0] = ids[1];
        Assert.Throws<ArgumentException>(() => InitialActionDeckComposer.Deal(
            ids, ActionDeckFixture.ElectionDayId, ["alice", "bob"], 1));
        Assert.Throws<ArgumentException>(() => InitialActionDeckComposer.Deal(
            ActionDeckFixture.ActionIds(), "test:action:01", ["alice", "bob"], 1));
        Assert.Throws<ArgumentException>(() => InitialActionDeckComposer.Deal(
            ActionDeckFixture.ActionIds(), "", ["alice", "bob"], 1));
    }

    [Fact]
    public void DuplicatePlayersAndInvalidPlayerCountsAreRejected()
    {
        var ids = ActionDeckFixture.ActionIds();
        Assert.Throws<ArgumentException>(() => InitialActionDeckComposer.Deal(
            ids, ActionDeckFixture.ElectionDayId, ["alice", "alice"], 1));
        Assert.Throws<ArgumentException>(() => InitialActionDeckComposer.Deal(
            ids, ActionDeckFixture.ElectionDayId, ["alice"], 1));
        Assert.Throws<ArgumentException>(() => InitialActionDeckComposer.Deal(
            ids, ActionDeckFixture.ElectionDayId,
            Enumerable.Range(1, 9).Select(i => $"p{i}").ToArray(), 1));
    }

    [Theory]
    [InlineData(2, 0)]
    [InlineData(3, -2026)]
    [InlineData(4, 1)]
    [InlineData(5, 2026)]
    [InlineData(6, int.MinValue)]
    [InlineData(7, int.MaxValue)]
    [InlineData(8, 987654)]
    public void RecordedPrivateShuffleReplaysAllCardsForTwoToEightSeats(
        int playerCount, int seed)
    {
        var players = Enumerable.Range(0, playerCount)
            .Select(i => $"seat-{i}").ToArray();
        var cards = ActionDeckFixture.ActionIds();
        var deal = InitialActionDeckComposer.Deal(
            cards, ActionDeckFixture.ElectionDayId, players, seed);

        Assert.True(InitialActionDeckComposer.MatchesRecordedShuffle(deal, players));
        // This check uses the union of 59 IDs; it does not guess which card
        // was printed as Election Day or require canonical assets (#19).
        var resupplied = InitialActionDeckComposer.Deal(
            cards.Reverse().ToArray(), ActionDeckFixture.ElectionDayId, players, seed);
        Assert.True(InitialActionDeckComposer.MatchesRecordedShuffle(resupplied, players));
        Assert.Equal(deal.Hands.SelectMany(h => h.CardIds),
            resupplied.Hands.SelectMany(h => h.CardIds));
        Assert.Equal(deal.RemainingDrawPile, resupplied.RemainingDrawPile);
    }

    [Fact]
    public void RecordedShuffleRejectsReorderedOrIncompletePrivateDataWithoutExceptions()
    {
        string[] order = ["alice", "bob"];
        var deal = InitialActionDeckComposer.Deal(
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, order, 2026);
        Assert.True(InitialActionDeckComposer.MatchesRecordedShuffle(deal, order));
        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(null, order));
        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(deal, null));
        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(deal, ["bob", "alice"]));
        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(deal, ["alice", "alice"]));
        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(deal, ["alice"]));
        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(
            deal with { AlgorithmVersion = "future-draw" }, order));

        var pile = deal.RemainingDrawPile.ToArray();
        (pile[0], pile[1]) = (pile[1], pile[0]);
        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(
            deal with { RemainingDrawPile = pile }, order));
        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(
            deal with { RemainingDrawPile = deal.RemainingDrawPile.Skip(1).ToArray() }, order));

        var hands = deal.Hands.ToArray();
        hands[0] = hands[0] with { CardIds = hands[0].CardIds.Reverse().ToArray() };
        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(
            deal with { Hands = hands }, order));

        var duplicated = deal.Hands.ToArray();
        duplicated[0] = duplicated[0] with { CardIds = [
            deal.Hands[1].CardIds[0], ..deal.Hands[0].CardIds.Skip(1)
        ] };
        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(
            deal with { Hands = duplicated }, order));

        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(
            deal with { Seed = deal.Seed ^ 0x005A5A5A }, order));
    }

    [Fact]
    public void HandAndRemainingDeckCannotBeMutatedFromOutside()
    {
        var deal = InitialActionDeckComposer.Deal(ActionDeckFixture.ActionIds(),
            ActionDeckFixture.ElectionDayId, ["alice", "bob"], 1);
        var first = deal.Hands[0].CardIds[0];
        Assert.Throws<NotSupportedException>(() =>
            ((IList<string>)deal.Hands[0].CardIds)[0] = "fake");
        Assert.Throws<NotSupportedException>(() =>
            ((IList<string>)deal.RemainingDrawPile)[0] = "fake");
        Assert.Throws<NotSupportedException>(() =>
            ((IList<InitialActionHand>)deal.Hands)[0] =
                new InitialActionHand("fake", ["fake"]));
        Assert.Equal(first, deal.Hands[0].CardIds[0]);
    }
}
