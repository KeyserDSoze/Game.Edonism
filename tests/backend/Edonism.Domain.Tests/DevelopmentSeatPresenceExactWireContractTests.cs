using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #171: real actor-authenticated GET/POST Development presence JSON has
/// only the public DevMatchPresence and DevSeatPresence wire fields.
/// Activity hints never confer a game command, timeout, login, or a
/// reason to skip a disconnected player's turn.
/// </summary>
public sealed class DevelopmentSeatPresenceExactWireContractTests
{
    private static WebApplicationFactory<Program> Host(string environment) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static string[] Keys(JsonElement objectValue) =>
        objectValue.EnumerateObject().Select(field => field.Name)
            .OrderBy(name => name, StringComparer.Ordinal).ToArray();

    private static void AssertPublicPresence(
        JsonElement value, Guid matchId, IReadOnlyList<string> ids,
        IReadOnlySet<string> active)
    {
        Assert.Equal(["matchId", "seats"], Keys(value));
        Assert.Equal(matchId, value.GetProperty("matchId").GetGuid());
        var seats = value.GetProperty("seats").EnumerateArray().ToArray();
        Assert.Equal(ids.Count, seats.Length);
        for (var index = 0; index < ids.Count; index++)
        {
            var seat = seats[index];
            Assert.Equal(["isActive", "playerId"], Keys(seat));
            Assert.Equal(ids[index], seat.GetProperty("playerId").GetString());
            Assert.Equal(active.Contains(ids[index]),
                seat.GetProperty("isActive").GetBoolean());
        }
        var raw = value.GetRawText();
        Assert.DoesNotContain("token", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("secret", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("lastSeen", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("canEndTurn", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("freeMoveStreetIds", raw, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task ActualDevelopmentHttpPresenceIsExactBearerBoundAndNeverMutatesTurn(
        int seats)
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var slots = BoardCatalog.LoadDefault().Slots.Take(seats).ToArray();
        var ids = Enumerable.Range(0, seats)
            .Select(index => $"player-{index}").ToArray();
        var players = ids.Select((id, index) => new
        {
            playerId = id,
            startingSlotId = slots[index].Id
        }).ToArray();
        using var createResponse = await creator.PostAsJsonAsync(
            "/api/dev/matches/", new { players });
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);
        using var created = await createResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var matchId = created.RootElement.GetProperty("matchId").GetGuid();
        var creds = created.RootElement.GetProperty("credentials")
            .EnumerateArray().ToArray();
        Assert.Equal(seats, creds.Length);
        var tokens = creds.Select(entry => entry.GetProperty("token").GetString()!)
            .ToArray();

        var path = $"/api/dev/matches/{matchId}/presence";
        using var missing = await creator.GetAsync(path);
        using var missingPost = await creator.PostAsync(path, null);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, missingPost.StatusCode);

        var active = new HashSet<string>(StringComparer.Ordinal);
        using var beforeClient = host.CreateClient();
        beforeClient.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", tokens[0]);
        using var initial = await beforeClient.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, initial.StatusCode);
        Assert.Equal("no-store", initial.Headers.CacheControl?.ToString());
        using var initialJson = await initial.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(initialJson);
        AssertPublicPresence(initialJson.RootElement, matchId, ids, active);

        foreach (var index in new[] { 0, seats - 1 })
        {
            using var actor = host.CreateClient();
            actor.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", tokens[index]);
            using var heartbeat = await actor.PostAsync(path, null);
            Assert.Equal(HttpStatusCode.OK, heartbeat.StatusCode);
            Assert.Equal("no-store", heartbeat.Headers.CacheControl?.ToString());
            active.Add(ids[index]);
            using var heartbeatJson = await heartbeat.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(heartbeatJson);
            AssertPublicPresence(heartbeatJson.RootElement, matchId, ids, active);

            using var current = await actor.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, current.StatusCode);
            Assert.Equal("no-store", current.Headers.CacheControl?.ToString());
            using var currentJson = await current.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(currentJson);
            AssertPublicPresence(currentJson.RootElement, matchId, ids, active);
        }

        // Presence never moves, consumes an action, advances a revision or
        // exposes a private capability in the public match snapshot.
        using var snapshot = await beforeClient.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{matchId}");
        Assert.NotNull(snapshot);
        Assert.Equal(0, snapshot.RootElement.GetProperty("revision").GetInt32());
        Assert.Equal(ids[0], snapshot.RootElement.GetProperty("activePlayerId").GetString());
        Assert.Equal(1, snapshot.RootElement.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task ProductionDoesNotExposePresenceReadsOrHeartbeats()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        const string path =
            "/api/dev/matches/00000000-0000-0000-0000-000000000020/presence";
        using var get = await client.GetAsync(path);
        using var post = await client.PostAsync(path, null);
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, post.StatusCode);
    }
}
