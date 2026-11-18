using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #174: real Development atomic GET /seat after both a game revision
/// change and actor-bearer rotation. Initial exact-DTO parity already
/// covered by #170: this covers revocation, private owner re-binding and
/// the unchanged five-field root on a NON-genesis snapshot (2/4/8 seats).
/// </summary>
public sealed class DevelopmentSeatBootstrapPostRotationExactWireTests
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

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task AtomicSeatBootstrapStillHasExactRootAfterRevisionAndBearerRotation(
        int seatCount)
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var players = Enumerable.Range(0, seatCount).Select(i => $"player-{i}").ToArray();
        using var createdResponse = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = players,
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
        using var created = await createdResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var matchId = created.RootElement.GetProperty("matchId").GetGuid();
        var creds = created.RootElement.GetProperty("credentials")
            .EnumerateArray().ToArray();
        Assert.Equal(seatCount, creds.Length);

        var path = $"/api/dev/matches/{matchId}";
        using var firstActor = Seat(host, creds[0].GetProperty("token").GetString()!);
        using var advance = await firstActor.PostAsJsonAsync(path + "/end-turn",
            new { expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, advance.StatusCode);

        var rotatedSeat = seatCount - 1;
        var previousToken = creds[rotatedSeat].GetProperty("token").GetString()!;
        using var former = Seat(host, previousToken);
        using var rotation = await former.PostAsync(path + "/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotation.StatusCode);
        using var rotateJson = await rotation.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(rotateJson);
        var newToken = rotateJson.RootElement.GetProperty("token").GetString()!;
        Assert.Matches("^[a-fA-F0-9]{64}$", newToken);
        Assert.NotEqual(previousToken, newToken);

        using var deniedFormer = await former.GetAsync(path + "/seat");
        using var deniedAnonymous = await creator.GetAsync(path + "/seat");
        Assert.Equal(HttpStatusCode.NotFound, deniedFormer.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, deniedAnonymous.StatusCode);
        Assert.Equal("no-store", deniedFormer.Headers.CacheControl?.ToString());

        using var renewed = Seat(host, newToken);
        using var seatResponse = await renewed.GetAsync(path + "/seat");
        Assert.Equal(HttpStatusCode.OK, seatResponse.StatusCode);
        Assert.Equal("no-store", seatResponse.Headers.CacheControl?.ToString());
        using var doc = await seatResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(doc);
        var seat = doc.RootElement;
        Assert.Equal(new[] { "hand", "matchId", "playerId", "state", "turnOptions" },
            seat.EnumerateObject().Select(f => f.Name)
                .OrderBy(name => name, StringComparer.Ordinal));
        Assert.Equal(matchId, seat.GetProperty("matchId").GetGuid());
        Assert.Equal(players[rotatedSeat], seat.GetProperty("playerId").GetString());
        Assert.Equal(players[rotatedSeat],
            seat.GetProperty("hand").GetProperty("playerId").GetString());
        Assert.Equal(players[rotatedSeat],
            seat.GetProperty("turnOptions").GetProperty("playerId").GetString());
        Assert.Equal(matchId, seat.GetProperty("hand").GetProperty("matchId").GetGuid());
        Assert.Equal(matchId,
            seat.GetProperty("turnOptions").GetProperty("matchId").GetGuid());
        Assert.Equal(1, seat.GetProperty("state").GetProperty("revision").GetInt64());
        Assert.Equal(1, seat.GetProperty("turnOptions").GetProperty("revision").GetInt64());
        Assert.Equal(players[1],
            seat.GetProperty("state").GetProperty("activePlayerId").GetString());
        Assert.Equal(rotatedSeat == 1,
            seat.GetProperty("turnOptions").GetProperty("canEndTurn").GetBoolean());
        Assert.Equal(4, seat.GetProperty("hand")
            .GetProperty("cardIds").GetArrayLength());

        var serialized = seat.GetRawText();
        Assert.DoesNotContain(previousToken, serialized, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(newToken, serialized, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("credentials", serialized, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("otherPlayerTokens", serialized, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("futureActions", serialized, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("adminActions", serialized, StringComparison.OrdinalIgnoreCase);

        using var other = await firstActor.GetAsync(path + "/seat");
        Assert.Equal(HttpStatusCode.OK, other.StatusCode);
        using var otherDoc = await other.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(otherDoc);
        Assert.Equal(players[0], otherDoc.RootElement
            .GetProperty("hand").GetProperty("playerId").GetString());
        Assert.Equal(1, otherDoc.RootElement.GetProperty("state")
            .GetProperty("revision").GetInt64());
    }

    [Fact]
    public async Task ProductionDoesNotExposeDevelopmentAtomicSeatBootstrap()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.GetAsync(
            "/api/dev/matches/00000000-0000-0000-0000-000000000020/seat");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
