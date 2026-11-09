using Edonism.Domain.World;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class ActivityPlacementTests
{
    private static readonly BoardDefinition Board = BoardCatalog.LoadDefault();

    private static ActivityCardId[] CompleteDeck() =>
        ActivityPlacement.PrintedCategoryQuotas
            .SelectMany(category => Enumerable.Range(1, category.Value)
                .Select(i => new ActivityCardId($"{category.Key}:{i:D2}", category.Key)))
            .ToArray();

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(-1642)]
    [InlineData(123456789)]
    public void SameSeedAndSameCardsProduceIdenticalSlotAssignments(int seed)
    {
        var deck = CompleteDeck();
        var original = ActivityPlacement.Assign(Board, deck, seed);
        var reversed = ActivityPlacement.Assign(Board, deck.Reverse().ToArray(), seed);

        Assert.Equal(30, original.Count);
        Assert.Equal(original, reversed);
        Assert.Equal(30, original.Select(a => a.CardId).Distinct().Count());
        Assert.Equal(30, original.Select(a => a.SlotId).Distinct().Count());
    }

    [Fact]
    public void DifferentSeedsChangeAssignments()
    {
        Assert.NotEqual(
            ActivityPlacement.Assign(Board, CompleteDeck(), 1),
            ActivityPlacement.Assign(Board, CompleteDeck(), 2));
    }

    [Fact]
    public void RejectsMissingOrDuplicateCards()
    {
        var deck = CompleteDeck();
        Assert.Throws<ArgumentException>(() => ActivityPlacement.Assign(Board, deck[..29], 5));
        deck[1] = deck[0];
        Assert.Throws<ArgumentException>(() => ActivityPlacement.Assign(Board, deck, 5));
    }

    [Fact]
    public void RejectsIncorrectCategoryQuotas()
    {
        var deck = CompleteDeck();
        deck[0] = deck[0] with { Category = "sport" };
        Assert.Throws<ArgumentException>(() => ActivityPlacement.Assign(Board, deck, 42));
    }
}
