using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// No user-supplied playerId or private card catalog can authorize history.
/// The actor-bound endpoint only returns Domain-verified public first-round frames.
/// </summary>
public sealed class DevelopmentHistoryEndpointTests
{
    private static WebApplicationFactory<Program> Host(string environment = "Development") =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b => b.UseEnvironment(environment));

    private static HttpClient Actor(WebApplicationFactory<Program> host, string bearer)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", bearer);
        return client;
    }

    [Fact]
    public async Task HistoryIsAuthenticatedAndFollowsMovesAcrossActorsWithoutPrivateData()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        using var createdResponse = await creator.PostAsJsonAsync("/api/dev/matches/from-full-deck", new
        {
            playerIds = new[] { "alice", "bob" },
            characters = CharacterSetupFixture.Catalog(),
            availableActivities = ActivitySetupFixture.Catalog(),
            actionCardIds = ActionDeckFixture.ActionIds(),
            electionDayCardId = ActionDeckFixture.ElectionDayId,
            seed = 2026
        });
        Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
        using var created = await createdResponse.Content.ReadFromJsonAsync<JsonDocument>();
        var id = created!.RootElement.GetProperty("matchId").GetGuid();
        var credentials = created.RootElement.GetProperty("credentials").EnumerateArray().ToArray();
        var aliceToken = credentials[0].GetProperty("token").GetString()!;
        var bobToken = credentials[1].GetProperty("token").GetString()!;
        var url = $"/api/dev/matches/{id}/history";

        using var anonymous = await creator.GetAsync(url);
        Assert.Equal(HttpStatusCode.NotFound, anonymous.StatusCode);
        using var forged = Actor(host, new string('0', 64));
        using var denied = await forged.GetAsync(url);
        Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);

        using var alice = Actor(host, aliceToken);
        using var first = await alice.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal("no-store", first.Headers.CacheControl?.ToString());
        using var genesis = await first.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal(id, genesis!.RootElement.GetProperty("matchId").GetGuid());
        Assert.Equal(0, genesis.RootElement.GetProperty("verifiedRevision").GetInt64());
        Assert.Single(genesis.RootElement.GetProperty("frames").EnumerateArray());
        Assert.Equal("gauss", genesis.RootElement.GetProperty("frames")[0]
            .GetProperty("players")[0].GetProperty("streetId").GetString());

        using var moved = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
            new { destinationStreetId = "planck", expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        using var ended = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 1 });
        Assert.Equal(HttpStatusCode.OK, ended.StatusCode);

        using var bob = Actor(host, bobToken);
        using var next = await bob.GetAsync(url + "?playerId=alice");
        Assert.Equal(HttpStatusCode.OK, next.StatusCode);
        Assert.Equal("no-store", next.Headers.CacheControl?.ToString());
        var text = await next.Content.ReadAsStringAsync();
        using var history = JsonDocument.Parse(text);
        Assert.Equal(2, history.RootElement.GetProperty("verifiedRevision").GetInt64());
        var frames = history.RootElement.GetProperty("frames").EnumerateArray().ToArray();
        Assert.Equal(3, frames.Length);
        Assert.Equal(new long[] { 0, 1, 2 },
            frames.Select(f => f.GetProperty("revision").GetInt64()));
        Assert.Equal("gauss", frames[0].GetProperty("players")[0].GetProperty("streetId").GetString());
        Assert.Equal("planck", frames[1].GetProperty("players")[0].GetProperty("streetId").GetString());
        Assert.Equal("bob", frames[2].GetProperty("activePlayerId").GetString());
        Assert.DoesNotContain(aliceToken, text);
        Assert.DoesNotContain(bobToken, text);
        Assert.DoesNotContain("cardIds", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("drawPile", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("actionCard", text, StringComparison.OrdinalIgnoreCase);

        using var rotate = await alice.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var tokenBody = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        var replaced = tokenBody!.RootElement.GetProperty("token").GetString()!;
        using var revoked = await alice.GetAsync(url);
        Assert.Equal(HttpStatusCode.NotFound, revoked.StatusCode);
        using var renewed = Actor(host, replaced);
        using var newHistory = await renewed.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, newHistory.StatusCode);
        using var bobStill = await bob.GetAsync(url);
        Assert.Equal(HttpStatusCode.OK, bobStill.StatusCode);
    }

    [Fact]
    public async Task ProductionDoesNotExposeReplayHistory()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.GetAsync($"/api/dev/matches/{Guid.NewGuid()}/history");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
