using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Domain.Matches;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentParticipantIdEndpointTests
{
    private static WebApplicationFactory<Program> Host() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment("Development"));

    private static object Fixture(string creator, string actor) => creator switch
    {
        "slot" => new
        {
            players = new[]
            {
                new { playerId = actor, startingSlotId = "N-01" },
                new { playerId = "bob", startingSlotId = "S-01" }
            }
        },
        "card" => new
        {
            players = new[]
            {
                new { playerId = actor, startingCardId = "sport:01" },
                new { playerId = "bob", startingCardId = "public-financing:01" }
            },
            availableActivities = ActivitySetupFixture.Catalog(),
            seed = 2026
        },
        "character" => new
        {
            playerIds = new[] { actor, "bob" },
            characters = CharacterSetupFixture.Catalog(),
            availableActivities = ActivitySetupFixture.Catalog(),
            seed = 2026
        },
        "full" => new
        {
            playerIds = new[] { actor, "bob" },
            characters = CharacterSetupFixture.Catalog(),
            availableActivities = ActivitySetupFixture.Catalog(),
            actionCardIds = ActionDeckFixture.ActionIds(),
            electionDayCardId = ActionDeckFixture.ElectionDayId,
            seed = 2026
        },
        _ => throw new ArgumentOutOfRangeException(nameof(creator))
    };

    private static string Path(string creator) => creator switch
    {
        "slot" => "/api/dev/matches/",
        "card" => "/api/dev/matches/from-cards",
        "character" => "/api/dev/matches/from-characters",
        "full" => "/api/dev/matches/from-full-deck",
        _ => throw new ArgumentOutOfRangeException(nameof(creator))
    };

    [Theory]
    [InlineData("slot", "length")]
    [InlineData("slot", "control")]
    [InlineData("slot", "bidi")]
    [InlineData("card", "length")]
    [InlineData("card", "control")]
    [InlineData("card", "bidi")]
    [InlineData("character", "length")]
    [InlineData("character", "control")]
    [InlineData("character", "bidi")]
    [InlineData("full", "length")]
    [InlineData("full", "control")]
    [InlineData("full", "bidi")]
    public async Task EveryCreatorRejectsUnsafeIdWithoutIssuingAnySeat(
        string creator, string invalidKind)
    {
        var actor = invalidKind switch
        {
            "length" => new string('A', MatchParticipantId.MaxLength + 1),
            "control" => "alice\nother",
            _ => "alice\u202Eother"
        };
        using var host = Host();
        using var client = host.CreateClient();
        using (var rejected = await client.PostAsJsonAsync(Path(creator), Fixture(creator, actor)))
        {
            Assert.Equal(HttpStatusCode.BadRequest, rejected.StatusCode);
            Assert.Equal("no-store", rejected.Headers.CacheControl?.ToString());
            using var doc = await rejected.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(doc);
            Assert.False(doc.RootElement.TryGetProperty("credentials", out _));
            Assert.False(doc.RootElement.TryGetProperty("state", out _));
        }

        // Bad payload must not consume a match slot or poison a subsequent
        // authenticated seat. The original create/authorize path stays live.
        using var valid = await client.PostAsJsonAsync("/api/dev/matches/",
            Fixture("slot", "alice"));
        Assert.Equal(HttpStatusCode.Created, valid.StatusCode);
        using var body = await valid.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(body);
        Assert.Equal(2, body.RootElement.GetProperty("credentials").GetArrayLength());
        var token = body.RootElement.GetProperty("credentials")[0]
            .GetProperty("token").GetString()!;
        var matchId = body.RootElement.GetProperty("matchId").GetGuid();
        using var seat = host.CreateClient();
        seat.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        using var read = await seat.GetAsync($"/api/dev/matches/{matchId}");
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
    }

    [Fact]
    public async Task MaximumLengthUnicodeActorCanStillUseBearerAndMove()
    {
        var actor = new string('P', MatchParticipantId.MaxLength);
        using var host = Host();
        using var client = host.CreateClient();
        using var created = await client.PostAsJsonAsync(
            Path("slot"), Fixture("slot", actor));
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var body = await created.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(body);
        var credential = body.RootElement.GetProperty("credentials")[0];
        Assert.Equal(actor, credential.GetProperty("playerId").GetString());
        var token = credential.GetProperty("token").GetString()!;
        var matchId = body.RootElement.GetProperty("matchId").GetGuid();
        using var seat = host.CreateClient();
        seat.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        using var moved = await seat.PostAsJsonAsync($"/api/dev/matches/{matchId}/free-move",
            new { destinationStreetId = "planck", expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, moved.StatusCode);
        using var snapshot = await moved.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(snapshot);
        Assert.Equal(actor, snapshot.RootElement.GetProperty("players")[0]
            .GetProperty("playerId").GetString());
        Assert.Equal(1, snapshot.RootElement.GetProperty("revision").GetInt64());

        using var history = await seat.GetAsync($"/api/dev/matches/{matchId}/history");
        Assert.Equal(HttpStatusCode.OK, history.StatusCode);
        using var replay = await history.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(replay);
        Assert.Equal(actor, replay.RootElement.GetProperty("frames")[1]
            .GetProperty("actorId").GetString());
    }
}
