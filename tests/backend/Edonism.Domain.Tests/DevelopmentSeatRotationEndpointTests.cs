using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentSeatRotationEndpointTests
{
    private static WebApplicationFactory<Program> Host(string environment) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static async Task<(Guid Id, string Alice, string Bob)> Create(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync("/api/dev/matches/from-full-deck", new
        {
            playerIds = new[] { "alice", "bob" },
            characters = CharacterSetupFixture.Catalog(),
            availableActivities = ActivitySetupFixture.Catalog(),
            actionCardIds = ActionDeckFixture.ActionIds(),
            electionDayCardId = ActionDeckFixture.ElectionDayId,
            seed = 2026
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = await response.Content.ReadFromJsonAsync<JsonDocument>();
        var root = body!.RootElement;
        var credentials = root.GetProperty("credentials").EnumerateArray().ToArray();
        return (root.GetProperty("matchId").GetGuid(),
            credentials[0].GetProperty("token").GetString()!,
            credentials[1].GetProperty("token").GetString()!);
    }

    private static HttpClient AsSeat(WebApplicationFactory<Program> factory, string token)
    {
        var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    [Fact]
    public async Task RotationRevokesOldTokenWithoutChangingTurnAuditOrOtherSeats()
    {
        using var factory = Host("Development");
        using var creator = factory.CreateClient();
        var (id, oldAlice, bobToken) = await Create(creator);
        using var oldClient = AsSeat(factory, oldAlice);
        using var bobClient = AsSeat(factory, bobToken);

        using var initial = await oldClient.GetAsync($"/api/dev/matches/{id}");
        var initialJson = await initial.Content.ReadAsStringAsync();
        using var rotate = await oldClient.PostAsync(
            $"/api/dev/matches/{id}/rotate-token?playerId=bob", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        Assert.Equal("no-store", rotate.Headers.CacheControl?.ToString());
        using var rotatedJson = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("alice", rotatedJson!.RootElement.GetProperty("playerId").GetString());
        var newAlice = rotatedJson.RootElement.GetProperty("token").GetString()!;
        Assert.Matches("^[A-F0-9]{64}$", newAlice);
        Assert.NotEqual(oldAlice, newAlice);
        Assert.DoesNotContain(bobToken, await rotate.Content.ReadAsStringAsync());

        using var staleRead = await oldClient.GetAsync($"/api/dev/matches/{id}");
        using var staleHand = await oldClient.GetAsync($"/api/dev/matches/{id}/hand");
        using var staleAudit = await oldClient.GetAsync($"/api/dev/matches/{id}/audit");
        using var staleMove = await oldClient.PostAsJsonAsync(
            $"/api/dev/matches/{id}/end-turn", new { expectedRevision = 0 });
        using var staleRotate = await oldClient.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        foreach (var attempt in new[] { staleRead, staleHand, staleAudit, staleMove, staleRotate })
            Assert.Equal(HttpStatusCode.NotFound, attempt.StatusCode);

        using var aliceClient = AsSeat(factory, newAlice);
        using var updated = await aliceClient.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.OK, updated.StatusCode);
        Assert.Equal(initialJson, await updated.Content.ReadAsStringAsync());
        using var aliceHand = await aliceClient.GetAsync($"/api/dev/matches/{id}/hand");
        using var bobHand = await bobClient.GetAsync($"/api/dev/matches/{id}/hand?playerId=alice");
        using var aliceJson = await aliceHand.Content.ReadFromJsonAsync<JsonDocument>();
        using var bobJson = await bobHand.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("alice", aliceJson!.RootElement.GetProperty("playerId").GetString());
        Assert.Equal("bob", bobJson!.RootElement.GetProperty("playerId").GetString());

        using var secondRotate = await aliceClient.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, secondRotate.StatusCode);
        using var secondCredential = await secondRotate.Content.ReadFromJsonAsync<JsonDocument>();
        var secondToken = secondCredential!.RootElement.GetProperty("token").GetString()!;
        Assert.NotEqual(newAlice, secondToken);
        Assert.Equal(HttpStatusCode.NotFound,
            (await aliceClient.GetAsync($"/api/dev/matches/{id}")).StatusCode);
        using var newest = AsSeat(factory, secondToken);
        Assert.Equal(HttpStatusCode.OK,
            (await newest.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
                new { expectedRevision = 0 })).StatusCode);
    }

    [Fact]
    public async Task AnonymousInventedAndProductionRotationCannotMintTokens()
    {
        using var dev = Host("Development");
        using var creator = dev.CreateClient();
        var (id, alice, _) = await Create(creator);
        using var outsider = dev.CreateClient();
        using var missing = await outsider.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        using var forged = AsSeat(dev, new string('0', 64));
        using var unknown = await forged.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        using var valid = AsSeat(dev, alice);
        Assert.Equal(HttpStatusCode.OK, (await valid.GetAsync($"/api/dev/matches/{id}")).StatusCode);

        using var prod = Host("Production");
        using var production = prod.CreateClient();
        using var absent = await production.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.NotFound, absent.StatusCode);
    }
}
