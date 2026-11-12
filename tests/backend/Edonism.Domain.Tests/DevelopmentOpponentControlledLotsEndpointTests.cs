using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>Real Development HTTP actor boundary, no mocked identity.</summary>
public sealed class DevelopmentOpponentControlledLotsEndpointTests
{
    private static WebApplicationFactory<Program> Host() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment("Development"));

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task ReadOnlyPublicOpponentLotsStayPrivateToAuthenticatedSeat(int count)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var players = Enumerable.Range(0, count).Select(i => $"player-{i}").ToArray();
        using var created = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = players,
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var body = await created.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(body);
        var id = body.RootElement.GetProperty("matchId").GetGuid();
        var tokens = body.RootElement.GetProperty("credentials").EnumerateArray()
            .Select(x => x.GetProperty("token").GetString()!).ToArray();
        var path = $"/api/dev/matches/{id}/opponent-controlled-routes";

        using (var denied = await creator.GetAsync(path))
        {
            Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
            Assert.Equal("no-store", denied.Headers.CacheControl?.ToString());
        }
        using (var forged = Seat(host, new string('F', 64)))
        using (var denied = await forged.GetAsync(path))
            Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);

        using var owner = Seat(host, tokens[0]);
        using var publicBefore = await owner.GetAsync($"/api/dev/matches/{id}");
        var publicJson = await publicBefore.Content.ReadAsStringAsync();
        var expectedState = body.RootElement.GetProperty("state");
        for (var i = 0; i < count; i++)
        {
            using var actor = Seat(host, tokens[i]);
            using var response = await actor.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            using var projected = await response.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(projected);
            var root = projected.RootElement;
            Assert.Equal(players[i], root.GetProperty("playerId").GetString());
            Assert.Equal(0, root.GetProperty("verifiedRevision").GetInt64());
            var routes = root.GetProperty("routes").EnumerateArray().ToArray();
            Assert.Equal(count - 1, routes.Length);
            Assert.DoesNotContain(routes,
                route => route.GetProperty("ownerPlayerId").GetString() == players[i]);
            Assert.All(routes, route =>
            {
                Assert.True(route.GetProperty("streetSteps").GetInt32() >= 0);
                Assert.Equal(route.GetProperty("streetSteps").GetInt32() + 1,
                    route.GetProperty("streetPath").GetArrayLength());
            });
            var raw = await response.Content.ReadAsStringAsync();
            foreach (var token in tokens)
                Assert.DoesNotContain(token, raw);
            Assert.DoesNotContain("cardIds", raw, StringComparison.OrdinalIgnoreCase);
        }

        using var unchanged = await owner.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(publicJson, await unchanged.Content.ReadAsStringAsync());
        using var rotate = await owner.PostAsync(
            $"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var replacement = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(replacement);
        using (var old = await owner.GetAsync(path))
            Assert.Equal(HttpStatusCode.NotFound, old.StatusCode);
        using var fresh = Seat(host, replacement.RootElement.GetProperty("token").GetString()!);
        using var stillValid = await fresh.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, stillValid.StatusCode);
        using var same = await fresh.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(publicJson, await same.Content.ReadAsStringAsync());

        using var auditResponse = await fresh.GetAsync($"/api/dev/matches/{id}/audit");
        using var audit = await auditResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.True(audit!.RootElement.GetProperty("isValid").GetBoolean());
    }

    [Fact]
    public async Task ProductionDoesNotExposeOpponentControlledRoutes()
    {
        using var host = new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment("Production"));
        using var client = host.CreateClient();
        using var response = await client.GetAsync(
            $"/api/dev/matches/{Guid.NewGuid()}/opponent-controlled-routes");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
