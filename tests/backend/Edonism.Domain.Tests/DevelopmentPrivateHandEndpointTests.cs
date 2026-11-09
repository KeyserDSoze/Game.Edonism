using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentPrivateHandEndpointTests
{
    private static WebApplicationFactory<Program> DevFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment("Development"));

    private static object FullRequest(string[]? actionIds = null) => new
    {
        playerIds = new[] { "alice", "bob" },
        characters = CharacterSetupFixture.Catalog(),
        availableActivities = ActivitySetupFixture.Catalog(),
        actionCardIds = actionIds ?? ActionDeckFixture.ActionIds(),
        electionDayCardId = ActionDeckFixture.ElectionDayId,
        seed = 2026
    };

    [Fact]
    public async Task EachSeatTokenReadsOnlyItsOwnFourCards()
    {
        using var factory = DevFactory();
        using var creator = factory.CreateClient();
        using var response = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", FullRequest());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var publicBody = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("test:action:", publicBody);
        Assert.DoesNotContain(ActionDeckFixture.ElectionDayId, publicBody);
        Assert.DoesNotContain("remainingDrawPile", publicBody);

        using var created = JsonDocument.Parse(publicBody);
        var id = created.RootElement.GetProperty("matchId").GetGuid();
        var creds = created.RootElement.GetProperty("credentials").EnumerateArray().ToArray();
        var aliceToken = creds.Single(c => c.GetProperty("playerId").GetString() == "alice")
            .GetProperty("token").GetString()!;
        var bobToken = creds.Single(c => c.GetProperty("playerId").GetString() == "bob")
            .GetProperty("token").GetString()!;

        using var alice = factory.CreateClient();
        alice.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", aliceToken);
        using var bob = factory.CreateClient();
        bob.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", bobToken);
        using var aliceResponse = await alice.GetAsync($"/api/dev/matches/{id}/hand");
        // Even supplying a different playerId in the URL query cannot change the
        // authorized actor: only the seat token determines whose hand is returned.
        using var bobResponse = await bob.GetAsync($"/api/dev/matches/{id}/hand?playerId=alice");
        Assert.Equal(HttpStatusCode.OK, aliceResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK, bobResponse.StatusCode);

        using var aliceJson = await aliceResponse.Content.ReadFromJsonAsync<JsonDocument>();
        using var bobJson = await bobResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(aliceJson);
        Assert.NotNull(bobJson);
        Assert.Equal("alice", aliceJson.RootElement.GetProperty("playerId").GetString());
        Assert.Equal("bob", bobJson.RootElement.GetProperty("playerId").GetString());
        var aliceCards = aliceJson.RootElement.GetProperty("cardIds")
            .EnumerateArray().Select(x => x.GetString()!).ToArray();
        var bobCards = bobJson.RootElement.GetProperty("cardIds")
            .EnumerateArray().Select(x => x.GetString()!).ToArray();
        Assert.Equal(4, aliceCards.Length);
        Assert.Equal(4, bobCards.Length);
        Assert.Empty(aliceCards.Intersect(bobCards));

        using var readPublic = await alice.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.OK, readPublic.StatusCode);
        var json = await readPublic.Content.ReadAsStringAsync();
        Assert.DoesNotContain("test:action:", json);
        Assert.DoesNotContain(ActionDeckFixture.ElectionDayId, json);
        Assert.DoesNotContain("cardIds", json);
        Assert.DoesNotContain("remainingDrawPile", json);
    }

    [Fact]
    public async Task UnauthenticatedAndWrongTokensNeverReadAHand()
    {
        using var factory = DevFactory();
        using var creator = factory.CreateClient();
        using var response = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", FullRequest());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var created = await response.Content.ReadFromJsonAsync<JsonDocument>();
        var id = created!.RootElement.GetProperty("matchId").GetGuid();

        using var visitor = factory.CreateClient();
        using var missing = await visitor.GetAsync($"/api/dev/matches/{id}/hand");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        visitor.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", "invalid");
        using var wrong = await visitor.GetAsync($"/api/dev/matches/{id}/hand");
        Assert.Equal(HttpStatusCode.NotFound, wrong.StatusCode);
    }

    [Fact]
    public async Task InvalidFullDeckRejectedAndLegacyMatchDoesNotInventHands()
    {
        using var factory = DevFactory();
        using var creator = factory.CreateClient();
        using var rejected = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", FullRequest(ActionDeckFixture.ActionIds()[..57]));
        Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);

        using var oldCreate = await creator.PostAsJsonAsync("/api/dev/matches/", new
        {
            players = new[]
            {
                new { playerId = "alice", startingSlotId = "N-01" },
                new { playerId = "bob", startingSlotId = "S-01" }
            }
        });
        Assert.Equal(HttpStatusCode.Created, oldCreate.StatusCode);
        using var old = await oldCreate.Content.ReadFromJsonAsync<JsonDocument>();
        var id = old!.RootElement.GetProperty("matchId").GetGuid();
        var token = old.RootElement.GetProperty("credentials")[0]
            .GetProperty("token").GetString()!;
        using var alice = factory.CreateClient();
        alice.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        using var noHand = await alice.GetAsync($"/api/dev/matches/{id}/hand");
        Assert.Equal(HttpStatusCode.NotFound, noHand.StatusCode);
    }

    [Fact]
    public async Task ProductionCannotCreateOrReadFullDeckAndHandRoutes()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment("Production"));
        using var client = factory.CreateClient();
        using var create = await client.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", FullRequest());
        Assert.Equal(HttpStatusCode.NotFound, create.StatusCode);
        using var hand = await client.GetAsync(
            $"/api/dev/matches/{Guid.NewGuid()}/hand");
        Assert.Equal(HttpStatusCode.NotFound, hand.StatusCode);
        using var board = await client.GetAsync("/api/v1/board");
        Assert.Equal(HttpStatusCode.OK, board.StatusCode);
    }
}
