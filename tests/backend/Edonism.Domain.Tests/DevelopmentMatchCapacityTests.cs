using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Api.Development;
using Edonism.Domain.Matches;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentMatchCapacityTests
{
    private static MatchParticipantSeed[] Players() =>
        [new("alice", "N-01"), new("bob", "S-01")];

    private static void AssertPrivate(HttpResponseMessage response, HttpStatusCode status)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.True(response.Headers.TryGetValues("Pragma", out var pragma));
        Assert.Equal("no-cache", Assert.Single(pragma!));
        var hasExpires = response.Headers.TryGetValues("Expires", out var values)
            || response.Content.Headers.TryGetValues("Expires", out values);
        Assert.True(hasExpires);
        Assert.Equal("0", Assert.Single(values!));
    }

    [Fact]
    public void ConcurrentCreatorsCanOnlyPublishSixtyFourFixturesAndExistingSeatsSurvive()
    {
        var store = new DevelopmentMatchStore();
        var created = new ConcurrentBag<DevMatchCreated>();
        var rejected = 0;

        Parallel.For(0, 128, _ =>
        {
            try { created.Add(store.Create(Players())); }
            catch (DevelopmentMatchCapacityException)
            {
                Interlocked.Increment(ref rejected);
            }
        });

        Assert.Equal(DevelopmentMatchStore.MaxNewMatchesPerProcess, created.Count);
        Assert.Equal(64, rejected);
        Assert.Equal(created.Count, created.Select(c => c.MatchId).Distinct().Count());

        foreach (var match in created)
        {
            Assert.Equal(2, match.Credentials.Count);
            Assert.All(match.Credentials, credential =>
            {
                Assert.True(store.TryRead(match.MatchId, credential.Token, out var snapshot));
                Assert.Equal(0, snapshot!.Revision);
            });
            Assert.False(store.TryRead(match.MatchId, new string('0', 64), out _));
        }
        var first = created.First();
        var alice = first.Credentials.Single(p => p.PlayerId == "alice");
        Assert.True(store.TryEndTurn(first.MatchId, alice.Token, 0, out var endTurn));
        Assert.True(endTurn!.Accepted);
        Assert.Equal(1, endTurn.State.Revision);
        Assert.Throws<DevelopmentMatchCapacityException>(() => store.Create(Players()));
    }

    [Fact]
    public void RejectedSetupNeverConsumesCreationCapacity()
    {
        var store = new DevelopmentMatchStore(maxNewMatches: 1);
        Assert.Throws<ArgumentException>(() => store.Create(
            [new MatchParticipantSeed("alice", "N-01")]));
        var match = store.Create(Players());
        Assert.NotEqual(Guid.Empty, match.MatchId);
        Assert.Throws<DevelopmentMatchCapacityException>(() => store.Create(Players()));
        Assert.True(store.TryRead(match.MatchId, match.Credentials[0].Token, out _));
    }

    [Fact]
    public async Task AllFourCreatorsReturn503WithoutCredentialsAfterCapacityAndOldSessionStillWorks()
    {
        using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<DevelopmentMatchStore>();
                services.AddSingleton(new DevelopmentMatchStore(maxNewMatches: 2));
            });
        });
        using var client = host.CreateClient();
        var root = new
        {
            players = new[]
            {
                new { playerId = "alice", startingSlotId = "N-01" },
                new { playerId = "bob", startingSlotId = "S-01" }
            }
        };
        var ids = new List<(Guid Id, string Token)>();
        for (var index = 0; index < 2; index++)
        {
            using var created = await client.PostAsJsonAsync("/api/dev/matches/", root);
            AssertPrivate(created, HttpStatusCode.Created);
            using var json = await created.Content.ReadFromJsonAsync<JsonDocument>();
            ids.Add((
                json!.RootElement.GetProperty("matchId").GetGuid(),
                json.RootElement.GetProperty("credentials")[0].GetProperty("token").GetString()!
            ));
        }

        var requests = new (string Path, object Payload)[]
        {
            ("/api/dev/matches/", root),
            ("/api/dev/matches/from-cards", new
            {
                players = new[]
                {
                    new { playerId = "alice", startingCardId = "sport:01" },
                    new { playerId = "bob", startingCardId = "public-financing:01" }
                },
                availableActivities = ActivitySetupFixture.Catalog(),
                seed = 2026
            }),
            ("/api/dev/matches/from-characters", new
            {
                playerIds = new[] { "alice", "bob" },
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                seed = 2026
            }),
            ("/api/dev/matches/from-full-deck", new
            {
                playerIds = new[] { "alice", "bob" },
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            })
        };

        foreach (var (path, payload) in requests)
        {
            using var denied = await client.PostAsJsonAsync(path, payload);
            AssertPrivate(denied, HttpStatusCode.ServiceUnavailable);
            Assert.Null(denied.Headers.Location);
            using var json = await denied.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.Equal("dev_match_capacity_reached",
                json!.RootElement.GetProperty("code").GetString());
            Assert.False(json.RootElement.TryGetProperty("credentials", out _));
            Assert.False(json.RootElement.TryGetProperty("state", out _));
        }

        using var seat = host.CreateClient();
        seat.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", ids[0].Token);
        using var snapshot = await seat.GetAsync($"/api/dev/matches/{ids[0].Id}");
        AssertPrivate(snapshot, HttpStatusCode.OK);
        using var moved = await seat.PostAsJsonAsync(
            $"/api/dev/matches/{ids[0].Id}/end-turn",
            new { expectedRevision = 0 });
        AssertPrivate(moved, HttpStatusCode.OK);
        using var other = await seat.GetAsync($"/api/dev/matches/{ids[1].Id}");
        AssertPrivate(other, HttpStatusCode.NotFound);
        using var meta = await client.GetAsync("/api/v1/meta");
        Assert.Equal(HttpStatusCode.OK, meta.StatusCode);
    }

    [Fact]
    public async Task ProductionDoesNotExposeCapacityOrCreationRoutes()
    {
        using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment("Production"));
        using var client = host.CreateClient();
        using var response = await client.PostAsJsonAsync("/api/dev/matches/", new
        {
            players = new[]
            {
                new { playerId = "alice", startingSlotId = "N-01" },
                new { playerId = "bob", startingSlotId = "S-01" }
            }
        });
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public void FailedEncryptedSaveDoesNotConsumeSlotOrPublishMatch()
    {
        var directory = Path.Combine(Path.GetTempPath(),
            "edonism-fixture-capacity-" + Guid.NewGuid().ToString("N"));
        try
        {
            var disk = new DevelopmentMatchCheckpointFiles(directory, new string('A', 64));
            var store = new DevelopmentMatchStore(disk, maxNewMatches: 1);
            Directory.Delete(directory);
            // An ordinary file occupying the checkpoint directory forces a
            // write failure, without requiring root privileges or chmod.
            File.WriteAllText(directory, "blocked");
            Assert.ThrowsAny<IOException>(() => store.Create(Players()));
            File.Delete(directory);
            Directory.CreateDirectory(directory);

            var created = store.Create(Players());
            Assert.True(store.TryRead(created.MatchId, created.Credentials[0].Token, out _));
            Assert.Single(Directory.GetFiles(directory, "*.edonism"));
            Assert.Throws<DevelopmentMatchCapacityException>(() => store.Create(Players()));
        }
        finally
        {
            if (File.Exists(directory)) File.Delete(directory);
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

    [Fact]
    public void CheckpointRestoresStayAccessibleWithoutConsumingNewCreationSlots()
    {
        var directory = Path.Combine(Path.GetTempPath(),
            "edonism-fixture-reload-" + Guid.NewGuid().ToString("N"));
        try
        {
            var disk = new DevelopmentMatchCheckpointFiles(directory, new string('B', 64));
            var originalStore = new DevelopmentMatchStore(disk, maxNewMatches: 1);
            var original = originalStore.Create(Players());
            var restoredStore = new DevelopmentMatchStore(disk, maxNewMatches: 1);

            Assert.True(restoredStore.TryRead(original.MatchId,
                original.Credentials[0].Token, out var before));
            Assert.Equal(0, before!.Revision);
            var next = restoredStore.Create(Players());
            Assert.NotEqual(original.MatchId, next.MatchId);
            Assert.Throws<DevelopmentMatchCapacityException>(
                () => restoredStore.Create(Players()));
            Assert.True(restoredStore.TryRead(original.MatchId,
                original.Credentials[1].Token, out _));
            Assert.True(restoredStore.TryRead(next.MatchId,
                next.Credentials[0].Token, out _));
            Assert.Equal(2, Directory.GetFiles(directory, "*.edonism").Length);
        }
        finally
        {
            if (Directory.Exists(directory)) Directory.Delete(directory, recursive: true);
        }
    }

}
