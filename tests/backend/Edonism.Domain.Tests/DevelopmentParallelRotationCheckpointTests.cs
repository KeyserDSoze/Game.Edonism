using System.Security.Cryptography;
using System.Text.Json;
using Edonism.Api.Development;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #81: encrypted Development checkpoints publish exactly the winning
/// concurrent capability replacement for every seat, across cold reloads.
/// </summary>
public sealed class DevelopmentParallelRotationCheckpointTests
{
    private sealed class TempDirectory : IDisposable
    {
        public string PathOnDisk { get; } = Path.Combine(
            Path.GetTempPath(), "edonism-rotation-restart-" + Guid.NewGuid().ToString("N"));

        public string KeyHex { get; } =
            Convert.ToHexString(RandomNumberGenerator.GetBytes(32));

        public DevelopmentMatchCheckpointFiles Files() => new(PathOnDisk, KeyHex);

        public void Dispose()
        {
            if (Directory.Exists(PathOnDisk))
                Directory.Delete(PathOnDisk, recursive: true);
        }
    }

    private sealed record Attempt(
        string PlayerId, bool Accepted, DevSeatCredential? Replacement);

    [Theory]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(7)]
    [InlineData(8)]
    public async Task ConcurrentDoubleRotationsPersistOnlyWinnersAcrossRestart(
        int seatCount)
    {
        using var temp = new TempDirectory();
        var initialStore = new DevelopmentMatchStore(temp.Files());
        var players = Enumerable.Range(0, seatCount)
            .Select(i => $"seat-{i}").ToArray();
        var created = initialStore.CreateWithFullDeck(
            players, CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId,
            2026 + seatCount);
        var id = created.MatchId;
        Assert.Equal(seatCount, created.Credentials.Count);

        var publicBefore = JsonSerializer.Serialize(created.State);
        var handsBefore = new Dictionary<string, string[]>(StringComparer.Ordinal);
        foreach (var credential in created.Credentials)
        {
            Assert.True(initialStore.TryReadHand(id, credential.Token, out var hand));
            Assert.NotNull(hand);
            Assert.Equal(credential.PlayerId, hand.PlayerId);
            handsBefore.Add(credential.PlayerId, hand.CardIds.ToArray());
            Assert.Equal(4, hand.CardIds.Count);
        }
        Assert.Equal(seatCount * 4,
            handsBefore.Values.SelectMany(cards => cards)
                .Distinct(StringComparer.Ordinal).Count());

        var release = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously);
        var attempts = created.Credentials.SelectMany(credential =>
            Enumerable.Range(0, 2).Select(_ => Task.Run(async () =>
            {
                await release.Task;
                var accepted = initialStore.TryRotateSeatToken(
                    id, credential.Token, out var replacement);
                return new Attempt(credential.PlayerId, accepted, replacement);
            }))).ToArray();

        release.SetResult();
        var results = await Task.WhenAll(attempts);
        var winners = new Dictionary<string, DevSeatCredential>(StringComparer.Ordinal);
        foreach (var group in results.GroupBy(result => result.PlayerId))
        {
            Assert.Equal(2, group.Count());
            var winner = Assert.Single(group, item => item.Accepted);
            var loser = Assert.Single(group, item => !item.Accepted);
            Assert.Null(loser.Replacement);
            Assert.NotNull(winner.Replacement);
            Assert.Equal(group.Key, winner.Replacement.PlayerId);
            winners.Add(group.Key, winner.Replacement);
        }
        Assert.Equal(seatCount, winners.Count);
        Assert.Equal(seatCount, winners.Values.Select(w => w.Token)
            .Distinct(StringComparer.Ordinal).Count());

        // The AES-GCM authenticated checkpoint must contain the winning
        // digest for each actor, not the losing candidate or old capability.
        var checkpoint = temp.Files().Load(id);
        Assert.NotNull(checkpoint);
        Assert.Equal(seatCount, checkpoint.TokenDigests.Count);
        foreach (var original in created.Credentials)
        {
            var token = winners[original.PlayerId].Token;
            Assert.NotEqual(original.Token, token);
            Assert.Equal(Convert.ToHexString(
                    SHA256.HashData(Convert.FromHexString(token))),
                checkpoint.TokenDigests[original.PlayerId]);
            Assert.NotEqual(Convert.ToHexString(
                    SHA256.HashData(Convert.FromHexString(original.Token))),
                checkpoint.TokenDigests[original.PlayerId]);
            Assert.False(initialStore.HasSeatAccess(id, original.Token));
            Assert.True(initialStore.HasSeatAccess(id, token));
        }
        Assert.Equal(seatCount, checkpoint.TokenDigests.Values
            .Distinct(StringComparer.Ordinal).Count());

        // A new store has no live Entry. Every access now comes exclusively
        // from authenticated and validated bytes on the encrypted disk file.
        var restored = new DevelopmentMatchStore(temp.Files());
        foreach (var original in created.Credentials)
        {
            Assert.False(restored.HasSeatAccess(id, original.Token));
            Assert.False(restored.TryRead(id, original.Token, out _));
            Assert.False(restored.TryReadHand(id, original.Token, out _));
            Assert.False(restored.TryBootstrapSeat(id, original.Token, out _));

            var winner = winners[original.PlayerId];
            Assert.True(restored.TryBootstrapSeat(id, winner.Token, out var seat));
            Assert.NotNull(seat);
            Assert.Equal(original.PlayerId, seat.PlayerId);
            Assert.Equal(original.PlayerId, seat.Hand.PlayerId);
            Assert.Equal(handsBefore[original.PlayerId], seat.Hand.CardIds.ToArray());
            Assert.Equal(publicBefore, JsonSerializer.Serialize(seat.State));
            Assert.Equal(0, seat.State.Revision);
            Assert.True(restored.TryReadAudit(id, winner.Token, out var audit));
            Assert.NotNull(audit);
            Assert.True(audit.IsValid);
            Assert.Equal(0, audit.VerifiedRevision);
        }

        // A post-restart rotation must durably supersede the winner without
        // resurrecting the original bearer or mutating gameplay state.
        var first = created.Credentials[0];
        Assert.True(restored.TryRotateSeatToken(
            id, winners[first.PlayerId].Token, out var next));
        Assert.NotNull(next);
        Assert.Equal(first.PlayerId, next.PlayerId);
        Assert.NotEqual(winners[first.PlayerId].Token, next.Token);

        var reloadedAgain = new DevelopmentMatchStore(temp.Files());
        Assert.False(reloadedAgain.HasSeatAccess(id, first.Token));
        Assert.False(reloadedAgain.HasSeatAccess(id, winners[first.PlayerId].Token));
        Assert.True(reloadedAgain.TryBootstrapSeat(id, next.Token, out var last));
        Assert.NotNull(last);
        Assert.Equal(handsBefore[first.PlayerId], last.Hand.CardIds.ToArray());
        Assert.Equal(publicBefore, JsonSerializer.Serialize(last.State));
        foreach (var original in created.Credentials.Skip(1))
        {
            Assert.True(reloadedAgain.TryBootstrapSeat(id,
                winners[original.PlayerId].Token, out var peer));
            Assert.Equal(handsBefore[original.PlayerId],
                peer!.Hand.CardIds.ToArray());
            Assert.Equal(publicBefore, JsonSerializer.Serialize(peer.State));
        }
        Assert.True(reloadedAgain.TryReadAudit(id, next.Token, out var finalAudit));
        Assert.True(finalAudit!.IsValid);
        Assert.Equal(0, finalAudit.VerifiedRevision);
    }
}
