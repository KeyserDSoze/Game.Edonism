using System.Text.Json;
using Edonism.Api.Development;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #121: The Domain is the authority for a revision-scoped public snapshot.
/// Authenticated reads and bearer rotations cannot silently equivocate at an
/// unchanged revision; only an accepted command creates new public state.
/// </summary>
public sealed class DevelopmentSameRevisionSnapshotContractTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void PublicProjectionIsIdenticalAcrossSeatReadsAndTokenRotationUntilNextAcceptedTurn(
        int count)
    {
        var seats = Enumerable.Range(1, count).Select(index => $"seat-{index}").ToArray();
        var store = new DevelopmentMatchStore();
        var created = store.CreateWithFullDeck(seats,
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);
        var initial = JsonSerializer.Serialize(created.State);
        Assert.Equal(0, created.State.Revision);

        foreach (var credential in created.Credentials)
        {
            Assert.True(store.TryRead(created.MatchId, credential.Token, out var read));
            Assert.NotNull(read);
            Assert.Equal(0, read.Revision);
            Assert.Equal(initial, JsonSerializer.Serialize(read));

            Assert.True(store.TryReadHand(created.MatchId, credential.Token, out var hand));
            Assert.Equal(4, hand!.CardIds.Count);
            Assert.True(store.TryReadTurnOptions(created.MatchId, credential.Token, out var opts));
            Assert.Equal(0, opts!.Revision);
            Assert.True(store.TryBootstrapSeat(created.MatchId, credential.Token, out var joined));
            Assert.Equal(initial, JsonSerializer.Serialize(joined!.State));
        }

        var bob = created.Credentials[1];
        Assert.True(store.TryRotateSeatToken(created.MatchId, bob.Token, out var rotated));
        Assert.NotNull(rotated);
        Assert.False(store.HasSeatAccess(created.MatchId, bob.Token));
        Assert.True(store.TryRead(created.MatchId, rotated.Token, out var afterRotation));
        Assert.Equal(initial, JsonSerializer.Serialize(afterRotation));
        Assert.True(store.TryBootstrapSeat(created.MatchId, rotated.Token, out var restored));
        Assert.Equal(initial, JsonSerializer.Serialize(restored!.State));

        // First genuine command, not a read/rotation, advances the public
        // version and appends one public event. It does not change Bob's hand.
        var alice = created.Credentials[0];
        Assert.True(store.TryEndTurn(created.MatchId, alice.Token, 0, out var result));
        Assert.NotNull(result);
        Assert.True(result.Accepted, result.Code);
        Assert.True(store.TryRead(created.MatchId, rotated.Token, out var next));
        Assert.NotNull(next);
        Assert.Equal(1, next.Revision);
        Assert.NotEqual(initial, JsonSerializer.Serialize(next));
        Assert.Equal(2, next.Events.Count);
        Assert.Equal("turn-ended", next.Events[1].Kind);
        Assert.True(store.TryRead(created.MatchId, alice.Token, out var aliceRead));
        Assert.Equal(JsonSerializer.Serialize(next), JsonSerializer.Serialize(aliceRead));
    }
}
