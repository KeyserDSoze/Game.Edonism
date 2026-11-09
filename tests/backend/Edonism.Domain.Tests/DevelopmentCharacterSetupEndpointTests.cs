using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentCharacterSetupEndpointTests
{
    private static WebApplicationFactory<Program> DevFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment("Development"));

    private static object SampleRequest() => new
    {
        playerIds = new[] { "alice", "bob" },
        characters = CharacterSetupFixture.Catalog(),
        availableActivities = ActivitySetupFixture.Catalog(),
        seed = 2026
    };

    [Fact]
    public async Task DevelopmentDrawsCharactersAndDerivesPublicLifeAndStartingLots()
    {
        using var factory = DevFactory();
        using var client = factory.CreateClient();
        using var response = await client.PostAsJsonAsync(
            "/api/dev/matches/from-characters", SampleRequest());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var document = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(document);

        var root = document.RootElement;
        var id = root.GetProperty("matchId").GetGuid();
        var state = root.GetProperty("state");
        var assigned = state.GetProperty("assignedCharacters").EnumerateArray().ToArray();
        var players = state.GetProperty("players").EnumerateArray().ToArray();
        var boardActivities = state.GetProperty("boardActivities").EnumerateArray().ToArray();

        Assert.Equal(2, assigned.Length);
        Assert.Equal(2, assigned.Select(c => c.GetProperty("characterId").GetString()).Distinct().Count());
        Assert.Equal(30, boardActivities.Length);
        Assert.False(state.TryGetProperty("factions", out _));
        foreach (var item in assigned)
        {
            var playerId = item.GetProperty("playerId").GetString();
            var player = players.Single(p => p.GetProperty("playerId").GetString() == playerId);
            var character = CharacterSetupFixture.Catalog().Single(c =>
                c.Id == item.GetProperty("characterId").GetString());
            Assert.Equal(character.PrintedInitialHearts, player.GetProperty("hearts").GetInt32());
            Assert.Equal(character.StartingActivityCardId,
                item.GetProperty("startingActivityCardId").GetString());
            var card = boardActivities.Single(a =>
                a.GetProperty("cardId").GetString() == character.StartingActivityCardId);
            Assert.Equal(card.GetProperty("slotId").GetString(),
                player.GetProperty("startingSlotId").GetString());
        }

        var token = root.GetProperty("credentials")[0].GetProperty("token").GetString()!;
        using var alice = factory.CreateClient();
        alice.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        using var read = await alice.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        using var readDocument = await read.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal(2, readDocument!.RootElement.GetProperty("assignedCharacters").GetArrayLength());

        var aliceStreet = players[0].GetProperty("streetId").GetString();
        var adjacent = BoardCatalog.LoadDefault().Streets
            .Single(s => s.Id == aliceStreet).Neighbors[0];
        using var move = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
            new { destinationStreetId = adjacent, expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, move.StatusCode);
        using var moved = await move.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal(1, moved!.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(adjacent,
            moved.RootElement.GetProperty("players")[0].GetProperty("streetId").GetString());
    }

    [Fact]
    public async Task InvalidCharacterCatalogAndDuplicatePlayersAreRejected()
    {
        using var factory = DevFactory();
        using var client = factory.CreateClient();
        using var invalidCatalog = await client.PostAsJsonAsync(
            "/api/dev/matches/from-characters", new
            {
                playerIds = new[] { "alice", "bob" },
                characters = CharacterSetupFixture.Catalog()[..22],
                availableActivities = ActivitySetupFixture.Catalog(),
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.BadRequest, invalidCatalog.StatusCode);

        using var repeatedPlayer = await client.PostAsJsonAsync(
            "/api/dev/matches/from-characters", new
            {
                playerIds = new[] { "alice", "alice" },
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.BadRequest, repeatedPlayer.StatusCode);
    }

    [Fact]
    public async Task ProductionHasNoCharacterSetupRoutes()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment("Production"));
        using var client = factory.CreateClient();
        using var response = await client.PostAsJsonAsync(
            "/api/dev/matches/from-characters", SampleRequest());
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        using var board = await client.GetAsync("/api/v1/board");
        Assert.Equal(HttpStatusCode.OK, board.StatusCode);
    }

    [Fact]
    public async Task UnauthenticatedClientCannotReadGeneratedCharacterMatch()
    {
        using var factory = DevFactory();
        using var creator = factory.CreateClient();
        using var response = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-characters", SampleRequest());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = await response.Content.ReadFromJsonAsync<JsonDocument>();
        var id = body!.RootElement.GetProperty("matchId").GetGuid();
        using var visitor = factory.CreateClient();
        using var forbidden = await visitor.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.NotFound, forbidden.StatusCode);
    }
}
