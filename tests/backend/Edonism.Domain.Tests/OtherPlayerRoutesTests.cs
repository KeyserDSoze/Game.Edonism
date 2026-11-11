using System.Text.Json;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class OtherPlayerRoutesTests
{
    private static GameMatch FullMatch(int count)
    {
        var ids = Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray();
        return GameMatch.CreateFromTrustedFullDeckSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(), ids,
            CharacterSetupFixture.Catalog(), ActivitySetupFixture.Catalog(),
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId, 2026);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void EveryActorReceivesOnlyOtherPublicPlayersAtAuditedRevision(int playerCount)
    {
        var match = FullMatch(playerCount);
        var originalCheckpoint = JsonSerializer.Serialize(match.CaptureCheckpoint());
        var snapshot = match.Snapshot();
        var board = BoardCatalog.LoadDefault();

        foreach (var actor in snapshot.Players)
        {
            var plan = match.VerifiedOtherPlayerRoutesForActor(actor.PlayerId)!;
            Assert.Equal(match.MatchId, plan.MatchId);
            Assert.Equal(actor.PlayerId, plan.PlayerId);
            Assert.Equal(actor.StreetId, plan.FromStreetId);
            Assert.Equal(1, plan.Round);
            Assert.Equal(0, plan.VerifiedRevision);
            Assert.Equal(playerCount - 1, plan.Others.Count);
            Assert.DoesNotContain(plan.Others, other => other.OtherPlayerId == actor.PlayerId);
            Assert.Equal(playerCount - 1, plan.Others.Select(o => o.OtherPlayerId).Distinct().Count());
            Assert.Equal(plan.Others.OrderBy(o => o.StreetSteps)
                .ThenBy(o => o.OtherPlayerId, StringComparer.Ordinal), plan.Others);
            Assert.Throws<NotSupportedException>(() =>
                ((IList<MatchOtherPlayerRoute>)plan.Others).Clear());

            foreach (var other in plan.Others)
            {
                var publicOther = Assert.Single(snapshot.Players,
                    p => p.PlayerId == other.OtherPlayerId);
                var controlled = snapshot.ControlledActivities
                    .Where(c => c.OwnerPlayerId == other.OtherPlayerId).ToArray();
                Assert.Equal(publicOther.StreetId, other.StreetId);
                Assert.Equal(board.ShortestStreetDistance(actor.StreetId, other.StreetId),
                    other.StreetSteps);
                Assert.Equal(board.ShortestStreetPath(actor.StreetId, other.StreetId),
                    other.StreetPath);
                Assert.Equal(other.StreetSteps + 1, other.StreetPath.Count);
                Assert.Throws<NotSupportedException>(() =>
                    ((IList<string>)other.StreetPath)[0] = "fake");
                Assert.Equal(controlled.Length, other.ControlledActivities);
                Assert.Equal(controlled.Count(c => c.Posture == HenchmanPosture.Standing),
                    other.StandingHenchmen);
            }

            var json = JsonSerializer.Serialize(plan);
            foreach (var secret in match.PrivateHandForActor(actor.PlayerId)!.CardIds)
                Assert.DoesNotContain(secret, json);
            Assert.DoesNotContain("cardIds", json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("tokens", json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("faction", json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("atoms", json, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("hearts", json, StringComparison.OrdinalIgnoreCase);
        }

        Assert.Null(match.VerifiedOtherPlayerRoutesForActor("intruder"));
        Assert.Equal(originalCheckpoint, JsonSerializer.Serialize(match.CaptureCheckpoint()));
    }

    [Fact]
    public void TwoPlayersOnTheSameStreetHaveZeroStepsAndAnInclusivePath()
    {
        var match = GameMatch.CreateFromTrustedSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(),
            [new MatchParticipantSeed("alice", "N-01"),
             new MatchParticipantSeed("bob", "N-02")]);
        var alice = match.VerifiedOtherPlayerRoutesForActor("alice")!;
        var other = Assert.Single(alice.Others);
        Assert.Equal("bob", other.OtherPlayerId);
        Assert.Equal("gauss", other.StreetId);
        Assert.Equal(0, other.StreetSteps);
        Assert.Equal(new[] { "gauss" }, other.StreetPath);
        Assert.Equal(1, other.ControlledActivities);
        Assert.Equal(1, other.StandingHenchmen);
    }

    [Fact]
    public void ARealMovementChangesDistancesButProjectionNeverAdvancesGameplay()
    {
        var match = GameMatch.CreateFromTrustedSetup(
            Guid.NewGuid(), BoardCatalog.LoadDefault(),
            [new MatchParticipantSeed("alice", "N-01"),
             new MatchParticipantSeed("bob", "S-01")]);
        var before = match.VerifiedOtherPlayerRoutesForActor("alice")!;
        Assert.Equal(2, Assert.Single(before.Others).StreetSteps);

        var move = match.TryFreeMove("alice", "main-square", 0);
        Assert.True(move.Accepted);
        var after = match.VerifiedOtherPlayerRoutesForActor("alice")!;
        Assert.Equal(1, after.VerifiedRevision);
        Assert.Equal("main-square", after.FromStreetId);
        Assert.Equal(new[] { "main-square", "einstein" },
            Assert.Single(after.Others).StreetPath);
        var bob = match.VerifiedOtherPlayerRoutesForActor("bob")!;
        Assert.Equal(1, bob.VerifiedRevision);
        Assert.Equal("main-square", Assert.Single(bob.Others).StreetId);
        Assert.Equal(1, Assert.Single(bob.Others).StreetSteps);
        Assert.Equal(1, match.Revision);
        Assert.Equal(4, match.Snapshot().Players[0].Atoms);

        Assert.True(match.TryEndTurn("alice", 1).Accepted);
        Assert.True(match.TryEndTurn("bob", 2).Accepted);
        Assert.Equal(3, match.VerifiedOtherPlayerRoutesForActor("alice")!.VerifiedRevision);
        Assert.Equal(MatchPhase.AwaitingRoundSettlement, match.Phase);
    }

    [Fact]
    public void EncryptedCheckpointEquivalentStateRestoresTheSamePublicOpponentPlan()
    {
        var match = FullMatch(4);
        Assert.True(match.TryEndTurn("player-0", 0).Accepted);
        var expected = match.VerifiedOtherPlayerRoutesForActor("player-2");
        var restored = GameMatch.RestoreFromCheckpoint(
            BoardCatalog.LoadDefault(), match.CaptureCheckpoint());
        var actual = restored.VerifiedOtherPlayerRoutesForActor("player-2");
        Assert.Equal(JsonSerializer.Serialize(expected), JsonSerializer.Serialize(actual));
        Assert.Equal(1, restored.Revision);
        Assert.Equal(match.PrivateHandForActor("player-2")!.CardIds,
            restored.PrivateHandForActor("player-2")!.CardIds);
    }
}
