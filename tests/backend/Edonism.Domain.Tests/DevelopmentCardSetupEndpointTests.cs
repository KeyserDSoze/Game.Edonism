using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentCardSetupEndpointTests
{
    private static WebApplicationFactory<Program> DevFactory() =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment("Development"));

    private static object SampleRequest() => new
    {
        players = new[]
        {
            new { playerId = "alice", startingCardId = "sport:01" },
            new { playerId = "bob", startingCardId = "public-financing:01" }
        },
        availableActivities = ActivitySetupFixture.Catalog(),
        seed = 2026
    };

    [Fact]
    public async Task CardSetupCreatesThirtyLotsAndStartingLocationsForThePlayers()
    {
        using var factory = DevFactory();
        using var creator = factory.CreateClient();
        using var response = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-cards", SampleRequest());
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(json);
        var data = json.RootElement;
        var id = data.GetProperty("matchId").GetGuid();
        var state = data.GetProperty("state");
        var placed = state.GetProperty("boardActivities").EnumerateArray().ToArray();

        Assert.Equal(30, placed.Length);
        Assert.Equal(30, placed.Select(x => x.GetProperty("slotId").GetString()).Distinct().Count());
        var required = placed.Single(x => x.GetProperty("cardId").GetString() == "sport:01");
        var alice = state.GetProperty("players")[0];
        Assert.Equal(required.GetProperty("slotId").GetString(),
            alice.GetProperty("startingSlotId").GetString());
        Assert.Equal(required.GetProperty("slotId").GetString(),
            state.GetProperty("controlledActivities")[0].GetProperty("slotId").GetString());
        Assert.Equal(3, state.GetProperty("grossSalaryQuotes")[0].GetProperty("grossAtoms").GetInt32());
        Assert.Equal(0, state.GetProperty("revision").GetInt64());

        var token = data.GetProperty("credentials")[0].GetProperty("token").GetString()!;
        using var actor = factory.CreateClient();
        actor.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        using var read = await actor.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);

        var streetId = alice.GetProperty("streetId").GetString()!;
        var neighborId = BoardCatalog.LoadDefault().Streets.Single(s => s.Id == streetId).Neighbors[0];
        using var move = await actor.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
            new { destinationStreetId = neighborId, expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, move.StatusCode);
        using var moved = await move.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal(neighborId,
            moved!.RootElement.GetProperty("players")[0].GetProperty("streetId").GetString());
        Assert.Equal(30, moved.RootElement.GetProperty("boardActivities").GetArrayLength());
    }

    [Fact]
    public async Task InvalidCardCatalogAndDuplicateMandatoryCardsReturnBadRequest()
    {
        using var factory = DevFactory();
        using var client = factory.CreateClient();
        using var shortCatalog = await client.PostAsJsonAsync(
            "/api/dev/matches/from-cards", new
            {
                players = new[]
                {
                    new { playerId = "alice", startingCardId = "sport:01" },
                    new { playerId = "bob", startingCardId = "public-financing:01" }
                },
                availableActivities = ActivitySetupFixture.Catalog()[..45],
                seed = 1
            });
        Assert.Equal(HttpStatusCode.BadRequest, shortCatalog.StatusCode);

        using var duplicate = await client.PostAsJsonAsync(
            "/api/dev/matches/from-cards", new
            {
                players = new[]
                {
                    new { playerId = "alice", startingCardId = "sport:01" },
                    new { playerId = "bob", startingCardId = "sport:01" }
                },
                availableActivities = ActivitySetupFixture.Catalog(),
                seed = 1
            });
        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
    }

    [Fact]
    public async Task ProductionDoesNotExposeCardSetupEndpoint()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment("Production"));
        using var client = factory.CreateClient();
        using var response = await client.PostAsJsonAsync(
            "/api/dev/matches/from-cards", SampleRequest());
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);

        using var boardResponse = await client.GetAsync("/api/v1/board");
        Assert.Equal(HttpStatusCode.OK, boardResponse.StatusCode);
    }
}
