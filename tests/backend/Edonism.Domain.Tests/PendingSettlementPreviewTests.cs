using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class PendingSettlementPreviewTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public void AllFirstRoundTurnsYieldImmutableReadOnlyVerifiedGrossPreview(int playerCount)
    {
        var board = BoardCatalog.LoadDefault();
        var seeds = board.Slots.Take(playerCount)
            .Select((slot, i) => new MatchParticipantSeed($"player-{i}", slot.Id))
            .ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, seeds);
        var initial = match.Snapshot();
        Assert.Null(match.PendingSettlementPreview());

        // Neither first-turn free moves nor intermediate completed turns
        // should yield a settlement quote ahead of the last actor.
        for (var i = 0; i < playerCount; i++)
        {
            var actor = match.ActivePlayerId!;
            Assert.Equal($"player-{i}", actor);
            var ended = match.TryEndTurn(actor, match.Revision);
            Assert.True(ended.Accepted);
            if (i != playerCount - 1)
                Assert.Null(match.PendingSettlementPreview());
        }

        var beforeRead = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var preview = match.PendingSettlementPreview();
        Assert.NotNull(preview);
        Assert.Equal(match.MatchId, preview.MatchId);
        Assert.Equal(1, preview.Round);
        Assert.Equal(playerCount, preview.VerifiedRevision);
        Assert.Equal(match.Snapshot().ProposedNextRoundOrder, preview.NextTurnOrder);
        Assert.Equal($"player-{playerCount - 1}", preview.NextTurnOrder[0]);
        Assert.Equal(playerCount, preview.GrossSalaryQuotes.Count);
        Assert.Equal(Enumerable.Range(0, playerCount).Select(i => $"player-{i}"),
            preview.GrossSalaryQuotes.Select(x => x.PlayerId));
        Assert.All(preview.GrossSalaryQuotes, q =>
        {
            Assert.Equal(2, q.BaseAtoms);
            Assert.Equal(1, q.StandingActivityAtoms);
            Assert.Equal(3, q.GrossAtoms);
        });
        Assert.All(match.Snapshot().Players, player =>
        {
            Assert.Equal(4, player.Atoms);
            Assert.Equal(2, player.DiplomacyTokens);
            Assert.Equal(15, player.HenchmenAvailable);
        });
        Assert.True(match.VerifyPublicAudit().IsValid);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<string>)preview.NextTurnOrder)[0] = "forged");
        Assert.Throws<NotSupportedException>(() =>
            ((IList<MatchGrossSalaryQuote>)preview.GrossSalaryQuotes)[0] =
                new MatchGrossSalaryQuote("forged", 0, 0, 0));
        Assert.Equal(beforeRead, JsonSerializer.Serialize(match.CaptureCheckpoint()));
        Assert.Equal(beforeRead, JsonSerializer.Serialize(match.CaptureCheckpoint()));
    }

    [Fact]
    public void PreviewAfterCheckpointRestoreDoesNotChangeCardsOrState()
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), board, ["alice", "bob"],
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);
        var aliceCards = match.PrivateHandForActor("alice")!.CardIds.ToArray();
        var bobCards = match.PrivateHandForActor("bob")!.CardIds.ToArray();
        Assert.True(match.TryEndTurn("alice", 0).Accepted);
        Assert.True(match.TryEndTurn("bob", 1).Accepted);
        var restored = GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint());
        var before = JsonSerializer.Serialize(restored.CaptureCheckpoint());
        var preview = restored.PendingSettlementPreview();
        Assert.NotNull(preview);
        Assert.Equal(2, preview.VerifiedRevision);
        Assert.Equal(before, JsonSerializer.Serialize(restored.CaptureCheckpoint()));
        Assert.Equal(aliceCards, restored.PrivateHandForActor("alice")!.CardIds);
        Assert.Equal(bobCards, restored.PrivateHandForActor("bob")!.CardIds);
        var publicJson = JsonSerializer.Serialize(preview);
        Assert.DoesNotContain("CardIds", publicJson);
        Assert.DoesNotContain("Token", publicJson);
        Assert.DoesNotContain("PrivateDeal", publicJson);
        Assert.All(restored.Snapshot().Players, p => Assert.Equal(4, p.Atoms));
    }
}
