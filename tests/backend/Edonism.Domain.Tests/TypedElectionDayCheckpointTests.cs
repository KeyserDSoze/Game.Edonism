using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #163: the typed Election Day identity is PRIVATE checkpoint metadata.
/// It does not implement an election trigger, reveal another seat's hand,
/// infer the marker from an ID prefix, or mutate first-round commands.
/// </summary>
public sealed class TypedElectionDayCheckpointTests
{
    private static GameMatch Full(int count, int seed = 2026) =>
        GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(),
            Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray(),
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, seed);

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void FreshPrivateDeckKeepsExactlyOneTypedElectionDayThroughTurnsAndRestore(int count)
    {
        var match = Full(count);
        var initial = match.Snapshot();
        var checkpoint = match.CaptureCheckpoint();
        Assert.Equal(GameMatch.CheckpointVersion, checkpoint.FormatVersion);
        Assert.Equal(2, checkpoint.FormatVersion);
        Assert.NotNull(checkpoint.PrivateDeal);
        var deal = checkpoint.PrivateDeal;
        Assert.Equal(ActionDeckFixture.ElectionDayId, deal!.ElectionDayCardId);
        Assert.True(InitialActionDeckComposer.MatchesRecordedShuffle(
            deal, initial.TurnOrder, requireElectionDayMarker: true));
        var all = deal.Hands.SelectMany(hand => hand.CardIds)
            .Concat(deal.RemainingDrawPile).ToArray();
        Assert.Equal(59, all.Length);
        Assert.Single(all, id => id == deal.ElectionDayCardId);
        Assert.All(deal.Hands, hand => Assert.Equal(4, hand.CardIds.Count));
        Assert.Equal(59 - 4 * count, deal.RemainingDrawPile.Count);

        var expectedHands = initial.Players.ToDictionary(
            player => player.PlayerId,
            player => match.PrivateHandForActor(player.PlayerId)!.CardIds.ToArray(),
            StringComparer.Ordinal);
        var initialPrivate = JsonSerializer.Serialize(checkpoint.PrivateDeal);
        foreach (var player in initial.Players)
        {
            var ownHand = match.PrivateHandForActor(player.PlayerId);
            Assert.NotNull(ownHand);
            Assert.Equal(expectedHands[player.PlayerId], ownHand.CardIds);
            Assert.DoesNotContain("ElectionDayCardId", JsonSerializer.Serialize(ownHand));
        }
        var snapshotWire = JsonSerializer.Serialize(initial);
        var auditWire = JsonSerializer.Serialize(match.VerifyPublicAudit());
        Assert.DoesNotContain("ElectionDayCardId", snapshotWire);
        Assert.DoesNotContain("ElectionDayCardId", auditWire);
        Assert.DoesNotContain(ActionDeckFixture.ElectionDayId, snapshotWire);
        Assert.DoesNotContain(ActionDeckFixture.ElectionDayId, auditWire);

        var first = initial.Players[0];
        var board = BoardCatalog.LoadDefault();
        var to = board.Streets.Single(s => s.Id == first.StreetId).Neighbors[0];
        Assert.True(match.TryFreeMove(first.PlayerId, to, 0).Accepted);
        foreach (var seat in initial.Players)
            Assert.True(match.TryEndTurn(seat.PlayerId, match.Revision).Accepted);
        Assert.True(match.VerifyPublicAudit().IsValid);
        Assert.Equal(initialPrivate,
            JsonSerializer.Serialize(match.CaptureCheckpoint().PrivateDeal));
        var restored = GameMatch.RestoreFromCheckpoint(board, match.CaptureCheckpoint());
        Assert.Equal(GameMatch.CheckpointVersion, restored.CaptureCheckpoint().FormatVersion);
        Assert.Equal(ActionDeckFixture.ElectionDayId,
            restored.CaptureCheckpoint().PrivateDeal!.ElectionDayCardId);
        Assert.Equal(initialPrivate,
            JsonSerializer.Serialize(restored.CaptureCheckpoint().PrivateDeal));
        foreach (var (id, cards) in expectedHands)
            Assert.Equal(cards, restored.PrivateHandForActor(id)!.CardIds);
        Assert.Equal(JsonSerializer.Serialize(match.Snapshot()),
            JsonSerializer.Serialize(restored.Snapshot()));
        Assert.Equal(JsonSerializer.Serialize(match.PendingSettlementPreview()),
            JsonSerializer.Serialize(restored.PendingSettlementPreview()));
        Assert.All(restored.Snapshot().Players, player => Assert.Equal(4, player.Atoms));
    }

    [Theory]
    [InlineData("missing")]
    [InlineData("empty")]
    [InlineData("unknown")]
    [InlineData("whitespace")]
    [InlineData("future-format")]
    public void V2CheckpointFailsClosedOnMissingOrImpossibleSpecialCardMarker(string mode)
    {
        var original = Full(4).CaptureCheckpoint();
        var deal = original.PrivateDeal!;
        var bogus = mode switch
        {
            "missing" => deal with { ElectionDayCardId = null },
            "empty" => deal with { ElectionDayCardId = "" },
            "unknown" => deal with { ElectionDayCardId = "not-in-any-hand-or-pile" },
            "whitespace" => deal with { ElectionDayCardId = "   " },
            "future-format" => deal,
            _ => throw new ArgumentOutOfRangeException(nameof(mode))
        };
        var changed = original with
        {
            FormatVersion = mode == "future-format" ? 3 : original.FormatVersion,
            PrivateDeal = bogus
        };
        var error = Assert.Throws<InvalidDataException>(() =>
            GameMatch.RestoreFromCheckpoint(BoardCatalog.LoadDefault(), changed));
        Assert.DoesNotContain(ActionDeckFixture.ElectionDayId, error.Message);
        Assert.DoesNotContain("test:action:", error.Message);
        Assert.True(InitialActionDeckComposer.MatchesRecordedShuffle(
            deal, original.State.TurnOrder, requireElectionDayMarker: true));
        if (mode is "missing" or "empty" or "unknown" or "whitespace")
            Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(
                bogus, original.State.TurnOrder, requireElectionDayMarker: true));
    }

    [Fact]
    public void LegacyV1PrivateDeckStillRestoresWithoutGuessingMarkerOrUpgrading()
    {
        var original = Full(2).CaptureCheckpoint();
        var legacy = original with
        {
            FormatVersion = GameMatch.LegacyCheckpointVersion,
            PrivateDeal = original.PrivateDeal! with { ElectionDayCardId = null }
        };
        var board = BoardCatalog.LoadDefault();
        Assert.True(InitialActionDeckComposer.MatchesRecordedShuffle(
            legacy.PrivateDeal, legacy.State.TurnOrder));
        Assert.False(InitialActionDeckComposer.MatchesRecordedShuffle(
            legacy.PrivateDeal, legacy.State.TurnOrder,
            requireElectionDayMarker: true));

        var restored = GameMatch.RestoreFromCheckpoint(board, legacy);
        var replay = restored.VerifyPublicAudit();
        Assert.True(replay.IsValid);
        Assert.Equal(GameMatch.LegacyCheckpointVersion,
            restored.CaptureCheckpoint().FormatVersion);
        Assert.Null(restored.CaptureCheckpoint().PrivateDeal!.ElectionDayCardId);
        Assert.Equal(legacy.PrivateDeal.Hands[0].CardIds,
            restored.PrivateHandForActor("player-0")!.CardIds);
        Assert.True(restored.TryEndTurn("player-0", 0).Accepted);
        Assert.Equal(GameMatch.LegacyCheckpointVersion,
            restored.CaptureCheckpoint().FormatVersion);
        var second = GameMatch.RestoreFromCheckpoint(board, restored.CaptureCheckpoint());
        Assert.Null(second.CaptureCheckpoint().PrivateDeal!.ElectionDayCardId);
        Assert.True(second.VerifyPublicAudit().IsValid);

        // v1 never carried typed metadata, so it cannot claim to know the
        // physical Election Day card. A v1 checkpoint claiming v2 semantics
        // without a marker is invalid; a v1 with a v2 marker is not historical.
        Assert.Throws<InvalidDataException>(() =>
            GameMatch.RestoreFromCheckpoint(board,
                legacy with { FormatVersion = GameMatch.CheckpointVersion }));
        Assert.Throws<InvalidDataException>(() =>
            GameMatch.RestoreFromCheckpoint(board,
                original with { FormatVersion = GameMatch.LegacyCheckpointVersion }));
    }

    [Fact]
    public void ShuffleMarkerCanBeInsideFirstHandOrTheUndealtPileWithoutChangingFourCardDeal()
    {
        var cards = ActionDeckFixture.ActionIds();
        var ids = new[] { "alice", "bob" };
        InitialActionDeal? inHand = null, inPile = null;
        for (var seed = 0; seed < 200 && (inHand is null || inPile is null); seed++)
        {
            var deal = InitialActionDeckComposer.Deal(
                cards, ActionDeckFixture.ElectionDayId, ids, seed);
            if (deal.Hands.Any(h => h.CardIds.Contains(deal.ElectionDayCardId)))
                inHand ??= deal;
            else
                inPile ??= deal;
        }
        Assert.NotNull(inHand);
        Assert.NotNull(inPile);
        foreach (var deal in new[] { inHand!, inPile! })
        {
            Assert.True(InitialActionDeckComposer.MatchesRecordedShuffle(
                deal, ids, requireElectionDayMarker: true));
            Assert.All(deal.Hands, hand => Assert.Equal(4, hand.CardIds.Count));
            Assert.Single(deal.Hands.SelectMany(h => h.CardIds)
                .Concat(deal.RemainingDrawPile),
                id => id == deal.ElectionDayCardId);
        }
    }
}
