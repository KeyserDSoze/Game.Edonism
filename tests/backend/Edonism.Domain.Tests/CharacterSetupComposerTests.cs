using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class CharacterSetupComposerTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(-23)]
    [InlineData(2026)]
    public void DrawIsDeterministicAndIgnoresCatalogOrdering(int seed)
    {
        var chars = CharacterSetupFixture.Catalog();
        var activities = ActivitySetupFixture.Catalog();
        string[] players = ["alice", "bob", "cara", "dan"];
        var a = CharacterSetupComposer.Draw(chars, activities, players, seed);
        var b = CharacterSetupComposer.Draw(chars.Reverse().ToArray(),
            activities.Reverse().ToArray(), players, seed);
        Assert.Equal(CharacterSetupComposer.AlgorithmVersion, a.AlgorithmVersion);
        Assert.Equal(seed, a.Seed);
        Assert.Equal(players, a.Characters.Select(c => c.PlayerId));
        Assert.Equal(4, a.Characters.Select(c => c.CharacterId).Distinct().Count());
        Assert.Equal(
            a.Characters.Select(c => $"{c.PlayerId}/{c.CharacterId}/{c.StartingActivityCardId}/{c.PrintedInitialHearts}"),
            b.Characters.Select(c => $"{c.PlayerId}/{c.CharacterId}/{c.StartingActivityCardId}/{c.PrintedInitialHearts}"));
    }

    [Fact]
    public void DifferentSeedsUsuallyYieldDifferentDraws()
    {
        var cards = CharacterSetupFixture.Catalog();
        var activities = ActivitySetupFixture.Catalog();
        string[] players = ["alice", "bob", "cara"];
        var a = CharacterSetupComposer.Draw(cards, activities, players, 7);
        var b = CharacterSetupComposer.Draw(cards, activities, players, 83);
        Assert.NotEqual(
            string.Join(",", a.Characters.Select(c => c.CharacterId)),
            string.Join(",", b.Characters.Select(c => c.CharacterId)));
    }

    [Fact]
    public void DrawnCharactersExposePrintedInitialHeartsAndRealAssociatedIDs()
    {
        var cards = CharacterSetupFixture.Catalog();
        var activities = ActivitySetupFixture.Catalog();
        var plan = CharacterSetupComposer.Draw(cards, activities, ["alice", "bob"], 9);
        Assert.Equal(2, plan.Characters.Count);
        foreach (var assigned in plan.Characters)
        {
            var source = cards.Single(c => c.Id == assigned.CharacterId);
            Assert.Equal(source.StartingActivityCardId, assigned.StartingActivityCardId);
            Assert.Equal(source.PrintedInitialHearts, assigned.PrintedInitialHearts);
            Assert.Contains(activities, a => a.Id == assigned.StartingActivityCardId);
        }
    }

    [Fact]
    public void RequiresExactlyTwentyThreeUniqueCharacterIDs()
    {
        var chars = CharacterSetupFixture.Catalog();
        var activities = ActivitySetupFixture.Catalog();
        Assert.Throws<ArgumentException>(() =>
            CharacterSetupComposer.Draw(chars[..22], activities, ["alice", "bob"], 1));
        chars[0] = chars[1];
        Assert.Throws<ArgumentException>(() =>
            CharacterSetupComposer.Draw(chars, activities, ["alice", "bob"], 1));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(6)]
    public void InvalidHeartsAreRejected(int hearts)
    {
        var chars = CharacterSetupFixture.Catalog();
        chars[0] = chars[0] with { PrintedInitialHearts = hearts };
        Assert.Throws<ArgumentException>(() =>
            CharacterSetupComposer.Draw(chars, ActivitySetupFixture.Catalog(), ["alice", "bob"], 1));
    }

    [Fact]
    public void EveryCharacterAssociationMustReferenceARealCatalogActivity()
    {
        var chars = CharacterSetupFixture.Catalog();
        chars[0] = chars[0] with { StartingActivityCardId = "missing-activity" };
        Assert.Throws<ArgumentException>(() =>
            CharacterSetupComposer.Draw(chars, ActivitySetupFixture.Catalog(), ["alice", "bob"], 1));
    }

    [Fact]
    public void InvalidActivityCatalogAndBadPlayersAreRejected()
    {
        var chars = CharacterSetupFixture.Catalog();
        var catalog = ActivitySetupFixture.Catalog();
        Assert.Throws<ArgumentException>(() =>
            CharacterSetupComposer.Draw(chars, catalog[..45], ["alice", "bob"], 1));
        Assert.Throws<ArgumentException>(() =>
            CharacterSetupComposer.Draw(chars, catalog, ["alice", "alice"], 1));
        Assert.Throws<ArgumentException>(() =>
            CharacterSetupComposer.Draw(chars, catalog, ["alice"], 1));
        Assert.Throws<ArgumentException>(() =>
            CharacterSetupComposer.Draw(chars, catalog,
                Enumerable.Range(1, 9).Select(i => $"player-{i}").ToArray(), 1));
    }

    [Fact]
    public void DuplicateAssociatedActivitiesInSelectedCharactersFailClosed()
    {
        var chars = CharacterSetupFixture.Catalog()
            .Select(c => c with { StartingActivityCardId = "sport:01" })
            .ToArray();
        Assert.Throws<ArgumentException>(() =>
            CharacterSetupComposer.Draw(chars, ActivitySetupFixture.Catalog(), ["alice", "bob"], 2));
    }

    [Fact]
    public void DrawnCardsAreImmutableToCallers()
    {
        var draw = CharacterSetupComposer.Draw(CharacterSetupFixture.Catalog(),
            ActivitySetupFixture.Catalog(), ["alice", "bob"], 2026);
        var first = draw.Characters[0];
        Assert.Throws<NotSupportedException>(() =>
            ((IList<DrawnCharacter>)draw.Characters)[0] =
                new DrawnCharacter("alice", "fake", "sport:01", 5));
        Assert.Equal(first, draw.Characters[0]);
    }
}
