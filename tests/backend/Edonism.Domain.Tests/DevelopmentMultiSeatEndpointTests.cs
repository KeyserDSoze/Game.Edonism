using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentMultiSeatEndpointTests
{
    private static WebApplicationFactory<Program> Dev() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(b => b.UseEnvironment("Development"));

    private static async Task<(Guid Id, string AliceToken, string BobToken)> Create(HttpClient creator)
    {
        using var response = await creator.PostAsJsonAsync("/api/dev/matches/from-full-deck", new
        {
            playerIds = new[] { "alice", "bob" },
            characters = CharacterSetupFixture.Catalog(),
            availableActivities = ActivitySetupFixture.Catalog(),
            actionCardIds = ActionDeckFixture.ActionIds(),
            electionDayCardId = ActionDeckFixture.ElectionDayId,
            seed = 2026
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var created = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var root = created.RootElement;
        var id = root.GetProperty("matchId").GetGuid();
        var seats = root.GetProperty("credentials").EnumerateArray().ToArray();
        return (id,
            seats.Single(s => s.GetProperty("playerId").GetString() == "alice")
                .GetProperty("token").GetString()!,
            seats.Single(s => s.GetProperty("playerId").GetString() == "bob")
                .GetProperty("token").GetString()!);
    }

    [Fact]
    public async Task IndependentSeatClientsObserveSameAuthoritativeRevisionsButDisjointPrivateHands()
    {
        using var factory = Dev();
        using var creator = factory.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = factory.CreateClient();
        using var bob = factory.CreateClient();
        alice.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", aliceToken);
        bob.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", bobToken);

        using var aliceHandResponse = await alice.GetAsync($"/api/dev/matches/{id}/hand");
        using var bobHandResponse = await bob.GetAsync($"/api/dev/matches/{id}/hand?playerId=alice");
        Assert.Equal(HttpStatusCode.OK, aliceHandResponse.StatusCode);
        Assert.Equal(HttpStatusCode.OK, bobHandResponse.StatusCode);
        using var aliceHand = await aliceHandResponse.Content.ReadFromJsonAsync<JsonDocument>();
        using var bobHand = await bobHandResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("alice", aliceHand!.RootElement.GetProperty("playerId").GetString());
        Assert.Equal("bob", bobHand!.RootElement.GetProperty("playerId").GetString());
        var aliceCards = aliceHand.RootElement.GetProperty("cardIds").EnumerateArray()
            .Select(c => c.GetString()!).ToArray();
        var bobCards = bobHand.RootElement.GetProperty("cardIds").EnumerateArray()
            .Select(c => c.GetString()!).ToArray();
        Assert.Equal(4, aliceCards.Length);
        Assert.Equal(4, bobCards.Length);
        Assert.Empty(aliceCards.Intersect(bobCards));

        using var rejected = await bob.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 0, playerId = "alice" });
        Assert.Equal(HttpStatusCode.Conflict, rejected.StatusCode);
        using (var result = await rejected.Content.ReadFromJsonAsync<JsonDocument>())
            Assert.Equal("not_your_turn", result!.RootElement.GetProperty("code").GetString());

        // The full-deck draw decides Alice's initial street. Never hardcode
        // Gauss/Planck as the seeded starting location in an integration test.
        using var firstRead = await alice.GetAsync($"/api/dev/matches/{id}");
        using var initial = await firstRead.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(initial);
        var aliceStreet = initial.RootElement.GetProperty("players")[0]
            .GetProperty("streetId").GetString();
        var destination = Edonism.Infrastructure.World.BoardCatalog.LoadDefault().Streets
            .Single(s => s.Id == aliceStreet).Neighbors[0];
        using var move = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
            new { destinationStreetId = destination, expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, move.StatusCode);
        using var bobRead = await bob.GetAsync($"/api/dev/matches/{id}");
        using var aliceRead = await alice.GetAsync($"/api/dev/matches/{id}");
        var bobJson = await bobRead.Content.ReadAsStringAsync();
        var aliceJson = await aliceRead.Content.ReadAsStringAsync();
        Assert.Equal(aliceJson, bobJson);
        Assert.DoesNotContain(aliceToken, bobJson);
        Assert.DoesNotContain(bobToken, bobJson);
        foreach (var idCard in aliceCards.Concat(bobCards))
            Assert.DoesNotContain(idCard, bobJson);
        using (var doc = JsonDocument.Parse(bobJson))
        {
            Assert.Equal(1, doc.RootElement.GetProperty("revision").GetInt64());
            Assert.Equal(destination, doc.RootElement.GetProperty("players")[0]
                .GetProperty("streetId").GetString());
        }

        using var finishAlice = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 1 });
        Assert.Equal(HttpStatusCode.OK, finishAlice.StatusCode);
        using var finishBob = await bob.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 2 });
        Assert.Equal(HttpStatusCode.OK, finishBob.StatusCode);
        using var final = await alice.GetFromJsonAsync<JsonDocument>($"/api/dev/matches/{id}");
        Assert.NotNull(final);
        Assert.Equal(3, final.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(1, final.RootElement.GetProperty("phase").GetInt32());
        Assert.Equal(4, final.RootElement.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task InvalidCapabilityCannotReadJoinInformationOrAHand()
    {
        using var factory = Dev();
        using var creator = factory.CreateClient();
        var (id, _, _) = await Create(creator);
        using var outsider = factory.CreateClient();

        using var noToken = await outsider.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.NotFound, noToken.StatusCode);
        using var noHand = await outsider.GetAsync($"/api/dev/matches/{id}/hand");
        Assert.Equal(HttpStatusCode.NotFound, noHand.StatusCode);
        outsider.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", new string('0', 64));
        using var invented = await outsider.GetAsync($"/api/dev/matches/{id}");
        using var inventedHand = await outsider.GetAsync($"/api/dev/matches/{id}/hand");
        Assert.Equal(HttpStatusCode.NotFound, invented.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, inventedHand.StatusCode);
        using var unknown = await outsider.GetAsync($"/api/dev/matches/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
    }
}
