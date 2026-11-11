using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// The in-page PvP unread feed (#44) consumes only the same verified first-round
/// public frames as /history. These tests exercise its authoritative source,
/// not a separate browser-derived movement or a private match checkpoint.
/// </summary>
public sealed class VerifiedOpponentActivitySourceTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public void ReplayActivityCanFilterEveryOpponentWithoutCountingGenesisOrOwnActions(int count)
    {
        var board = BoardCatalog.LoadDefault();
        var participants = board.Slots.Take(count)
            .Select((lot, i) => new MatchParticipantSeed($"player-{i}", lot.Id))
            .ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, participants);
        var names = participants.Select(x => x.PlayerId).ToArray();
        var initial = match.VerifyPublicAudit();
        Assert.True(initial.IsValid);
        Assert.Single(initial.Frames);
        Assert.Equal("match-created", initial.Frames[0].Kind);

        // Every odd seat moves once, then all seats end their round-one turn.
        for (var i = 0; i < count; i++)
        {
            var actor = match.ActivePlayerId!;
            Assert.Equal(names[i], actor);
            if (i % 2 == 1)
            {
                var player = match.Snapshot().Players.Single(x => x.PlayerId == actor);
                var adjacent = board.Streets.Single(x => x.Id == player.StreetId).Neighbors[0];
                Assert.True(match.TryFreeMove(actor, adjacent, match.Revision).Accepted);
                var moved = match.VerifyPublicAudit();
                Assert.True(moved.IsValid);
                Assert.Equal(actor, moved.Frames[^1].ActorId);
                Assert.Equal("free-move", moved.Frames[^1].Kind);
            }
            Assert.True(match.TryEndTurn(actor, match.Revision).Accepted);
        }

        var checkpoint = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var verified = match.VerifyPublicAudit();
        Assert.True(verified.IsValid);
        Assert.Equal(match.Revision, verified.VerifiedRevision);
        Assert.Equal(match.Revision + 1, verified.Frames.Count);
        Assert.Equal("round-settlement-pending", verified.Frames[^1].Kind);
        Assert.Equal(names[^1], verified.Frames[^1].ActorId);
        Assert.Throws<NotSupportedException>(() =>
            ((IList<MatchReplayFrame>)verified.Frames)[0] = verified.Frames[^1]);

        var allowed = new HashSet<string>(StringComparer.Ordinal)
        {
            "free-move", "turn-ended", "round-settlement-pending"
        };
        foreach (var viewer in names)
        {
            var unread = verified.Frames.Where(frame => frame.Revision > 0
                && frame.ActorId != viewer && allowed.Contains(frame.Kind)).ToArray();
            Assert.All(unread, frame =>
            {
                Assert.NotEqual(viewer, frame.ActorId);
                Assert.Contains(frame.ActorId, names);
                Assert.True(frame.Revision > 0);
                Assert.Contains(frame.Kind, allowed);
                Assert.Equal(1, frame.Players.Count(p => p.PlayerId == viewer));
            });
            Assert.Equal(verified.Frames.Count - 1
                - verified.Frames.Count(f => f.Revision > 0 && f.ActorId == viewer),
                unread.Length);
        }
        Assert.Equal(checkpoint, JsonSerializer.Serialize(match.CaptureCheckpoint()));
    }

    [Fact]
    public void TamperedReplayReturnsNoPartialFramesToFeed()
    {
        var board = BoardCatalog.LoadDefault();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board,
            [new("alice", "N-01"), new("bob", "S-01")]);
        Assert.True(match.TryEndTurn("alice", 0).Accepted);
        var original = match.Snapshot();
        var changed = original.Events.ToArray();
        changed[1] = changed[1] with { ActorId = "bob" };
        var forged = original with { Events = Array.AsReadOnly(changed) };
        var verification = MatchAuditReplay.Verify(board, forged);
        Assert.False(verification.IsValid);
        Assert.Empty(verification.Frames);
        Assert.True(match.VerifyPublicAudit().IsValid);
        Assert.Equal(1, match.Revision);
    }

    [Fact]
    public void FullDeckReplayNeverContainsPrivateHandsAndRemainsValidAfterRestore()
    {
        var board = BoardCatalog.LoadDefault();
        var original = GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), board, ["alice", "bob"],
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);
        var hidden = original.PrivateHandForActor("alice")!.CardIds.ToArray();
        Assert.True(original.TryEndTurn("alice", 0).Accepted);
        var match = GameMatch.RestoreFromCheckpoint(board, original.CaptureCheckpoint());
        var before = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var verified = match.VerifyPublicAudit();
        Assert.True(verified.IsValid);
        Assert.Equal(1, verified.VerifiedRevision);
        Assert.Equal(2, verified.Frames.Count);
        Assert.Equal("turn-ended", verified.Frames[1].Kind);
        Assert.Equal("alice", verified.Frames[1].ActorId);
        var serialized = JsonSerializer.Serialize(verified.Frames);
        foreach (var cardId in hidden)
            Assert.DoesNotContain(cardId, serialized);
        Assert.DoesNotContain("CardIds", serialized);
        Assert.DoesNotContain("DrawPile", serialized);
        Assert.DoesNotContain("Token", serialized);
        Assert.DoesNotContain("Atoms", serialized);
        Assert.Equal(before, JsonSerializer.Serialize(match.CaptureCheckpoint()));
        Assert.Equal(hidden, match.PrivateHandForActor("alice")!.CardIds);
    }
}
