using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #160: salary preview is a verified read-only part of the Development
/// first-round progression. Never mistake gross quotes for paid atoms.
/// </summary>
public sealed class DevelopmentGrossSalaryAdmissionEndpointTests
{
    private static WebApplicationFactory<Program> Host(string env = "Development") =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(env));

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
    public async Task PrintedGrossWagesPreviewOnlyAfterAllTurnsAndDoesNotPayWallet(int count)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var players = Enumerable.Range(0, count)
            .Select(i => $"player-{i}").ToArray();
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
        using var createdBody = await created.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(createdBody);
        var root = createdBody.RootElement;
        var matchId = root.GetProperty("matchId").GetGuid();
        var tokens = root.GetProperty("credentials").EnumerateArray()
            .Select(credential => credential.GetProperty("token").GetString()!)
            .ToArray();
        var initial = root.GetProperty("state");
        var initialQuotes = initial.GetProperty("grossSalaryQuotes").EnumerateArray()
            .Select(q => (PlayerId: q.GetProperty("playerId").GetString()!,
                Base: q.GetProperty("baseAtoms").GetInt32(),
                Standing: q.GetProperty("standingActivityAtoms").GetInt32(),
                Gross: q.GetProperty("grossAtoms").GetInt32())).ToArray();
        Assert.Equal(count, initialQuotes.Length);
        Assert.Equal(players, initialQuotes.Select(x => x.PlayerId));
        Assert.All(initialQuotes, q =>
        {
            Assert.Equal(2, q.Base);
            Assert.Equal(1, q.Standing);
            Assert.Equal(3, q.Gross);
        });
        var expectedInitialWallet = initial.GetProperty("players").EnumerateArray()
            .Select(p => p.GetProperty("atoms").GetInt32()).ToArray();
        Assert.All(expectedInitialWallet, atoms => Assert.Equal(4, atoms));

        var previewPath = $"/api/dev/matches/{matchId}/settlement-preview";
        using (var denied = await creator.GetAsync(previewPath))
        {
            Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
            Assert.Equal("no-store", denied.Headers.CacheControl?.ToString());
        }
        using var actor = Seat(host, tokens[0]);
        using (var before = await actor.GetAsync(previewPath))
        {
            Assert.Equal(HttpStatusCode.Conflict, before.StatusCode);
            Assert.Equal("no-store", before.Headers.CacheControl?.ToString());
        }

        // The server derives actor from each capability, not request body.
        // End-turn is the current supported first-round command subset;
        // no card, tax, election or salary payment is invented here.
        for (var i = 0; i < count; i++)
        {
            using var active = Seat(host, tokens[i]);
            using var changed = await active.PostAsJsonAsync(
                $"/api/dev/matches/{matchId}/end-turn",
                new { expectedRevision = i });
            Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        }

        using var preview = await actor.GetAsync(previewPath);
        Assert.Equal(HttpStatusCode.OK, preview.StatusCode);
        Assert.Equal("no-store", preview.Headers.CacheControl?.ToString());
        using var previewBody = await preview.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(previewBody);
        var current = previewBody.RootElement;
        Assert.Equal(count, current.GetProperty("verifiedRevision").GetInt64());
        Assert.Equal(1, current.GetProperty("round").GetInt32());
        var next = current.GetProperty("nextTurnOrder").EnumerateArray()
            .Select(x => x.GetString()).ToArray();
        Assert.Equal(new[] { players[^1] }.Concat(players.Take(count - 1)), next);
        var quotes = current.GetProperty("grossSalaryQuotes").EnumerateArray()
            .Select(q => (PlayerId: q.GetProperty("playerId").GetString()!,
                Base: q.GetProperty("baseAtoms").GetInt32(),
                Standing: q.GetProperty("standingActivityAtoms").GetInt32(),
                Gross: q.GetProperty("grossAtoms").GetInt32())).ToArray();
        Assert.Equal(initialQuotes, quotes);

        using var snapshot = await actor.GetAsync($"/api/dev/matches/{matchId}");
        Assert.Equal(HttpStatusCode.OK, snapshot.StatusCode);
        using var snapshotBody = await snapshot.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(snapshotBody);
        var finalState = snapshotBody.RootElement;
        Assert.Equal(count, finalState.GetProperty("revision").GetInt64());
        var finalWallet = finalState.GetProperty("players").EnumerateArray()
            .Select(p => p.GetProperty("atoms").GetInt32()).ToArray();
        Assert.Equal(expectedInitialWallet, finalWallet);
        Assert.Equal(initialQuotes, finalState.GetProperty("grossSalaryQuotes")
            .EnumerateArray().Select(q => (
                PlayerId: q.GetProperty("playerId").GetString()!,
                Base: q.GetProperty("baseAtoms").GetInt32(),
                Standing: q.GetProperty("standingActivityAtoms").GetInt32(),
                Gross: q.GetProperty("grossAtoms").GetInt32())).ToArray());
        // The quote must not include hidden hands or capabilities.
        var raw = await preview.Content.ReadAsStringAsync();
        foreach (var token in tokens)
            Assert.DoesNotContain(token, raw);
        Assert.DoesNotContain("cardIds", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", raw, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ProductionCannotReadDevelopmentSalarySettlement()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var reply = await client.GetAsync(
            $"/api/dev/matches/{Guid.NewGuid()}/settlement-preview");
        Assert.Equal(HttpStatusCode.NotFound, reply.StatusCode);
    }
}
