using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// Privacy headers belong to the Development HTTP pipeline, not individual
/// match endpoints. This covers even errors raised before endpoint execution.
/// </summary>
public sealed class DevelopmentNoStoreResponseTests
{
    private const string Root = "/api/dev/matches";
    private static WebApplicationFactory<Program> Host(string environment) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static void AssertPrivate(HttpResponseMessage response, HttpStatusCode expected)
    {
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.True(response.Headers.TryGetValues("Pragma", out var pragma));
        Assert.Equal("no-cache", Assert.Single(pragma!));
        Assert.True(response.Headers.TryGetValues("Expires", out var expires));
        Assert.Equal("0", Assert.Single(expires!));
        Assert.False(response.Headers.Contains("X-Edonism-Dev-Token"));
    }

    [Fact]
    public async Task AllFourCreatorIssuanceRoutesAreUncacheableIncludingBearerCredentials()
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var routes = new (string Path, object Request)[]
        {
            (Root + "/", new
            {
                players = new[]
                {
                    new { playerId = "alice", startingSlotId = "N-01" },
                    new { playerId = "bob", startingSlotId = "S-01" }
                }
            }),
            (Root + "/from-cards", new
            {
                players = new[]
                {
                    new { playerId = "alice", startingCardId = "sport:01" },
                    new { playerId = "bob", startingCardId = "public-financing:01" }
                },
                availableActivities = ActivitySetupFixture.Catalog(),
                seed = 2026
            }),
            (Root + "/from-characters", new
            {
                playerIds = new[] { "alice", "bob" },
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                seed = 2026
            }),
            (Root + "/from-full-deck", new
            {
                playerIds = new[] { "alice", "bob" },
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            })
        };
        foreach (var (path, payload) in routes)
        {
            using var response = await creator.PostAsJsonAsync(path, payload);
            AssertPrivate(response, HttpStatusCode.Created);
            using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(json);
            var credentials = json.RootElement.GetProperty("credentials").EnumerateArray().ToArray();
            Assert.Equal(2, credentials.Length);
            Assert.All(credentials, seat =>
                Assert.Matches("^[A-F0-9]{64}$", seat.GetProperty("token").GetString()!));
        }
    }

    [Fact]
    public async Task PrivateReadsConditional304CommandsConflictsAndRevocationAreUncacheable()
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        using var created = await creator.PostAsJsonAsync(Root + "/from-full-deck", new
        {
            playerIds = new[] { "alice", "bob" },
            characters = CharacterSetupFixture.Catalog(),
            availableActivities = ActivitySetupFixture.Catalog(),
            actionCardIds = ActionDeckFixture.ActionIds(),
            electionDayCardId = ActionDeckFixture.ElectionDayId,
            seed = 2026
        });
        AssertPrivate(created, HttpStatusCode.Created);
        using var document = await created.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(document);
        var root = document.RootElement;
        var id = root.GetProperty("matchId").GetGuid();
        var tokens = root.GetProperty("credentials").EnumerateArray()
            .Select(x => x.GetProperty("token").GetString()!).ToArray();
        using var alice = Seat(host, tokens[0]);
        using var bob = Seat(host, tokens[1]);
        var path = $"{Root}/{id}";

        using var snapshot = await alice.GetAsync(path);
        AssertPrivate(snapshot, HttpStatusCode.OK);
        var etag = snapshot.Headers.ETag?.ToString();
        Assert.NotNull(etag);
        using var conditional = new HttpRequestMessage(HttpMethod.Get, path);
        conditional.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var unchanged = await bob.SendAsync(conditional);
        AssertPrivate(unchanged, HttpStatusCode.NotModified);
        Assert.Empty(await unchanged.Content.ReadAsByteArrayAsync());

        foreach (var suffix in new[] { "/hand", "/seat", "/turn-options", "/audit" })
        {
            using var privateRead = await alice.GetAsync(path + suffix);
            AssertPrivate(privateRead, HttpStatusCode.OK);
        }

        // Only Alice may end the first turn, and a stale revision is a 409.
        using var wrongTurn = await bob.PostAsJsonAsync(path + "/end-turn",
            new { expectedRevision = 0 });
        AssertPrivate(wrongTurn, HttpStatusCode.Conflict);
        using var moved = await alice.PostAsJsonAsync(path + "/end-turn",
            new { expectedRevision = 0 });
        AssertPrivate(moved, HttpStatusCode.OK);
        using var stale = await alice.PostAsJsonAsync(path + "/end-turn",
            new { expectedRevision = 0 });
        AssertPrivate(stale, HttpStatusCode.Conflict);

        using var rotated = await bob.PostAsync(path + "/rotate-token", null);
        AssertPrivate(rotated, HttpStatusCode.OK);
        using var newCredential = await rotated.Content.ReadFromJsonAsync<JsonDocument>();
        var newToken = newCredential!.RootElement.GetProperty("token").GetString()!;
        Assert.NotEqual(tokens[1], newToken);
        using var revoked = await bob.GetAsync(path + "/hand");
        AssertPrivate(revoked, HttpStatusCode.NotFound);
        using var revoked304 = new HttpRequestMessage(HttpMethod.Get, path);
        revoked304.Headers.TryAddWithoutValidation("If-None-Match", etag);
        using var deniedConditional = await bob.SendAsync(revoked304);
        AssertPrivate(deniedConditional, HttpStatusCode.NotFound);
        using var renewed = Seat(host, newToken);
        using var valid = await renewed.GetAsync(path + "/seat");
        AssertPrivate(valid, HttpStatusCode.OK);

        using var unauthenticated = await creator.GetAsync(path + "/hand");
        AssertPrivate(unauthenticated, HttpStatusCode.NotFound);
        using var unknownPath = await creator.GetAsync(path + "/not-a-real-route");
        AssertPrivate(unknownPath, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task InvalidFixturesAndModelBindingFailuresAreAlsoNoStore()
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        using var rejected = await creator.PostAsJsonAsync(Root + "/", new
        {
            players = new[]
            {
                new { playerId = "alice", startingSlotId = "N-01" },
                new { playerId = "bob", startingSlotId = "NOT_A_STREET" }
            }
        });
        AssertPrivate(rejected, HttpStatusCode.BadRequest);

        // Invalid JSON fails while binding parameters, before endpoint filters.
        using var broken = new StringContent("{", Encoding.UTF8, "application/json");
        using var badJson = await creator.PostAsync(Root + "/from-full-deck", broken);
        AssertPrivate(badJson, HttpStatusCode.BadRequest);

        using var unknownMatch = await creator.GetAsync(
            $"{Root}/{Guid.NewGuid()}/seat");
        AssertPrivate(unknownMatch, HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task PublicRoutesAreUnchangedAndDevelopmentSurfaceIsNotRegisteredInProduction()
    {
        using var development = Host("Development");
        using var client = development.CreateClient();
        foreach (var path in new[] { "/api/v1/meta", "/api/v1/board", "/health" })
        {
            using var publicResponse = await client.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, publicResponse.StatusCode);
            Assert.Null(publicResponse.Headers.CacheControl);
            Assert.False(publicResponse.Headers.Contains("Pragma"));
        }

        using var production = Host("Production");
        using var prodClient = production.CreateClient();
        using var missing = await prodClient.GetAsync(Root + "/" + Guid.NewGuid() + "/hand");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        Assert.Null(missing.Headers.CacheControl);
        using var board = await prodClient.GetAsync("/api/v1/board");
        Assert.Equal(HttpStatusCode.OK, board.StatusCode);
        Assert.Null(board.Headers.CacheControl);
    }
}
