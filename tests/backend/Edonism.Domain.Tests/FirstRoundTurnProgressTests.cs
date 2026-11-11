using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class FirstRoundTurnProgressTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public void TurnProgressFollowsVerifiedOrderAndNeverCountsFreeMovesAsCompleted(int playerCount)
    {
        var board = BoardCatalog.LoadDefault();
        var participants = board.Slots.Take(playerCount)
            .Select((lot, i) => new MatchParticipantSeed($"player-{i}", lot.Id))
            .ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, participants);
        var ids = participants.Select(p => p.PlayerId).ToArray();
        var genesis = match.VerifiedFirstRoundTurnProgress();
        Assert.Equal(match.MatchId, genesis.MatchId);
        Assert.Equal(1, genesis.Round);
        Assert.Equal(0, genesis.VerifiedRevision);
        Assert.Equal(MatchPhase.PlayerTurns, genesis.Phase);
        Assert.Equal(ids[0], genesis.ActivePlayerId);
        Assert.Equal(playerCount, genesis.TotalTurns);
        Assert.Equal(0, genesis.CompletedTurns);
        Assert.Empty(genesis.CompletedPlayerIds);
        Assert.Equal(ids, genesis.RemainingPlayerIds);

        var startStreet = match.Snapshot().Players[0].StreetId;
        var destination = board.Streets.Single(s => s.Id == startStreet).Neighbors[0];
        var move = match.TryFreeMove(ids[0], destination, 0);
        Assert.True(move.Accepted);
        var moved = match.VerifiedFirstRoundTurnProgress();
        Assert.Equal(1, moved.VerifiedRevision);
        Assert.Equal(0, moved.CompletedTurns);
        Assert.Equal(ids, moved.RemainingPlayerIds);
        Assert.Equal(ids[0], moved.ActivePlayerId);

        for (var i = 0; i < playerCount; i++)
        {
            var before = JsonSerializer.Serialize(match.CaptureCheckpoint());
            var progress = match.VerifiedFirstRoundTurnProgress();
            Assert.Equal(i, progress.CompletedTurns);
            Assert.Equal(ids.Take(i), progress.CompletedPlayerIds);
            Assert.Equal(ids.Skip(i), progress.RemainingPlayerIds);
            Assert.Equal(ids[i], progress.ActivePlayerId);
            Assert.Equal(before, JsonSerializer.Serialize(match.CaptureCheckpoint()));
            Assert.Throws<NotSupportedException>(() =>
                ((IList<string>)progress.RemainingPlayerIds)[0] = "tampered");
            var result = match.TryEndTurn(ids[i], match.Revision);
            Assert.True(result.Accepted);
            Assert.True(match.VerifyPublicAudit().IsValid);
        }

        var beforeFinalRead = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var final = match.VerifiedFirstRoundTurnProgress();
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, final.Phase);
        Assert.Null(final.ActivePlayerId);
        Assert.Equal(playerCount, final.TotalTurns);
        Assert.Equal(playerCount, final.CompletedTurns);
        Assert.Equal(ids, final.CompletedPlayerIds);
        Assert.Empty(final.RemainingPlayerIds);
        Assert.Equal(playerCount + 1L, final.VerifiedRevision);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<string>)final.CompletedPlayerIds)[0] = "tampered");
        Assert.Equal(beforeFinalRead, JsonSerializer.Serialize(match.CaptureCheckpoint()));
        Assert.All(match.Snapshot().Players, p => Assert.Equal(4, p.Atoms));
        Assert.Equal(playerCount + 2, match.Snapshot().Events.Count);
    }

    [Fact]
    public void RestoredFullDeckProgressIsReadOnlyAndNeverExposesPrivateCards()
    {
        var board = BoardCatalog.LoadDefault();
        var original = GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), board, ["alice", "bob"],
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);
        var aliceCards = original.PrivateHandForActor("alice")!.CardIds.ToArray();
        Assert.True(original.TryEndTurn("alice", 0).Accepted);
        var restored = GameMatch.RestoreFromCheckpoint(board, original.CaptureCheckpoint());
        var before = JsonSerializer.Serialize(restored.CaptureCheckpoint());
        var progress = restored.VerifiedFirstRoundTurnProgress();
        Assert.Equal(1, progress.VerifiedRevision);
        Assert.Equal(1, progress.CompletedTurns);
        Assert.Equal(["alice"], progress.CompletedPlayerIds);
        Assert.Equal(["bob"], progress.RemainingPlayerIds);
        Assert.Equal("bob", progress.ActivePlayerId);
        var publicJson = JsonSerializer.Serialize(progress);
        Assert.DoesNotContain("cardIds", publicJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", publicJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("atoms", publicJson, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("drawPile", publicJson, StringComparison.OrdinalIgnoreCase);
        foreach (var card in aliceCards)
            Assert.DoesNotContain(card, publicJson);
        Assert.Equal(aliceCards, restored.PrivateHandForActor("alice")!.CardIds);
        Assert.Equal(before, JsonSerializer.Serialize(restored.CaptureCheckpoint()));
    }
}
