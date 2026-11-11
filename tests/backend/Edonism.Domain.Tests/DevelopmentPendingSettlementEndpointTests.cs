using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentPendingSettlementEndpointTests
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
    public async Task OnlyValidSeatCanReadGrossPreviewAndReadingNeverPaysOrAdvancesRound()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        using var createdResponse = await creator.PostAsJsonAsync(
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
        var credentials = created.RootElement.GetProperty("credentials").EnumerateArray().ToArray();
        var aliceToken = credentials[0].GetProperty("token").GetString()!;
        var bobToken = credentials[1].GetProperty("token").GetString()!;
        var path = $"/api/dev/matches/{id}/settlement-preview";
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        using var invalid = Seat(host, new string('F', 64));

        using var anon = await creator.GetAsync(path);
        using var forged = await invalid.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, anon.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, forged.StatusCode);
        Assert.Equal("no-store", anon.Headers.CacheControl?.ToString());
        Assert.Equal("no-store", forged.Headers.CacheControl?.ToString());
        using var pre = await alice.GetAsync(path);
        Assert.Equal(HttpStatusCode.Conflict, pre.StatusCode);
        Assert.Equal("no-store", pre.Headers.CacheControl?.ToString());
        using var preJson = await pre.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("round_not_pending", preJson!.RootElement.GetProperty("code").GetString());

        using var first = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        using var stillInRound = await bob.GetAsync(path);
        Assert.Equal(HttpStatusCode.Conflict, stillInRound.StatusCode);
        using var last = await bob.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 1 });
        Assert.Equal(HttpStatusCode.OK, last.StatusCode);

        using var result = await alice.GetAsync(path);
        using var second = await bob.GetAsync(path + "?playerId=alice");
        Assert.Equal(HttpStatusCode.OK, result.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal("no-store", result.Headers.CacheControl?.ToString());
        Assert.Equal("no-store", second.Headers.CacheControl?.ToString());
        var json = await result.Content.ReadAsStringAsync();
        Assert.Equal(json, await second.Content.ReadAsStringAsync());
        using var view = JsonDocument.Parse(json);
        var root = view.RootElement;
        Assert.Equal(id, root.GetProperty("matchId").GetGuid());
        Assert.Equal(1, root.GetProperty("round").GetInt32());
        Assert.Equal(2, root.GetProperty("verifiedRevision").GetInt64());
        Assert.Equal(new[] { "bob", "alice" },
            root.GetProperty("nextTurnOrder").EnumerateArray().Select(x => x.GetString()));
        var quotes = root.GetProperty("grossSalaryQuotes").EnumerateArray().ToArray();
        Assert.Equal(2, quotes.Length);
        Assert.Equal(new[] { "alice", "bob" },
            quotes.Select(q => q.GetProperty("playerId").GetString()));
        Assert.All(quotes, q =>
        {
            Assert.Equal(2, q.GetProperty("baseAtoms").GetInt32());
            Assert.Equal(1, q.GetProperty("standingActivityAtoms").GetInt32());
            Assert.Equal(3, q.GetProperty("grossAtoms").GetInt32());
        });
        Assert.DoesNotContain(aliceToken, json);
        Assert.DoesNotContain(bobToken, json);
        Assert.DoesNotContain("cardIds", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("drawPile", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", json, StringComparison.OrdinalIgnoreCase);

        using var before = await alice.GetFromJsonAsync<JsonDocument>($"/api/dev/matches/{id}");
        Assert.NotNull(before);
        Assert.Equal(2, before.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(1, before.RootElement.GetProperty("phase").GetInt32());
        Assert.All(before.RootElement.GetProperty("players").EnumerateArray(),
            p => Assert.Equal(4, p.GetProperty("atoms").GetInt32()));
        Assert.Equal(3, before.RootElement.GetProperty("events").GetArrayLength());
        using var hand = await bob.GetFromJsonAsync<JsonDocument>($"/api/dev/matches/{id}/hand");
        Assert.Equal(4, hand!.RootElement.GetProperty("cardIds").GetArrayLength());

        using var rotate = await alice.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var rotated = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        using var newAlice = Seat(host, rotated!.RootElement.GetProperty("token").GetString()!);
        using var revoked = await alice.GetAsync(path);
        Assert.Equal(HttpStatusCode.NotFound, revoked.StatusCode);
        using var recovered = await newAlice.GetAsync(path);
        Assert.Equal(HttpStatusCode.OK, recovered.StatusCode);
        Assert.Equal(json, await recovered.Content.ReadAsStringAsync());

        using var after = await newAlice.GetFromJsonAsync<JsonDocument>($"/api/dev/matches/{id}");
        Assert.Equal(before.RootElement.GetProperty("revision").GetInt64(),
            after!.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(before.RootElement.GetProperty("events").GetArrayLength(),
            after.RootElement.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task ProductionDoesNotExposeSettlementPreview()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.GetAsync(
            $"/api/dev/matches/{Guid.NewGuid()}/settlement-preview");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
