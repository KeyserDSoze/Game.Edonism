using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #45: malformed HTTP command bodies must not bypass the earlier bearer
/// gate or leak ASP.NET Minimal API binding errors to unauthorized callers.
/// </summary>
public sealed class DevelopmentCommandPrebindingAuthorizationTests
{
    private const string Root = "/api/dev/matches";

    private static WebApplicationFactory<Program> Host(string environment = "Development") =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static async Task<(Guid MatchId, string Alice, string Bob)> Create(HttpClient creator)
    {
        using var created = await creator.PostAsJsonAsync(Root + "/from-full-deck", new
        {
            playerIds = new[] { "alice", "bob" },
            characters = CharacterSetupFixture.Catalog(),
            availableActivities = ActivitySetupFixture.Catalog(),
            actionCardIds = ActionDeckFixture.ActionIds(),
            electionDayCardId = ActionDeckFixture.ElectionDayId,
            seed = 2026
        });
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var json = await created.Content.ReadFromJsonAsync<JsonDocument>();
        var root = json!.RootElement;
        var seats = root.GetProperty("credentials").EnumerateArray().ToArray();
        return (root.GetProperty("matchId").GetGuid(),
            seats[0].GetProperty("token").GetString()!,
            seats[1].GetProperty("token").GetString()!);
    }

    private static async Task<HttpResponseMessage> Command(
        HttpClient client, string path, string? json, string contentType = "application/json",
        string? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        if (json is not null)
            request.Content = new StringContent(json, Encoding.UTF8, contentType);
        if (key is not null)
            request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return await client.SendAsync(request);
    }

    private static void AssertNoStore(HttpResponseMessage response)
    {
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.True(response.Headers.TryGetValues("Pragma", out var pragma));
        Assert.Equal("no-cache", Assert.Single(pragma!));
        var hasExpires = response.Headers.TryGetValues("Expires", out var expires)
            || response.Content.Headers.TryGetValues("Expires", out expires);
        Assert.True(hasExpires);
        Assert.Equal("0", Assert.Single(expires!));
    }

    private static async Task AssertNotFound(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        AssertNoStore(response);
        using var body = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("match_not_found", body!.RootElement.GetProperty("code").GetString());
        Assert.False(body.RootElement.TryGetProperty("expectedRevision", out _));
    }

    [Theory]
    [InlineData("end-turn")]
    [InlineData("free-move")]
    public async Task AuthPrecedesMalformedJsonSchemaContentTypeAndIdempotencyHeader(string kind)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        using var forged = Seat(host, new string('F', 64));
        using var malformedToken = Seat(host, "not-hex-token");
        var path = $"{Root}/{id}/{kind}";
        var cases = new (string? Body, string Type, HttpStatusCode Authorized)[]
        {
            ("{", "application/json", HttpStatusCode.BadRequest),
            ("{\"expectedRevision\":\"not-a-long\",\"destinationStreetId\":123}",
                "application/json", HttpStatusCode.BadRequest),
            ("{\"expectedRevision\":0,\"destinationStreetId\":\"planck\"}",
                "text/plain", HttpStatusCode.UnsupportedMediaType),
            (null, "application/json", HttpStatusCode.BadRequest)
        };
        foreach (var (body, contentType, authorized) in cases)
        {
            // All callers observe the exact same 404, even if ASP.NET would
            // reject the body before entering the normal endpoint handler.
            foreach (var unauthorized in new[] { creator, forged, malformedToken })
            {
                using var denied = await Command(unauthorized, path, body, contentType);
                await AssertNotFound(denied);
            }

            using var validSeat = await Command(alice, path, body, contentType);
            Assert.Equal(authorized, validSeat.StatusCode);
            AssertNoStore(validSeat);
        }

        // Even an invalid idempotency header cannot be parsed before auth.
        const string acceptedBody = "{\"expectedRevision\":0,\"destinationStreetId\":\"planck\"}";
        using var unauthenticatedKey = await Command(creator, path, acceptedBody,
            key: "not-a-guid");
        await AssertNotFound(unauthenticatedKey);
        using var invalidKey = await Command(alice, path, acceptedBody,
            key: "not-a-guid");
        Assert.Equal(HttpStatusCode.BadRequest, invalidKey.StatusCode);
        AssertNoStore(invalidKey);

        // Command validation and preflight are not themselves game events.
        using var before = await alice.GetFromJsonAsync<JsonDocument>($"{Root}/{id}");
        Assert.Equal(0, before!.RootElement.GetProperty("revision").GetInt64());
        Assert.Single(before.RootElement.GetProperty("events").EnumerateArray());
        Assert.All(before.RootElement.GetProperty("players").EnumerateArray(),
            p => Assert.Equal(4, p.GetProperty("atoms").GetInt32()));
        using var bobHand = await bob.GetFromJsonAsync<JsonDocument>($"{Root}/{id}/hand");
        Assert.Equal(4, bobHand!.RootElement.GetProperty("cardIds").GetArrayLength());

        // The same valid actor can still make the original legal command.
        string payload;
        if (kind == "end-turn")
        {
            payload = "{\"expectedRevision\":0}";
        }
        else
        {
            using var options = await alice.GetFromJsonAsync<JsonDocument>(
                $"{Root}/{id}/turn-options");
            var destination = options!.RootElement.GetProperty("freeMoveStreetIds")[0].GetString()!;
            payload = JsonSerializer.Serialize(new { expectedRevision = 0,
                destinationStreetId = destination });
        }
        using var accepted = await Command(alice, path, payload,
            key: Guid.NewGuid().ToString("D"));
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        AssertNoStore(accepted);
        using var after = await bob.GetFromJsonAsync<JsonDocument>($"{Root}/{id}");
        Assert.Equal(1, after!.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(2, after.RootElement.GetProperty("events").GetArrayLength());
    }

    [Theory]
    [InlineData("end-turn")]
    [InlineData("free-move")]
    public async Task RevokedBearerIsRejectedBeforeJsonBindingAndNewBearerRetainsCommandRights(
        string kind)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        var path = $"{Root}/{id}/{kind}";
        using var rotation = await alice.PostAsync($"{Root}/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotation.StatusCode);
        using var rotated = await rotation.Content.ReadFromJsonAsync<JsonDocument>();
        using var current = Seat(host, rotated!.RootElement.GetProperty("token").GetString()!);

        using var revokedMalformed = await Command(alice, path, "{");
        await AssertNotFound(revokedMalformed);
        using var revokedType = await Command(alice, path, "{}", "text/plain");
        await AssertNotFound(revokedType);
        using var revokedKey = await Command(alice, path, "{\"expectedRevision\":0}",
            key: "bad-key");
        await AssertNotFound(revokedKey);

        using var validMalformed = await Command(current, path, "{");
        Assert.Equal(HttpStatusCode.BadRequest, validMalformed.StatusCode);
        AssertNoStore(validMalformed);

        // The same match may still be played after rotating the token.
        string payload;
        if (kind == "end-turn")
        {
            payload = "{\"expectedRevision\":0}";
        }
        else
        {
            using var opts = await current.GetFromJsonAsync<JsonDocument>(
                $"{Root}/{id}/turn-options");
            var next = opts!.RootElement.GetProperty("freeMoveStreetIds")[0].GetString()!;
            payload = JsonSerializer.Serialize(new { expectedRevision = 0,
                destinationStreetId = next });
        }
        using var accepted = await Command(current, path, payload);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        using var state = await bob.GetFromJsonAsync<JsonDocument>($"{Root}/{id}");
        Assert.Equal(1, state!.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(2, state.RootElement.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task UnmatchedRoutesAndProductionStillFollowNormalRouting()
    {
        using var dev = Host();
        using var client = dev.CreateClient();
        var (id, _, _) = await Create(client);
        using var wrongRoute = await Command(client,
            $"{Root}/{id}/nonexistent-command", "{");
        Assert.Equal(HttpStatusCode.NotFound, wrongRoute.StatusCode);
        AssertNoStore(wrongRoute);
        using var unknownMatch = await Command(client,
            $"{Root}/{Guid.NewGuid()}/end-turn", "{");
        await AssertNotFound(unknownMatch);

        using var prod = Host("Production");
        using var production = prod.CreateClient();
        using var noDev = await Command(production, $"{Root}/{id}/end-turn", "{");
        Assert.Equal(HttpStatusCode.NotFound, noDev.StatusCode);
        using var publicRoute = await production.GetAsync("/api/v1/meta");
        Assert.Equal(HttpStatusCode.OK, publicRoute.StatusCode);
    }
}
