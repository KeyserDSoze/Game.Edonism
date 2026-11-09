using Edonism.Domain.World;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class ActivitySetupComposerTests
{
    private static readonly BoardDefinition Board = BoardCatalog.LoadDefault();

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(-123)]
    [InlineData(2026)]
    public void SeedIsStableIndependentlyOfInputOrders(int seed)
    {
        var cards = ActivitySetupFixture.Catalog();
        string[] mandatory = ["sport:01", "public-financing:01", "bishopric:03"];
        var a = ActivitySetupComposer.Compose(Board, cards, mandatory, seed);
        var b = ActivitySetupComposer.Compose(Board, cards.Reverse().ToArray(),
            mandatory.Reverse().ToArray(), seed);

        Assert.Equal(ActivitySetupComposer.AlgorithmVersion, a.AlgorithmVersion);
        Assert.Equal(seed, a.Seed);
        Assert.Equal(30, a.Activities.Count);
        Assert.Equal(a.Activities.Select(x => $"{x.SlotId}/{x.CardId}"),
            b.Activities.Select(x => $"{x.SlotId}/{x.CardId}"));
    }

    [Fact]
    public void PreservesMandatoryCardsAndPrintedCategoryQuotas()
    {
        var cards = ActivitySetupFixture.Catalog();
        Assert.Equal(46, cards.Length);
        string[] mandatory = ["sport:01", "public-financing:01", "bishopric:03"];
        var plan = ActivitySetupComposer.Compose(Board, cards, mandatory, 54);
        Assert.Equal(30, plan.Activities.Count);
        Assert.Equal(30, plan.Activities.Select(x => x.CardId).Distinct().Count());
        Assert.Equal(30, plan.Activities.Select(x => x.SlotId).Distinct().Count());
        foreach (var quota in ActivityPlacement.PrintedCategoryQuotas)
            Assert.Equal(quota.Value, plan.Activities.Count(x => x.Category == quota.Key));
        foreach (var card in mandatory)
            Assert.Contains(plan.Activities, a => a.CardId == card);
        Assert.All(plan.Activities, a =>
            Assert.Contains(Board.Slots, s => s.Id == a.SlotId));
    }

    [Fact]
    public void DifferentSeedsYieldDifferentPlacements()
    {
        var cards = ActivitySetupFixture.Catalog();
        var a = ActivitySetupComposer.Compose(Board, cards, ["sport:01"], 27);
        var b = ActivitySetupComposer.Compose(Board, cards, ["sport:01"], 28);
        Assert.NotEqual(
            string.Join(",", a.Activities.Select(x => x.CardId)),
            string.Join(",", b.Activities.Select(x => x.CardId)));
    }

    [Fact]
    public void MandatoryOverquotaIsRejectedInsteadOfReinterpretingTheRulebook()
    {
        Assert.Throws<ArgumentException>(() => ActivitySetupComposer.Compose(
            Board, ActivitySetupFixture.Catalog(),
            ["sport:01", "sport:02", "sport:03"], 9));
    }

    [Fact]
    public void IncompleteCategoryIsRejected()
    {
        var cards = ActivitySetupFixture.Catalog();
        for (var i = 0; i < cards.Length; i++)
            if (cards[i].Id is "sport:02" or "sport:03")
                cards[i] = cards[i] with { Category = "public-financing" };
        Assert.Throws<ArgumentException>(() => ActivitySetupComposer.Compose(
            Board, cards, ["sport:01"], 9));
    }

    [Fact]
    public void CatalogMustHaveExactly46UniqueValidIDs()
    {
        var cards = ActivitySetupFixture.Catalog();
        Assert.Throws<ArgumentException>(() => ActivitySetupComposer.Compose(
            Board, cards[..45], ["sport:01"], 9));
        cards[0] = cards[1];
        Assert.Throws<ArgumentException>(() => ActivitySetupComposer.Compose(
            Board, cards, ["sport:01"], 9));
    }

    [Fact]
    public void UnknownCategoriesAreRejected()
    {
        var cards = ActivitySetupFixture.Catalog();
        cards[0] = cards[0] with { Category = "invented" };
        Assert.Throws<ArgumentException>(() => ActivitySetupComposer.Compose(
            Board, cards, ["sport:01"], 9));
    }

    [Theory]
    [InlineData("bad", "sport:01")]
    [InlineData("sport:01", "sport:01")]
    [InlineData("", "sport:01")]
    public void InvalidMandatoryIDsAreRejected(string a, string b)
    {
        Assert.Throws<ArgumentException>(() => ActivitySetupComposer.Compose(
            Board, ActivitySetupFixture.Catalog(), [a, b], 9));
    }

    [Fact]
    public void EmptyMandatoryListIsRejected()
    {
        Assert.Throws<ArgumentException>(() => ActivitySetupComposer.Compose(
            Board, ActivitySetupFixture.Catalog(), [], 9));
    }

    [Fact]
    public void PlanIsExternallyImmutable()
    {
        var plan = ActivitySetupComposer.Compose(Board,
            ActivitySetupFixture.Catalog(), ["sport:01"], 9);
        var previous = plan.Activities[0];
        Assert.Throws<NotSupportedException>(() =>
            ((IList<PlacedActivityCard>)plan.Activities)[0] =
                new PlacedActivityCard("N-01", "bad", "sport"));
        Assert.Equal(previous, plan.Activities[0]);
    }
}
