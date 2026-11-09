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
