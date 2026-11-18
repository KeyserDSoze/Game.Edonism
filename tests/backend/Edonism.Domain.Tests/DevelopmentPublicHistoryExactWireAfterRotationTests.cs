using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #175: verify the existing Domain public audit replay wire schema
/// through genuine Development HTTP after movement/turn-end and bearer
/// rotation. Root/frame/seat own fields are whitelisted, never private.
/// Genesis and 2..8 setup contracts are already tested independently.
/// </summary>
public sealed class DevelopmentPublicHistoryExactWireAfterRotationTests
{
    private static WebApplicationFactory<Program> Host(string environment) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static string[] Keys(JsonElement row) =>
        row.EnumerateObject().Select(property => property.Name)
            .OrderBy(name => name, StringComparer.Ordinal).ToArray();

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task AuthenticatedPostMovementHistoryContainsOnlyExactPublicKeysAcrossRotation(
        int count)
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var ids = Enumerable.Range(0, count).Select(i => $"actor-{i}").ToArray();
        using var creationResponse = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = ids,
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.Created, creationResponse.StatusCode);
        using var created = await creationResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var matchId = created.RootElement.GetProperty("matchId").GetGuid();
        var tokens = created.RootElement.GetProperty("credentials")
            .EnumerateArray().Select(x => x.GetProperty("token").GetString()!)
            .ToArray();
        Assert.Equal(count, tokens.Length);
        var route = $"/api/dev/matches/{matchId}";

        using var alice = Seat(host, tokens[0]);
        using var options = await alice.GetFromJsonAsync<JsonDocument>(
            route + "/turn-options");
        Assert.NotNull(options);
        var destination = options.RootElement.GetProperty("freeMoveStreetIds")[0]
            .GetString()!;
        using var move = await alice.PostAsJsonAsync(route + "/free-move",
            new { expectedRevision = 0, destinationStreetId = destination });
        Assert.Equal(HttpStatusCode.OK, move.StatusCode);
        using var endTurn = await alice.PostAsJsonAsync(route + "/end-turn",
            new { expectedRevision = 1 });
        Assert.Equal(HttpStatusCode.OK, endTurn.StatusCode);

        var historyUri = route + "/history";
        using var anonymous = await creator.GetAsync(historyUri);
        Assert.Equal(HttpStatusCode.NotFound, anonymous.StatusCode);
        using var first = await alice.GetAsync(historyUri);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal("no-store", first.Headers.CacheControl?.ToString());
        var wire = await first.Content.ReadAsStringAsync();
        using var history = JsonDocument.Parse(wire);
        var root = history.RootElement;
        Assert.Equal(new[] { "frames", "matchId", "verifiedRevision" }, Keys(root));
        Assert.Equal(matchId, root.GetProperty("matchId").GetGuid());
        Assert.Equal(2, root.GetProperty("verifiedRevision").GetInt64());

        var frames = root.GetProperty("frames").EnumerateArray().ToArray();
        Assert.Equal(3, frames.Length);
        for (var index = 0; index < frames.Length; index++)
        {
            var frame = frames[index];
            Assert.Equal(new[]
            {
                "activePlayerId", "actorId", "kind", "phase", "players", "revision"
            }, Keys(frame));
            Assert.Equal(index, frame.GetProperty("revision").GetInt64());
            Assert.Equal(index == 0 ? "match-created" :
                index == 1 ? "free-move" : "turn-ended",
                frame.GetProperty("kind").GetString());
            Assert.Equal(index == 0 ? "system" : ids[0],
                frame.GetProperty("actorId").GetString());
            Assert.Equal(0, frame.GetProperty("phase").GetInt32());
            Assert.Equal(index < 2 ? ids[0] : ids[1],
                frame.GetProperty("activePlayerId").GetString());
            var playerRows = frame.GetProperty("players").EnumerateArray().ToArray();
            Assert.Equal(count, playerRows.Length);
            for (var seat = 0; seat < count; seat++)
            {
                var row = playerRows[seat];
                Assert.Equal(new[] { "freeMoveUsed", "playerId", "streetId" },
                    Keys(row));
                Assert.Equal(ids[seat], row.GetProperty("playerId").GetString());
                Assert.Equal(seat == 0 && index >= 1,
                    row.GetProperty("freeMoveUsed").GetBoolean());
                if (seat == 0 && index >= 1)
                    Assert.Equal(destination, row.GetProperty("streetId").GetString());
            }
        }
        foreach (var privateValue in tokens)
            Assert.DoesNotContain(privateValue, wire, StringComparison.OrdinalIgnoreCase);
        foreach (var privateKey in new[]
        {
            "token", "privateHand", "cardIds", "drawPile", "otherPlayerTokens",
            "futureActions", "adminActions", "credentials", "secret"
        })
            Assert.DoesNotContain(privateKey, wire, StringComparison.OrdinalIgnoreCase);

        // Revoking the last actor's bearer must not alter this public audit
        // replay or expose its old/new secret to any authorized viewer.
        using var former = Seat(host, tokens[^1]);
        using var rotation = await former.PostAsync(route + "/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotation.StatusCode);
        using var rotationJson = await rotation.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(rotationJson);
        var renewedBearer = rotationJson.RootElement.GetProperty("token").GetString()!;
        using var revokedHistory = await former.GetAsync(historyUri);
        Assert.Equal(HttpStatusCode.NotFound, revokedHistory.StatusCode);
        using var renewed = Seat(host, renewedBearer);
        using var fromRenewed = await renewed.GetAsync(historyUri);
        Assert.Equal(HttpStatusCode.OK, fromRenewed.StatusCode);
        Assert.Equal("no-store", fromRenewed.Headers.CacheControl?.ToString());
        Assert.Equal(wire, await fromRenewed.Content.ReadAsStringAsync());
        using var fromAlice = await alice.GetAsync(historyUri);
        Assert.Equal(HttpStatusCode.OK, fromAlice.StatusCode);
        Assert.Equal(wire, await fromAlice.Content.ReadAsStringAsync());
        Assert.DoesNotContain(renewedBearer, wire, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ProductionDoesNotServeDevelopmentHistory()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.GetAsync(
            "/api/dev/matches/00000000-0000-0000-0000-000000000020/history");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
