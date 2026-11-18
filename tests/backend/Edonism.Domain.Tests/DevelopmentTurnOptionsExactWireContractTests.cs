using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #170: The same genuine actor-scoped turn-options contract is emitted by
/// GET /turn-options and the atomic GET /seat bootstrap for 2/4/8 owners.
/// React rejects unexpected keys in either untrusted response BEFORE its
/// option lease/session is updated. No new command rule or production login.
/// </summary>
public sealed class DevelopmentTurnOptionsExactWireContractTests
{
    private static WebApplicationFactory<Program> Host(string environment) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static readonly string[] ExpectedOptionsKeys =
        ["canEndTurn", "freeMoveStreetIds", "matchId", "playerId", "revision"];

    private static readonly string[] ExpectedBootstrapKeys =
        ["hand", "matchId", "playerId", "state", "turnOptions"];

    private static string[] OwnKeys(JsonElement obj) =>
        obj.EnumerateObject()
            .Select(property => property.Name)
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task AuthenticatedOptionsAndAtomicBootstrapHaveTheExactSamePrivateWireShape(
        int seats)
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var ids = Enumerable.Range(0, seats)
            .Select(i => $"player-{i}").ToArray();
        using var createdResponse = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = ids,
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
        var credentials = created.RootElement.GetProperty("credentials")
            .EnumerateArray().ToArray();
        Assert.Equal(seats, credentials.Length);

        foreach (var entry in credentials)
        {
            var actor = entry.GetProperty("playerId").GetString()!;
            var bearer = entry.GetProperty("token").GetString()!;
            Assert.Contains(actor, ids);
            using var seatClient = host.CreateClient();
            seatClient.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", bearer);
            var route = $"/api/dev/matches/{matchId}";
            using var optionsResponse = await seatClient.GetAsync(route + "/turn-options");
            Assert.Equal(HttpStatusCode.OK, optionsResponse.StatusCode);
            Assert.Equal("no-store", optionsResponse.Headers.CacheControl?.ToString());
            using var optionsDoc = await optionsResponse.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(optionsDoc);
            var options = optionsDoc.RootElement;
            Assert.Equal(ExpectedOptionsKeys, OwnKeys(options));
            Assert.Equal(matchId, options.GetProperty("matchId").GetGuid());
            Assert.Equal(actor, options.GetProperty("playerId").GetString());
            Assert.Equal(0, options.GetProperty("revision").GetInt64());

            var isActive = actor == ids[0];
            Assert.Equal(isActive, options.GetProperty("canEndTurn").GetBoolean());
            if (isActive)
                Assert.NotEmpty(options.GetProperty("freeMoveStreetIds").EnumerateArray());
            else
                Assert.Equal(0, options.GetProperty("freeMoveStreetIds").GetArrayLength());

            using var bootstrapResponse = await seatClient.GetAsync(route + "/seat");
            Assert.Equal(HttpStatusCode.OK, bootstrapResponse.StatusCode);
            Assert.Equal("no-store", bootstrapResponse.Headers.CacheControl?.ToString());
            using var bootstrapDoc = await bootstrapResponse.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(bootstrapDoc);
            var bootstrap = bootstrapDoc.RootElement;
            Assert.Equal(ExpectedBootstrapKeys, OwnKeys(bootstrap));
            Assert.Equal(matchId, bootstrap.GetProperty("matchId").GetGuid());
            Assert.Equal(actor, bootstrap.GetProperty("playerId").GetString());
            var nested = bootstrap.GetProperty("turnOptions");
            Assert.Equal(ExpectedOptionsKeys, OwnKeys(nested));
            Assert.Equal(options.GetRawText(), nested.GetRawText());
            Assert.Equal(matchId, bootstrap.GetProperty("state")
                .GetProperty("matchId").GetGuid());
            Assert.Equal(actor, bootstrap.GetProperty("hand")
                .GetProperty("playerId").GetString());
            Assert.Equal(4, bootstrap.GetProperty("hand")
                .GetProperty("cardIds").GetArrayLength());

            // Neither read-only options object may carry tokens, hands,
            // hidden faction data, or a new elevated future action.
            foreach (var payload in new[] { options.GetRawText(), nested.GetRawText() })
            {
                Assert.DoesNotContain("token", payload, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("cardIds", payload, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("privateHand", payload, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("adminActions", payload, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("futureActions", payload, StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    [Fact]
    public async Task ProductionDoesNotExposePrivateDevelopmentTurnOptionsOrBootstrap()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        const string route = "/api/dev/matches/00000000-0000-0000-0000-000000000020";
        using var options = await client.GetAsync(route + "/turn-options");
        using var bootstrap = await client.GetAsync(route + "/seat");
        Assert.Equal(HttpStatusCode.NotFound, options.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, bootstrap.StatusCode);
    }
}
