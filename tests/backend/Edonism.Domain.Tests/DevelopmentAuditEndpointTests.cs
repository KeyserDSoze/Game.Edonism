using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentAuditEndpointTests
{
    [Fact]
    public async Task ActorBoundAuditIsPrivateCredentialCheckedButContainsOnlyPublicData()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b => b.UseEnvironment("Development"));
        using var creator = factory.CreateClient();
        using var response = await creator.PostAsJsonAsync("/api/dev/matches/", new
        {
            players = new[] {
                new { playerId = "alice", startingSlotId = "N-01" },
                new { playerId = "bob", startingSlotId = "S-01" }
            }
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var created = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var id = created.RootElement.GetProperty("matchId").GetGuid();
        var creds = created.RootElement.GetProperty("credentials").EnumerateArray().ToArray();
        var aliceToken = creds[0].GetProperty("token").GetString()!;
        var bobToken = creds[1].GetProperty("token").GetString()!;

        using var missing = await creator.GetAsync($"/api/dev/matches/{id}/audit");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        using var stranger = factory.CreateClient();
        stranger.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", new string('0', 64));
        using var forbidden = await stranger.GetAsync($"/api/dev/matches/{id}/audit");
        Assert.Equal(HttpStatusCode.NotFound, forbidden.StatusCode);

        using var alice = factory.CreateClient();
        alice.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", aliceToken);
        using var first = await alice.GetAsync($"/api/dev/matches/{id}/audit");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        using var firstBody = await first.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.True(firstBody!.RootElement.GetProperty("isValid").GetBoolean());
        Assert.Equal(0, firstBody.RootElement.GetProperty("verifiedRevision").GetInt64());
        Assert.Equal("alice", firstBody.RootElement.GetProperty("activePlayerId").GetString());

        using var move = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
            new { destinationStreetId = "planck", expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, move.StatusCode);
        using var stale = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
            new { destinationStreetId = "newton", expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        using var bob = factory.CreateClient();
        bob.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", bobToken);
        using var validated = await bob.GetAsync($"/api/dev/matches/{id}/audit?playerId=alice");
        Assert.Equal(HttpStatusCode.OK, validated.StatusCode);
        var text = await validated.Content.ReadAsStringAsync();
        using var audit = JsonDocument.Parse(text);
        Assert.True(audit.RootElement.GetProperty("isValid").GetBoolean());
        Assert.Equal(1, audit.RootElement.GetProperty("verifiedRevision").GetInt64());
        var players = audit.RootElement.GetProperty("players").EnumerateArray().ToArray();
        Assert.Equal("planck", players.Single(p => p.GetProperty("playerId").GetString() == "alice")
            .GetProperty("streetId").GetString());
        Assert.DoesNotContain(aliceToken, text);
        Assert.DoesNotContain(bobToken, text);
        Assert.DoesNotContain("cardIds", text);
    }

    [Fact]
    public async Task ProductionHasNoAuditVerifierRoute()
    {
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b => b.UseEnvironment("Production"));
        using var client = factory.CreateClient();
        using var response = await client.GetAsync($"/api/dev/matches/{Guid.NewGuid()}/audit");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
