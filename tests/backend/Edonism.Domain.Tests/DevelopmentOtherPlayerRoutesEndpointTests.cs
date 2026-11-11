using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentOtherPlayerRoutesEndpointTests
{
    [Fact]
    public async Task PrivateBearerControlsReadAndRotationWithoutEverChangingTheMatch()
    {
        using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment("Development"));
        using var publicClient = host.CreateClient();
        using var createdResponse = await publicClient.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
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
        var creds = created.RootElement.GetProperty("credentials").EnumerateArray().ToArray();
        var aliceToken = creds[0].GetProperty("token").GetString()!;
        var bobToken = creds[1].GetProperty("token").GetString()!;
        var path = $"/api/dev/matches/{id}/other-player-routes";

        using var alice = host.CreateClient();
        alice.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", aliceToken);
        using var bob = host.CreateClient();
        bob.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", bobToken);
        using var forged = host.CreateClient();
        forged.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", new string('F', 64));
        using var anonymous = await publicClient.GetAsync(path);
        using var invalid = await forged.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, anonymous.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, invalid.StatusCode);
        Assert.Equal("no-store", anonymous.Headers.CacheControl?.ToString());
        Assert.Equal("no-store", invalid.Headers.CacheControl?.ToString());

        using var ar = await alice.GetAsync(path + "?playerId=bob");
        using var br = await bob.GetAsync(path + "?playerId=alice");
        Assert.Equal(HttpStatusCode.OK, ar.StatusCode);
        Assert.Equal(HttpStatusCode.OK, br.StatusCode);
        Assert.Equal("no-store", ar.Headers.CacheControl?.ToString());
        Assert.Equal("no-store", br.Headers.CacheControl?.ToString());
        using var aliceView = await ar.Content.ReadFromJsonAsync<JsonDocument>();
        using var bobView = await br.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("alice", aliceView!.RootElement.GetProperty("playerId").GetString());
        Assert.Equal("bob", bobView!.RootElement.GetProperty("playerId").GetString());
        var aOther = Assert.Single(aliceView.RootElement.GetProperty("others").EnumerateArray());
        Assert.Equal("bob", aOther.GetProperty("otherPlayerId").GetString());
        Assert.Equal(1, aOther.GetProperty("controlledActivities").GetInt32());
        Assert.Equal(1, aOther.GetProperty("standingHenchmen").GetInt32());
        Assert.Equal(aOther.GetProperty("streetSteps").GetInt32() + 1,
            aOther.GetProperty("streetPath").GetArrayLength());
        var bOther = Assert.Single(bobView.RootElement.GetProperty("others").EnumerateArray());
        Assert.Equal("alice", bOther.GetProperty("otherPlayerId").GetString());
        Assert.Equal(0, aliceView.RootElement.GetProperty("verifiedRevision").GetInt64());
        var content = await ar.Content.ReadAsStringAsync();
        Assert.DoesNotContain(aliceToken, content);
        Assert.DoesNotContain(bobToken, content);
        Assert.DoesNotContain("cardIds", content, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("faction", content, StringComparison.OrdinalIgnoreCase);

        using var readState = await alice.GetAsync($"/api/dev/matches/{id}");
        using var state = await readState.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal(0, state!.RootElement.GetProperty("revision").GetInt64());

        using var options = await alice.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{id}/turn-options");
        var destination = options!.RootElement.GetProperty("freeMoveStreetIds")[0].GetString();
        using var move = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
            new { expectedRevision = 0, destinationStreetId = destination });
        Assert.Equal(HttpStatusCode.OK, move.StatusCode);
        using var updated = await bob.GetFromJsonAsync<JsonDocument>(path);
        Assert.Equal(1, updated!.RootElement.GetProperty("verifiedRevision").GetInt64());
        Assert.Equal(destination,
            updated.RootElement.GetProperty("others")[0].GetProperty("streetId").GetString());

        using var rotate = await alice.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var replacement = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        using var revoked = await alice.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, revoked.StatusCode);
        Assert.Equal("no-store", revoked.Headers.CacheControl?.ToString());
        using var newAlice = host.CreateClient();
        newAlice.DefaultRequestHeaders.Add("X-Edonism-Dev-Token",
            replacement!.RootElement.GetProperty("token").GetString());
        using var stillAuthorized = await newAlice.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, stillAuthorized.StatusCode);
        using var stillBob = await bob.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, stillBob.StatusCode);
    }

    [Fact]
    public async Task ProductionCannotRevealOtherPlayerRouteInformation()
    {
        using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment("Production"));
        using var client = host.CreateClient();
        using var response = await client.GetAsync(
            $"/api/dev/matches/{Guid.NewGuid()}/other-player-routes");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
