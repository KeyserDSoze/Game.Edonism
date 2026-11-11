using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class MatchCheckpointTests
{
    private static GameMatch FullDeck() => GameMatch.CreateFromTrustedFullDeckSetup(
        Guid.NewGuid(), BoardCatalog.LoadDefault(), ["alice", "bob"],
        CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
        ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);

    private static GameMatch Restore(GameMatchCheckpoint state) =>
        GameMatch.RestoreFromCheckpoint(BoardCatalog.LoadDefault(), state);

    [Fact]
    public void FullDeckRestoresAllPrivateHandsPublicStateAndCommandsWithoutPublishingSecrets()
    {
        var source = FullDeck();
        var board = BoardCatalog.LoadDefault();
        var start = source.Snapshot();
        var next = board.Streets.Single(s => s.Id == start.Players[0].StreetId).Neighbors[0];
        Assert.True(source.TryFreeMove("alice", next, 0).Accepted);
        Assert.True(source.TryEndTurn("alice", 1).Accepted);
        var before = source.CaptureCheckpoint();

        Assert.NotNull(before.PrivateDeal);
        Assert.Equal(59, before.PrivateDeal!.Hands.SelectMany(h => h.CardIds)
            .Concat(before.PrivateDeal.RemainingDrawPile).Count());
        var recovered = Restore(before);
        Assert.Equal(JsonSerializer.Serialize(source.Snapshot()),
            JsonSerializer.Serialize(recovered.Snapshot()));
        Assert.True(recovered.VerifyPublicAudit().IsValid);
        Assert.Equal(before.State.Revision, recovered.Revision);
        Assert.Equal("bob", recovered.ActivePlayerId);
        foreach (var seat in new[] { "alice", "bob" })
            Assert.Equal(source.PrivateHandForActor(seat)!.CardIds,
                recovered.PrivateHandForActor(seat)!.CardIds);

        Assert.True(recovered.TryEndTurn("bob", before.State.Revision).Accepted);
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, recovered.Phase);
        Assert.True(recovered.VerifyPublicAudit().IsValid);
        Assert.Equal(2L, source.Revision); // restored mutation does not alias source

        var publicJson = JsonSerializer.Serialize(recovered.Snapshot());
        foreach (var card in before.PrivateDeal.Hands.SelectMany(h => h.CardIds))
            Assert.DoesNotContain(card, publicJson);
        Assert.DoesNotContain("RemainingDrawPile", publicJson);
    }

    [Fact]
    public void CheckpointIsCopiedAndOriginalCallerCollectionsCannotMutateRestoredState()
    {
        var source = FullDeck();
        var exported = source.CaptureCheckpoint();
        var restored = Restore(exported);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<string>)exported.PrivateDeal!.Hands[0].CardIds)[0] = "forged");
        Assert.Throws<NotSupportedException>(() =>
            ((IList<string>)restored.PrivateHandForActor("alice")!.CardIds)[0] = "forged");
        Assert.Equal(exported.State.Revision, restored.Revision);
    }

    [Fact]
    public void LegacyFixtureWithoutCardsCanStillBeRestoredWithoutInventingAHand()
    {
        var fixture = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(),
            BoardCatalog.LoadDefault(),
            [new("alice", "N-01"), new("bob", "S-01")]);
        var result = Restore(fixture.CaptureCheckpoint());
        Assert.Null(result.PrivateHandForActor("alice"));
        Assert.True(result.VerifyPublicAudit().IsValid);
    }

    [Fact]
    public void RejectsVersionBoardRevisionEventsAndPublicResourceTampering()
    {
        var state = FullDeck().CaptureCheckpoint();
        Assert.Throws<InvalidDataException>(() =>
            Restore(state with { FormatVersion = 2 }));
        Assert.Throws<InvalidDataException>(() =>
            Restore(state with { State = state.State with { BoardVersion = "invented" } }));
        Assert.Throws<InvalidDataException>(() =>
            Restore(state with { State = state.State with { Revision = 7 } }));
        Assert.Throws<InvalidDataException>(() =>
            Restore(state with { State = state.State with { Events = [] } }));
        var changed = state.State.Players.ToArray();
        changed[0] = changed[0] with { Atoms = 999 };
        Assert.Throws<InvalidDataException>(() =>
            Restore(state with { State = state.State with { Players = changed } }));

        var ownership = state.State.ControlledActivities.ToArray();
        ownership[0] = ownership[0] with { OwnerPlayerId = "intruder" };
        Assert.Throws<InvalidDataException>(() =>
            Restore(state with { State = state.State with { ControlledActivities = ownership } }));

        var salary = state.State.GrossSalaryQuotes.ToArray();
        salary[0] = salary[0] with { GrossAtoms = 90 };
        Assert.Throws<InvalidDataException>(() =>
            Restore(state with { State = state.State with { GrossSalaryQuotes = salary } }));
    }

    [Fact]
    public void CharacterOnlyFixtureWithoutPrivateActionDealStillRestores()
    {
        var match = GameMatch.CreateFromTrustedCharacterCatalog(
            Guid.NewGuid(), BoardCatalog.LoadDefault(), ["alice", "bob"],
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(), 2026);
        var checkpoint = match.CaptureCheckpoint();
        Assert.Equal(2, checkpoint.State.AssignedCharacters.Count);
        Assert.Null(checkpoint.PrivateDeal);
        var restored = Restore(checkpoint);
        Assert.Null(restored.PrivateHandForActor("alice"));
        Assert.Equal(checkpoint.State.AssignedCharacters, restored.Snapshot().AssignedCharacters);
        Assert.True(restored.VerifyPublicAudit().IsValid);
    }

    [Theory]
    [InlineData("within-hand")]
    [InlineData("between-seats")]
    [InlineData("hand-to-pile")]
    [InlineData("pile-order")]
    [InlineData("seat-order")]
    [InlineData("seed")]
    [InlineData("version")]
    public void RestoreRejectsStructurallyCompleteButWrongPrivateShuffle(string tamper)
    {
        // Every variant still holds 59 distinct IDs and four cards per seat.
        // The old cardinality-only checkpoint gate would have accepted them.
        var original = FullDeck().CaptureCheckpoint();
        var deal = original.PrivateDeal!;
        var hands = deal.Hands.Select(h => h with { CardIds = h.CardIds.ToArray() }).ToArray();
        var pile = deal.RemainingDrawPile.ToArray();

        var forged = tamper switch
        {
            "within-hand" => SwapWithinHand(),
            "between-seats" => SwapBetweenSeats(),
            "hand-to-pile" => SwapHandAndPile(),
            "pile-order" => SwapWithinPile(),
            "seat-order" => deal with { Hands = hands.Reverse().ToArray() },
            "seed" => deal with { Seed = deal.Seed ^ 0x01020304 },
            "version" => deal with { AlgorithmVersion = "future-algorithm" },
            _ => throw new ArgumentOutOfRangeException(nameof(tamper)),
        };

        InitialActionDeal SwapWithinHand()
        {
            var ids = hands[0].CardIds.ToArray();
            (ids[0], ids[1]) = (ids[1], ids[0]);
            hands[0] = hands[0] with { CardIds = ids };
            return deal with { Hands = hands };
        }
        InitialActionDeal SwapBetweenSeats()
        {
            var left = hands[0].CardIds.ToArray();
            var right = hands[1].CardIds.ToArray();
            (left[0], right[0]) = (right[0], left[0]);
            hands[0] = hands[0] with { CardIds = left };
            hands[1] = hands[1] with { CardIds = right };
            return deal with { Hands = hands };
        }
        InitialActionDeal SwapHandAndPile()
        {
            var ids = hands[0].CardIds.ToArray();
            (ids[0], pile[0]) = (pile[0], ids[0]);
            hands[0] = hands[0] with { CardIds = ids };
            return deal with { Hands = hands, RemainingDrawPile = pile };
        }
        InitialActionDeal SwapWithinPile()
        {
            (pile[0], pile[1]) = (pile[1], pile[0]);
            return deal with { RemainingDrawPile = pile };
        }

        Assert.Equal(59, forged.Hands.SelectMany(h => h.CardIds)
            .Concat(forged.RemainingDrawPile).Distinct(StringComparer.Ordinal).Count());
        Assert.All(forged.Hands, hand => Assert.Equal(4, hand.CardIds.Count));
        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(
            forged, original.State.TurnOrder));
        var error = Assert.Throws<InvalidDataException>(() =>
            Restore(original with { PrivateDeal = forged }));
        Assert.DoesNotContain("test:action:", error.Message);
        Assert.DoesNotContain(ActionDeckFixture.ElectionDayId, error.Message);
    }

    [Fact]
    public void ValidCheckpointAfterFullFirstRoundPreservesPrivateDealAndDoesNotCreditEconomy()
    {
        var source = FullDeck();
        Assert.True(source.TryEndTurn("alice", 0).Accepted);
        Assert.True(source.TryEndTurn("bob", 1).Accepted);
        var checkpoint = source.CaptureCheckpoint();
        Assert.True(InitialActionDeckComposer.MatchesRecordedShuffle(
            checkpoint.PrivateDeal, checkpoint.State.TurnOrder));

        var restored = Restore(checkpoint);
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, restored.Phase);
        Assert.Equal(2L, restored.Revision);
        Assert.True(restored.VerifyPublicAudit().IsValid);
        foreach (var seat in checkpoint.State.TurnOrder)
            Assert.Equal(source.PrivateHandForActor(seat)!.CardIds,
                restored.PrivateHandForActor(seat)!.CardIds);
        Assert.All(restored.Snapshot().Players, p => Assert.Equal(4, p.Atoms));
        Assert.False(restored.TurnOptionsForActor("alice")!.CanEndTurn);
        Assert.NotNull(restored.PendingSettlementPreview());
    }

    [Fact]
    public void RejectsDuplicateAndIncompletePrivateCardsOrCharacterAssignments()
    {
        var state = FullDeck().CaptureCheckpoint();
        var deal = state.PrivateDeal!;
        Assert.Throws<InvalidDataException>(() =>
            Restore(state with {
                PrivateDeal = deal with { RemainingDrawPile = deal.RemainingDrawPile.Skip(1).ToArray() }
            }));
        var duplicate = deal.RemainingDrawPile.ToArray();
        duplicate[0] = deal.Hands[0].CardIds[0];
        Assert.Throws<InvalidDataException>(() =>
            Restore(state with {
                PrivateDeal = deal with { RemainingDrawPile = duplicate }
            }));
        Assert.Throws<InvalidDataException>(() =>
            Restore(state with {
                State = state.State with { AssignedCharacters = [] }
            }));
    }
}
