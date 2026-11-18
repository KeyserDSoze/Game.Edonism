using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #176: exact publicly audited, read-only Development pending-settlement
/// HTTP wire: 6 root + 4 quote + 3 hypothetical scenario + 4 player row
/// properties. A hypothetical 0/1/2 tax is never paid or applied.
/// </summary>
public sealed class DevelopmentPendingSettlementExactWireAfterRotationTests
{
    private static WebApplicationFactory<Program> Host(string environment) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static string[] Keys(JsonElement value) =>
        value.EnumerateObject().Select(row => row.Name)
            .OrderBy(id => id, StringComparer.Ordinal).ToArray();

    private static void AssertExactSettlement(JsonElement root, Guid matchId,
        string[] players, int verifiedRevision)
    {
        Assert.Equal(new[]
        {
            "grossSalaryQuotes", "hypotheticalTaxScenarios", "matchId",
            "nextTurnOrder", "round", "verifiedRevision"
        }, Keys(root));
        Assert.Equal(matchId, root.GetProperty("matchId").GetGuid());
        Assert.Equal(1, root.GetProperty("round").GetInt32());
        Assert.Equal(verifiedRevision, root.GetProperty("verifiedRevision").GetInt64());
        Assert.Equal(
            new[] { players[^1] }.Concat(players.Take(players.Length - 1)),
            root.GetProperty("nextTurnOrder").EnumerateArray().Select(x => x.GetString()));

        var gross = root.GetProperty("grossSalaryQuotes").EnumerateArray().ToArray();
        Assert.Equal(players.Length, gross.Length);
        var grossAmounts = new int[players.Length];
        for (var i = 0; i < players.Length; i++)
        {
            var quote = gross[i];
            Assert.Equal(new[]
            {
                "baseAtoms", "grossAtoms", "playerId", "standingActivityAtoms"
            }, Keys(quote));
            Assert.Equal(players[i], quote.GetProperty("playerId").GetString());
            var grossValue = quote.GetProperty("grossAtoms").GetInt32();
            var baseValue = quote.GetProperty("baseAtoms").GetInt32();
            var standing = quote.GetProperty("standingActivityAtoms").GetInt32();
            Assert.Equal(2, baseValue);
            Assert.Equal(baseValue + standing, grossValue);
            Assert.InRange(standing, 0, 16);
            grossAmounts[i] = grossValue;
        }
        Assert.InRange(gross.Sum(q => q.GetProperty("standingActivityAtoms").GetInt32()),
            0, 30);

        var scenarios = root.GetProperty("hypotheticalTaxScenarios")
            .EnumerateArray().ToArray();
        Assert.Equal(3, scenarios.Length);
        for (var tax = 0; tax <= 2; tax++)
        {
            var scenario = scenarios[tax];
            Assert.Equal(new[]
            {
                "hypotheticalTaxAtomsPerPlayer", "players", "potentialWithheldAtoms"
            }, Keys(scenario));
            Assert.Equal(tax, scenario.GetProperty("hypotheticalTaxAtomsPerPlayer").GetInt32());
            Assert.Equal(tax * players.Length,
                scenario.GetProperty("potentialWithheldAtoms").GetInt32());
            var rows = scenario.GetProperty("players").EnumerateArray().ToArray();
            Assert.Equal(players.Length, rows.Length);
            for (var index = 0; index < players.Length; index++)
            {
                var row = rows[index];
                Assert.Equal(new[]
                {
                    "grossAtoms", "hypotheticalNetAtoms",
                    "hypotheticalTaxAtoms", "playerId"
                }, Keys(row));
                Assert.Equal(players[index], row.GetProperty("playerId").GetString());
                Assert.Equal(grossAmounts[index], row.GetProperty("grossAtoms").GetInt32());
                Assert.Equal(tax, row.GetProperty("hypotheticalTaxAtoms").GetInt32());
                Assert.Equal(grossAmounts[index] - tax,
                    row.GetProperty("hypotheticalNetAtoms").GetInt32());
            }
        }
        var wire = root.GetRawText();
        foreach (var forbidden in new[]
        {
            "token", "privateHand", "cardIds", "drawPile", "selectedMayorTax",
            "walletCredit", "futureEffects", "salaryApplied", "adminActions",
            "taxCommand", "credentials"
        })
            Assert.DoesNotContain(forbidden, wire, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task RealPendingSettlementWireStaysExactAcrossSeatsAndBearerRotation(
        int seats)
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var players = Enumerable.Range(0, seats).Select(i => $"player-{i}").ToArray();
        using var createdResponse = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = players,
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.Created, createdResponse.StatusCode);
        using var created = await createdResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var matchId = created.RootElement.GetProperty("matchId").GetGuid();
        var tokens = created.RootElement.GetProperty("credentials")
            .EnumerateArray().Select(x => x.GetProperty("token").GetString()!)
            .ToArray();
        Assert.Equal(seats, tokens.Length);
        var path = $"/api/dev/matches/{matchId}";
        using var anonymous = await creator.GetAsync(path + "/settlement-preview");
        Assert.Equal(HttpStatusCode.NotFound, anonymous.StatusCode);

        // Only real accepted Domain commands advance the first round.
        for (var index = 0; index < seats; index++)
        {
            using var actor = Seat(host, tokens[index]);
            using var end = await actor.PostAsJsonAsync(path + "/end-turn",
                new { expectedRevision = index });
            Assert.Equal(HttpStatusCode.OK, end.StatusCode);
        }

        var previewUri = path + "/settlement-preview";
        string? canonical = null;
        for (var index = 0; index < seats; index++)
        {
            using var actor = Seat(host, tokens[index]);
            using var response = await actor.GetAsync(previewUri);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
            var wire = await response.Content.ReadAsStringAsync();
            using var doc = JsonDocument.Parse(wire);
            AssertExactSettlement(doc.RootElement, matchId, players, seats);
            if (canonical is not null) Assert.Equal(canonical, wire);
            canonical = wire;
            foreach (var bearer in tokens)
                Assert.DoesNotContain(bearer, wire, StringComparison.OrdinalIgnoreCase);
        }

        using var beforeActor = Seat(host, tokens[0]);
        using var beforeState = await beforeActor.GetFromJsonAsync<JsonDocument>(path);
        Assert.NotNull(beforeState);
        Assert.Equal(seats, beforeState.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(1, beforeState.RootElement.GetProperty("phase").GetInt32());
        var originalAtoms = beforeState.RootElement.GetProperty("players")
            .EnumerateArray().Select(x => x.GetProperty("atoms").GetInt32()).ToArray();

        using var rotatedActor = Seat(host, tokens[^1]);
        using var rotation = await rotatedActor.PostAsync(path + "/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotation.StatusCode);
        using var receipt = await rotation.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(receipt);
        var renewed = receipt.RootElement.GetProperty("token").GetString()!;
        using var revoked = await rotatedActor.GetAsync(previewUri);
        Assert.Equal(HttpStatusCode.NotFound, revoked.StatusCode);
        using var replacement = Seat(host, renewed);
        using var afterRotation = await replacement.GetAsync(previewUri);
        Assert.Equal(HttpStatusCode.OK, afterRotation.StatusCode);
        Assert.Equal("no-store", afterRotation.Headers.CacheControl?.ToString());
        Assert.Equal(canonical, await afterRotation.Content.ReadAsStringAsync());
        using var snapshot = await replacement.GetFromJsonAsync<JsonDocument>(path);
        Assert.NotNull(snapshot);
        Assert.Equal(seats, snapshot.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(1, snapshot.RootElement.GetProperty("phase").GetInt32());
        Assert.Equal(originalAtoms,
            snapshot.RootElement.GetProperty("players")
                .EnumerateArray().Select(x => x.GetProperty("atoms").GetInt32()));
        Assert.Equal(seats + 1, snapshot.RootElement.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task ProductionNeverExposesDevelopmentPendingSettlement()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var result = await client.GetAsync(
            "/api/dev/matches/00000000-0000-0000-0000-000000000020/settlement-preview");
        Assert.Equal(HttpStatusCode.NotFound, result.StatusCode);
    }
}
