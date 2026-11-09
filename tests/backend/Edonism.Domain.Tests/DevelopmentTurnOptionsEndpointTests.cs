using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Api.Development;
using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentTurnOptionsEndpointTests
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
        using var created = await response.Content.ReadFromJsonAsync<JsonDocument>();
        var root = created!.RootElement;
        var seats = root.GetProperty("credentials").EnumerateArray().ToArray();
        return (root.GetProperty("matchId").GetGuid(),
            seats[0].GetProperty("token").GetString()!,
            seats[1].GetProperty("token").GetString()!);
    }

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    [Fact]
    public async Task ActorOptionsAreRevisionBoundPrivateToSeatAndMatchServerMoveRules()
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        var url = $"/api/dev/matches/{id}/turn-options";
        using var initial = await alice.GetAsync(url + "?playerId=bob");
        Assert.Equal(HttpStatusCode.OK, initial.StatusCode);
        Assert.Equal("no-store", initial.Headers.CacheControl?.ToString());
        var a = await initial.Content.ReadFromJsonAsync<MatchTurnOptions>();
        Assert.NotNull(a);
        Assert.Equal("alice", a.PlayerId);
        Assert.Equal(0, a.Revision);
        Assert.True(a.CanEndTurn);
        using var state = await alice.GetFromJsonAsync<JsonDocument>($"/api/dev/matches/{id}");
        var origin = state.RootElement.GetProperty("players")[0].GetProperty("streetId").GetString()!;
        Assert.Equal(BoardCatalog.LoadDefault().Streets.Single(s => s.Id == origin).Neighbors,
            a.FreeMoveStreetIds);
        var b = await bob.GetFromJsonAsync<MatchTurnOptions>(url + "?playerId=alice");
        Assert.NotNull(b);
        Assert.Equal("bob", b.PlayerId);
        Assert.False(b.CanEndTurn);
        Assert.Empty(b.FreeMoveStreetIds);
        using var move = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/free-move",
            new { destinationStreetId = a.FreeMoveStreetIds[0], expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, move.StatusCode);
        var moved = await alice.GetFromJsonAsync<MatchTurnOptions>(url);
        Assert.NotNull(moved);
        Assert.Equal(1, moved.Revision);
        Assert.True(moved.CanEndTurn);
        Assert.Empty(moved.FreeMoveStreetIds);
        using var ended = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 1 });
        Assert.Equal(HttpStatusCode.OK, ended.StatusCode);
        Assert.False((await alice.GetFromJsonAsync<MatchTurnOptions>(url))!.CanEndTurn);
        Assert.True((await bob.GetFromJsonAsync<MatchTurnOptions>(url))!.CanEndTurn);
        using var last = await bob.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 2 });
        Assert.Equal(HttpStatusCode.OK, last.StatusCode);
        var pending = await bob.GetFromJsonAsync<MatchTurnOptions>(url);
        Assert.Equal(3, pending!.Revision);
        Assert.False(pending.CanEndTurn);
        Assert.Empty(pending.FreeMoveStreetIds);
        var json = await bob.GetStringAsync(url);
        Assert.DoesNotContain("token", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("cardIds", json);
        Assert.DoesNotContain("demo:action:", json);
    }

    [Fact]
    public async Task InvalidRevokedAndProductionCredentialsCannotReadTurnOptions()
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var (id, aliceToken, _) = await Create(creator);
        var path = $"/api/dev/matches/{id}/turn-options";
        using var anonymous = await creator.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, anonymous.StatusCode);
        using var forged = Seat(host, new string('0', 64));
        using var unknown = await forged.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        using var old = Seat(host, aliceToken);
        using var rotated = await old.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotated.StatusCode);
        using var credentials = await rotated.Content.ReadFromJsonAsync<JsonDocument>();
        var token = credentials!.RootElement.GetProperty("token").GetString()!;
        Assert.Equal(HttpStatusCode.NotFound, (await old.GetAsync(path)).StatusCode);
        using var fresh = Seat(host, token);
        Assert.Equal(HttpStatusCode.OK, (await fresh.GetAsync(path)).StatusCode);
        using var productionHost = Host("Production");
        using var production = productionHost.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await production.GetAsync(path)).StatusCode);
    }
}
