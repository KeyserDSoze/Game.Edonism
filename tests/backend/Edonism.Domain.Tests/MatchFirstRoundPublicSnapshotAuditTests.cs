using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Edonism.Domain.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #161: replayed movement is not sufficient to certify a falsified public
/// first-round genesis. No private action cards are checked or revealed.
/// </summary>
public sealed class MatchFirstRoundPublicSnapshotAuditTests
{
    private static readonly BoardDefinition Board = BoardCatalog.LoadDefault();

    private static GameMatch Full(int seats) =>
        GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), Board,
            Enumerable.Range(0, seats).Select(i => $"player-{i}").ToArray(),
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);

    [Theory]
    [InlineData(2, "legacy")]
    [InlineData(2, "cards")]
    [InlineData(2, "characters")]
    [InlineData(2, "full")]
    [InlineData(4, "legacy")]
    [InlineData(4, "cards")]
    [InlineData(4, "characters")]
    [InlineData(4, "full")]
    [InlineData(8, "legacy")]
    [InlineData(8, "cards")]
    [InlineData(8, "characters")]
    [InlineData(8, "full")]
    public void GenuineGenesisMovementAndRoundEndKeepPublicAndPrivateStateVerifiable(
        int count, string fixture)
    {
        var ids = Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray();
        var catalog = ActivitySetupFixture.Catalog();
        var mandatory = catalog.GroupBy(c => c.Category, StringComparer.Ordinal)
            .OrderBy(g => g.Key, StringComparer.Ordinal)
            .Select(g => g.First().Id).Take(count).ToArray();
        var match = fixture switch
        {
            "legacy" => GameMatch.CreateFromTrustedSetup(
                Guid.NewGuid(), Board, Board.Slots.Take(count)
                    .Select((s, i) => new MatchParticipantSeed(ids[i], s.Id)).ToArray()),
            "cards" => GameMatch.CreateFromTrustedCardSetup(
                Guid.NewGuid(), Board, mandatory.Select((id, i) =>
                    new MatchParticipantCardSeed(ids[i], id)).ToArray(), catalog, 2026),
            "characters" => GameMatch.CreateFromTrustedCharacterCatalog(
                Guid.NewGuid(), Board, ids,
                CharacterSetupFixture.Catalog(), catalog, 2026),
            "full" => Full(count),
            _ => throw new ArgumentOutOfRangeException(nameof(fixture))
        };
        var privateBefore = JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal);
        var starting = match.Snapshot();
        var eventsAtGenesis = match.VerifyPublicAudit();
        Assert.True(eventsAtGenesis.IsValid, eventsAtGenesis.Code);
        Assert.Single(eventsAtGenesis.Frames);
        Assert.Equal(0, eventsAtGenesis.VerifiedRevision);
        Assert.All(starting.GrossSalaryQuotes, quote =>
        {
            Assert.Equal(2, quote.BaseAtoms);
            Assert.Equal(1, quote.StandingActivityAtoms);
            Assert.Equal(3, quote.GrossAtoms);
        });

        var first = starting.Players[0];
        var next = Board.Streets.Single(s => s.Id == first.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove(first.PlayerId, next, match.Revision).Accepted);
        for (var i = 0; i < count; i++)
        {
            var check = match.VerifyPublicAudit();
            Assert.True(check.IsValid, check.Code);
            Assert.Equal(match.Revision, check.VerifiedRevision);
            Assert.Equal(match.Snapshot().Events.Count, check.Frames.Count);
            Assert.True(match.TryEndTurn(ids[i], match.Revision).Accepted);
        }
        var final = match.Snapshot();
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, final.Phase);
        var replay = match.VerifyPublicAudit();
        Assert.True(replay.IsValid, replay.Code);
        Assert.Equal(final.Revision, replay.VerifiedRevision);
        Assert.Equal(final.Events.Count, replay.Frames.Count);
        Assert.Equal(starting.GrossSalaryQuotes, final.GrossSalaryQuotes);
        Assert.Equal(starting.ControlledActivities, final.ControlledActivities);
        Assert.Equal(starting.BoardActivities, final.BoardActivities);
        Assert.Equal(starting.AssignedCharacters, final.AssignedCharacters);
        Assert.Equal(starting.Players.Select(p => p.Atoms),
            final.Players.Select(p => p.Atoms));
        Assert.Equal(privateBefore, JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal));

        var restored = GameMatch.RestoreFromCheckpoint(Board, match.CaptureCheckpoint());
        Assert.True(restored.VerifyPublicAudit().IsValid);
        Assert.Equal(JsonSerializer.Serialize(match.Snapshot()),
            JsonSerializer.Serialize(restored.Snapshot()));
        var wire = JsonSerializer.Serialize(replay);
        Assert.DoesNotContain("cardIds", wire, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("drawPile", wire, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("actionCard", wire, StringComparison.OrdinalIgnoreCase);
    }

    private static void AssertForgeryRejected(
        MatchSnapshot forged, string expectedCode, long revision = 0)
    {
        var replay = MatchAuditReplay.Verify(Board, forged);
        Assert.False(replay.IsValid);
        Assert.Equal(expectedCode, replay.Code);
        Assert.Equal(revision, replay.VerifiedRevision);
        Assert.Empty(replay.Frames);
        Assert.Empty(replay.Players);
        var wire = JsonSerializer.Serialize(replay);
        Assert.DoesNotContain("cardIds", wire, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("drawPile", wire, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData("atoms")]
    [InlineData("diplomacy")]
    [InlineData("total")]
    [InlineData("reserve")]
    public void RejectsEconomicResourcesForgedWithoutChangingTheEventLog(string field)
    {
        var actual = Full(4).Snapshot();
        var players = actual.Players.ToArray();
        players[0] = field switch
        {
            "atoms" => players[0] with { Atoms = 1000 },
            "diplomacy" => players[0] with { DiplomacyTokens = 0 },
            "total" => players[0] with { HenchmenTotal = 17 },
            "reserve" => players[0] with { HenchmenAvailable = 16 },
            _ => throw new ArgumentOutOfRangeException(nameof(field))
        };
        AssertForgeryRejected(actual with { Players = players }, "invalid_public_resources");
        Assert.True(MatchAuditReplay.Verify(Board, actual).IsValid);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("duplicate")]
    [InlineData("wrong-owner")]
    [InlineData("wrong-lot")]
    [InlineData("fallen")]
    public void RejectsInventedHenchmanOwnershipAndPosture(string field)
    {
        var actual = Full(4).Snapshot();
        var lots = actual.ControlledActivities.ToArray();
        switch (field)
        {
            case "missing": lots = lots[..^1]; break;
            case "duplicate": lots[1] = lots[0]; break;
            case "wrong-owner": lots[0] = lots[0] with { OwnerPlayerId = "intruder" }; break;
            case "wrong-lot": lots[0] = lots[0] with { SlotId = "INVENTED" }; break;
            case "fallen": lots[0] = lots[0] with { Posture = HenchmanPosture.Fallen }; break;
            default: throw new ArgumentOutOfRangeException(nameof(field));
        }
        AssertForgeryRejected(actual with { ControlledActivities = lots },
            "invalid_public_controls");
        Assert.True(MatchAuditReplay.Verify(Board, actual).IsValid);
    }

    [Theory]
    [InlineData("one-card")]
    [InlineData("missing-card")]
    [InlineData("extra-card")]
    [InlineData("duplicate-slot")]
    [InlineData("duplicate-card")]
    [InlineData("unknown-slot")]
    [InlineData("unknown-category")]
    [InlineData("shifted-quota")]
    public void RejectsForgedPublicCardBoardEvenWithValidMovementEvents(string field)
    {
        var actual = Full(4).Snapshot();
        var cards = actual.BoardActivities.ToArray();
        switch (field)
        {
            case "one-card": cards = cards[..1]; break;
            case "missing-card": cards = cards[..^1]; break;
            case "extra-card": cards = cards.Append(cards[0]).ToArray(); break;
            case "duplicate-slot": cards[0] = cards[0] with { SlotId = cards[1].SlotId }; break;
            case "duplicate-card": cards[0] = cards[0] with { CardId = cards[1].CardId }; break;
            case "unknown-slot": cards[0] = cards[0] with { SlotId = "INVENTED" }; break;
            case "unknown-category": cards[0] = cards[0] with { Category = "fake" }; break;
            case "shifted-quota":
                cards[0] = cards[0] with {
                    Category = cards.First(c => c.Category != cards[0].Category).Category
                };
                break;
            default: throw new ArgumentOutOfRangeException(nameof(field));
        }
        AssertForgeryRejected(actual with { BoardActivities = cards },
            "invalid_public_placement");
        Assert.True(MatchAuditReplay.Verify(Board, actual).IsValid);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("duplicate-character")]
    [InlineData("wrong-card")]
    [InlineData("wrong-hearts")]
    [InlineData("out-of-range")]
    [InlineData("null-entry")]
    public void RejectsForgedPublicCharactersAndStartingHearts(string field)
    {
        var actual = Full(4).Snapshot();
        var chars = actual.AssignedCharacters.ToArray();
        var players = actual.Players.ToArray();
        switch (field)
        {
            case "missing": chars = chars[..^1]; break;
            case "duplicate-character":
                chars[1] = chars[1] with { CharacterId = chars[0].CharacterId };
                break;
            case "wrong-card":
                chars[0] = chars[0] with { StartingActivityCardId = "INVENTED" };
                break;
            case "wrong-hearts": players[0] = players[0] with { Hearts = null }; break;
            case "out-of-range":
                chars[0] = chars[0] with { PrintedInitialHearts = 6 };
                players[0] = players[0] with { Hearts = 6 };
                break;
            case "null-entry": chars[0] = null!; break;
            default: throw new ArgumentOutOfRangeException(nameof(field));
        }
        AssertForgeryRejected(actual with {
            Players = players, AssignedCharacters = chars
        }, "invalid_public_characters");
        Assert.True(MatchAuditReplay.Verify(Board, actual).IsValid);
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("overpaid")]
    [InlineData("wrong-base")]
    [InlineData("wrong-owner")]
    [InlineData("reordered")]
    public void RejectsForgedGrossSalaryEvenWithCorrectAuditedEvents(string field)
    {
        var actual = Full(4).Snapshot();
        var quotes = actual.GrossSalaryQuotes.ToArray();
        switch (field)
        {
            case "missing": quotes = quotes[..^1]; break;
            case "overpaid": quotes[0] = quotes[0] with { GrossAtoms = 99 }; break;
            case "wrong-base": quotes[0] = quotes[0] with { BaseAtoms = 4 }; break;
            case "wrong-owner": quotes[0] = quotes[0] with { PlayerId = "intruder" }; break;
            case "reordered": (quotes[0], quotes[1]) = (quotes[1], quotes[0]); break;
            default: throw new ArgumentOutOfRangeException(nameof(field));
        }
        AssertForgeryRejected(actual with { GrossSalaryQuotes = quotes },
            "invalid_public_salary");
        Assert.True(MatchAuditReplay.Verify(Board, actual).IsValid);
    }

    [Fact]
    public void FailedAuditCannotExportAnyIntermediateMovementFrame()
    {
        var match = Full(4);
        var first = match.Snapshot().Players[0];
        var neighbor = Board.Streets.Single(s => s.Id == first.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove(first.PlayerId, neighbor, 0).Accepted);
        var good = match.Snapshot();
        var quotes = good.GrossSalaryQuotes.ToArray();
        quotes[0] = quotes[0] with { GrossAtoms = 9999 };
        AssertForgeryRejected(good with { GrossSalaryQuotes = quotes },
            "invalid_public_salary", 1);
        Assert.True(match.VerifyPublicAudit().IsValid);
        Assert.Equal(1, match.Revision);
        Assert.Equal(good.GrossSalaryQuotes, match.Snapshot().GrossSalaryQuotes);
        Assert.Equal(good.Events, match.Snapshot().Events);
    }

    [Fact]
    public void LegacyFixtureWithoutPublicCharactersOrCardsRemainsValidButNotWithForgedHearts()
    {
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), Board,
            [new MatchParticipantSeed("alice", "N-01"),
             new MatchParticipantSeed("bob", "S-01")]);
        var original = match.Snapshot();
        Assert.True(MatchAuditReplay.Verify(Board, original).IsValid);
        Assert.Empty(original.AssignedCharacters);
        Assert.Empty(original.BoardActivities);
        var players = original.Players.ToArray();
        players[0] = players[0] with { Hearts = 3 };
        AssertForgeryRejected(original with { Players = players },
            "invalid_public_characters");
    }
}
