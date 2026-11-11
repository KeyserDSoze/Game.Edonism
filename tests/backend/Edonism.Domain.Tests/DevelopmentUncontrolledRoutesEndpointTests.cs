using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentUncontrolledRoutesEndpointTests
{
    private static WebApplicationFactory<Program> Host(string environment = "Development") =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    [Fact]
    public async Task AuthenticatedSeatsSeeOnlyOwnVerifiedPublicRouteDistances()
    {
        using var host = Host();
        using var creator = host.CreateClient();
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
        var root = created!.RootElement;
        var id = root.GetProperty("matchId").GetGuid();
        var credentials = root.GetProperty("credentials").EnumerateArray().ToArray();
        var aliceToken = credentials[0].GetProperty("token").GetString()!;
        var bobToken = credentials[1].GetProperty("token").GetString()!;
        var endpoint = $"/api/dev/matches/{id}/uncontrolled-routes";

        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        using var forged = Seat(host, new string('F', 64));
        using var anonymous = await creator.GetAsync(endpoint);
        using var invalid = await forged.GetAsync(endpoint);
        Assert.Equal(HttpStatusCode.NotFound, anonymous.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, invalid.StatusCode);
        Assert.Equal("no-store", anonymous.Headers.CacheControl?.ToString());
        Assert.Equal("no-store", invalid.Headers.CacheControl?.ToString());

        using var first = await alice.GetAsync(endpoint);
        using var second = await bob.GetAsync(endpoint + "?playerId=alice");
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal("no-store", first.Headers.CacheControl?.ToString());
        Assert.Equal("no-store", second.Headers.CacheControl?.ToString());

        using var alicePlan = await first.Content.ReadFromJsonAsync<JsonDocument>();
        using var bobPlan = await second.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("alice", alicePlan!.RootElement.GetProperty("playerId").GetString());
        Assert.Equal("bob", bobPlan!.RootElement.GetProperty("playerId").GetString());
        Assert.Equal(0, alicePlan.RootElement.GetProperty("verifiedRevision").GetInt64());
        Assert.Equal(0, bobPlan.RootElement.GetProperty("verifiedRevision").GetInt64());
        var aliceRoutes = alicePlan.RootElement.GetProperty("routes").EnumerateArray().ToArray();
        var bobRoutes = bobPlan.RootElement.GetProperty("routes").EnumerateArray().ToArray();
        Assert.Equal(28, aliceRoutes.Length);
        Assert.Equal(28, bobRoutes.Length);
        foreach (var route in aliceRoutes)
        {
            Assert.True(route.GetProperty("streetSteps").GetInt32() >= 0);
            Assert.False(string.IsNullOrEmpty(route.GetProperty("streetId").GetString()));
            Assert.False(string.IsNullOrEmpty(route.GetProperty("cardId").GetString()));
        }
        var text = await first.Content.ReadAsStringAsync();
        Assert.DoesNotContain(aliceToken, text);
        Assert.DoesNotContain(bobToken, text);
        Assert.DoesNotContain("cardIds", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("atoms", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("drawPile", text, StringComparison.OrdinalIgnoreCase);

        using var moveOptions = await alice.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{id}/turn-options");
        var adjacent = moveOptions!.RootElement.GetProperty("freeMoveStreetIds")[0].GetString();
        using var move = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move", new
        {
            destinationStreetId = adjacent,
            expectedRevision = 0
        });
        Assert.Equal(HttpStatusCode.OK, move.StatusCode);
        using var updated = await alice.GetFromJsonAsync<JsonDocument>(endpoint);
        Assert.Equal(1, updated!.RootElement.GetProperty("verifiedRevision").GetInt64());
        Assert.Equal(adjacent, updated.RootElement.GetProperty("fromStreetId").GetString());
        Assert.Equal(28, updated.RootElement.GetProperty("routes").GetArrayLength());
        using var state = await bob.GetFromJsonAsync<JsonDocument>($"/api/dev/matches/{id}");
        Assert.Equal(1, state!.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(4, state.RootElement.GetProperty("players")[0].GetProperty("atoms").GetInt32());

        using var rotate = await alice.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var renewed = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        using var oldTokenRead = await alice.GetAsync(endpoint);
        Assert.Equal(HttpStatusCode.NotFound, oldTokenRead.StatusCode);
        Assert.Equal("no-store", oldTokenRead.Headers.CacheControl?.ToString());
        using var newSeat = Seat(host, renewed!.RootElement.GetProperty("token").GetString()!);
        using var newTokenRead = await newSeat.GetAsync(endpoint);
        Assert.Equal(HttpStatusCode.OK, newTokenRead.StatusCode);
        using var stillBob = await bob.GetAsync(endpoint);
        Assert.Equal(HttpStatusCode.OK, stillBob.StatusCode);
    }

    [Fact]
    public async Task ProductionNeverExposesUncontrolledRoutePlanner()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.GetAsync(
            $"/api/dev/matches/{Guid.NewGuid()}/uncontrolled-routes");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
