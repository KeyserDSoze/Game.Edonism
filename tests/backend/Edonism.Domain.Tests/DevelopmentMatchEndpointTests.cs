using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentMatchEndpointTests
{
    private static WebApplicationFactory<Program> DevFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment("Development"));

    private static async Task<(Guid MatchId, string Alice, string Bob)> CreateMatch(HttpClient client)
    {
        using var result = await client.PostAsJsonAsync("/api/dev/matches/", new
        {
            players = new[]
            {
                new { playerId = "alice", startingSlotId = "N-01" },
                new { playerId = "bob", startingSlotId = "S-01" }
            }
        });
        Assert.Equal(HttpStatusCode.Created, result.StatusCode);

        using var json = await result.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(json);
        var root = json.RootElement;
        var matchId = root.GetProperty("matchId").GetGuid();
        var seats = root.GetProperty("credentials").EnumerateArray().ToArray();
        Assert.Equal(2, seats.Length);
        return (matchId,
            seats.Single(s => s.GetProperty("playerId").GetString() == "alice").GetProperty("token").GetString()!,
            seats.Single(s => s.GetProperty("playerId").GetString() == "bob").GetProperty("token").GetString()!);
    }

    [Fact]
    public async Task DevelopmentMoveIsBoundToTokenActorAndOneFreeStep()
    {
        using var factory = DevFactory();
        using var setupClient = factory.CreateClient();
        var (id, aliceToken, bobToken) = await CreateMatch(setupClient);
        using var alice = factory.CreateClient();
        alice.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", aliceToken);
        using var bob = factory.CreateClient();
        bob.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", bobToken);

        using (var badActor = await bob.PostAsJsonAsync($"/api/dev/matches/{id}/free-move", new
        { destinationStreetId = "planck", expectedRevision = 0, playerId = "alice" }))
        {
            Assert.Equal(HttpStatusCode.Conflict, badActor.StatusCode);
            using var error = await badActor.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.Equal("not_your_turn", error!.RootElement.GetProperty("code").GetString());
        }

        using (var move = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move", new
        { destinationStreetId = "planck", expectedRevision = 0 }))
        {
            Assert.Equal(HttpStatusCode.OK, move.StatusCode);
            using var state = await move.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.Equal(1, state!.RootElement.GetProperty("revision").GetInt64());
            Assert.Equal("planck", state.RootElement.GetProperty("players")[0].GetProperty("streetId").GetString());
        }

        using (var stale = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move", new
        { destinationStreetId = "gauss", expectedRevision = 0 }))
            Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        using (var doubleMove = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move", new
        { destinationStreetId = "meson", expectedRevision = 1 }))
            Assert.Equal(HttpStatusCode.Conflict, doubleMove.StatusCode);

        using (var finish = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn", new { expectedRevision = 1 }))
            Assert.Equal(HttpStatusCode.OK, finish.StatusCode);

        using (var bobMove = await bob.PostAsJsonAsync($"/api/dev/matches/{id}/free-move", new
        { destinationStreetId = "newton", expectedRevision = 2 }))
            Assert.Equal(HttpStatusCode.OK, bobMove.StatusCode);

        using var read = await bob.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        using var snapshot = await read.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal(3, snapshot!.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal("bob", snapshot.RootElement.GetProperty("activePlayerId").GetString());
        Assert.Equal(4, snapshot.RootElement.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task UnknownCredentialDoesNotReadOrMutateMatch()
    {
        using var factory = DevFactory();
        using var setup = factory.CreateClient();
        var (id, _, _) = await CreateMatch(setup);

        using var untrusted = factory.CreateClient();
        untrusted.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", "NOT_A_VALID_TOKEN");
        using var read = await untrusted.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.NotFound, read.StatusCode);
        using var move = await untrusted.PostAsJsonAsync($"/api/dev/matches/{id}/free-move", new
        { destinationStreetId = "planck", expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.NotFound, move.StatusCode);
    }

    [Fact]
    public async Task ConcurrentSameRevisionCommandsCannotBothSucceed()
    {
        using var factory = DevFactory();
        using var setup = factory.CreateClient();
        var (id, aliceToken, _) = await CreateMatch(setup);
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", aliceToken);

        var requests = await Task.WhenAll(
            client.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
                new { destinationStreetId = "planck", expectedRevision = 0 }),
            client.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
                new { destinationStreetId = "newton", expectedRevision = 0 }));

        Assert.Single(requests.Where(r => r.StatusCode == HttpStatusCode.OK));
        Assert.Single(requests.Where(r => r.StatusCode == HttpStatusCode.Conflict));
        foreach (var response in requests) response.Dispose();
    }

    [Fact]
    public async Task InvalidDevelopmentFixturesAreRejected()
    {
        using var factory = DevFactory();
        using var client = factory.CreateClient();
        using var response = await client.PostAsJsonAsync("/api/dev/matches/", new
        {
            players = new[]
            {
                new { playerId = "a", startingSlotId = "N-01" },
                new { playerId = "b", startingSlotId = "WRONG" }
            }
        });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task ProductionNeverRegistersDevelopmentGameMutationRoutes()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment("Production"));
        using var client = factory.CreateClient();
        using var create = await client.PostAsJsonAsync("/api/dev/matches/", new
        {
            players = new[]
            {
                new { playerId = "a", startingSlotId = "N-01" },
                new { playerId = "b", startingSlotId = "S-01" }
            }
        });
        Assert.Equal(HttpStatusCode.NotFound, create.StatusCode);
        using var board = await client.GetAsync("/api/v1/board");
        Assert.Equal(HttpStatusCode.OK, board.StatusCode);
    }
}
