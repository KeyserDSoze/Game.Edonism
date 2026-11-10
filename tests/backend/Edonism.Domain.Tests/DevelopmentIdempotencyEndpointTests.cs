using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentIdempotencyEndpointTests
{
    private static WebApplicationFactory<Program> Host(string environment = "Development") =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static async Task<(Guid MatchId, string Alice, string Bob)> Create(HttpClient creator)
    {
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
        using var document = await response.Content.ReadFromJsonAsync<JsonDocument>();
        var root = document!.RootElement;
        var credentials = root.GetProperty("credentials").EnumerateArray().ToArray();
        return (root.GetProperty("matchId").GetGuid(),
            credentials[0].GetProperty("token").GetString()!,
            credentials[1].GetProperty("token").GetString()!);
    }

    private static HttpClient AsSeat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static async Task<HttpResponseMessage> Command(
        HttpClient client, string url, object payload, string? key = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = JsonContent.Create(payload)
        };
        if (key is not null)
            request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return await client.SendAsync(request);
    }

    private static async Task<(long Revision, int EventCount)> State(
        HttpClient client, Guid id)
    {
        using var json = await client.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{id}");
        var root = json!.RootElement;
        return (root.GetProperty("revision").GetInt64(),
            root.GetProperty("events").GetArrayLength());
    }

    [Fact]
    public async Task SameKeyReplaysOnlyOnceAndDifferentPayloadConflictsWithoutExtraAudit()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, _) = await Create(creator);
        using var alice = AsSeat(host, aliceToken);
        var key = Guid.NewGuid().ToString("D");
        var path = $"/api/dev/matches/{id}/end-turn";

        using var accepted = await Command(alice, path, new { expectedRevision = 0 }, key);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        Assert.Equal("no-store", accepted.Headers.CacheControl?.ToString());
        Assert.Equal((1L, 2), await State(alice, id));

        using var retried = await Command(alice, path, new { expectedRevision = 0 }, key);
        Assert.Equal(HttpStatusCode.OK, retried.StatusCode);
        using var data = await retried.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal(1, data!.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal((1L, 2), await State(alice, id));

        using var differentRevision = await Command(alice, path,
            new { expectedRevision = 1 }, key);
        Assert.Equal(HttpStatusCode.Conflict, differentRevision.StatusCode);
        using var conflict = await differentRevision.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("idempotency_key_reused",
            conflict!.RootElement.GetProperty("code").GetString());

        using var otherCommand = await Command(alice,
            $"/api/dev/matches/{id}/free-move",
            new { expectedRevision = 0, destinationStreetId = "anywhere" }, key);
        Assert.Equal(HttpStatusCode.Conflict, otherCommand.StatusCode);
        Assert.Equal((1L, 2), await State(alice, id));
    }

    [Fact]
    public async Task ConcurrentDuplicatePostsCommitExactlyOneTurnAndAllowOtherSeatOwnKey()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = AsSeat(host, aliceToken);
        using var bob = AsSeat(host, bobToken);
        var key = Guid.NewGuid().ToString("D");
        var path = $"/api/dev/matches/{id}/end-turn";

        var tasks = Enumerable.Range(0, 24).Select(async _ =>
        {
            using var response = await Command(alice, path,
                new { expectedRevision = 0 }, key);
            return (response.StatusCode,
                (await response.Content.ReadFromJsonAsync<JsonDocument>())!
                    .RootElement.GetProperty("revision").GetInt64());
        }).ToArray();
        var results = await Task.WhenAll(tasks);
        Assert.All(results, result =>
        {
            Assert.Equal(HttpStatusCode.OK, result.StatusCode);
            Assert.Equal(1, result.Item2);
        });
        Assert.Equal((1L, 2), await State(bob, id));

        // Keys are actor-scoped. Bob can legitimately reuse the same UUID
        // without inheriting or reading Alice's accepted command receipt.
        using var bobEnd = await Command(bob, path,
            new { expectedRevision = 1 }, key);
        Assert.Equal(HttpStatusCode.OK, bobEnd.StatusCode);
        using var bobReplay = await Command(bob, path,
            new { expectedRevision = 1 }, key);
        Assert.Equal(HttpStatusCode.OK, bobReplay.StatusCode);
        Assert.Equal((2L, 3), await State(alice, id));
    }

    [Fact]
    public async Task RevocationStillBlocksKnownKeyAndNewBearerMayRecoverReceipt()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = AsSeat(host, aliceToken);
        using var bob = AsSeat(host, bobToken);
        var key = Guid.NewGuid().ToString("D");
        var path = $"/api/dev/matches/{id}/end-turn";

        using var accepted = await Command(alice, path, new { expectedRevision = 0 }, key);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        using var rotate = await alice.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var body = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        var freshToken = body!.RootElement.GetProperty("token").GetString()!;

        using var forbidden = await Command(alice, path,
            new { expectedRevision = 0 }, key);
        Assert.Equal(HttpStatusCode.NotFound, forbidden.StatusCode);
        using var fresh = AsSeat(host, freshToken);
        using var recovered = await Command(fresh, path,
            new { expectedRevision = 0 }, key);
        Assert.Equal(HttpStatusCode.OK, recovered.StatusCode);
        Assert.Equal((1L, 2), await State(bob, id));
        using var bobWrong = await Command(bob, path,
            new { expectedRevision = 0 }, key);
        Assert.Equal(HttpStatusCode.Conflict, bobWrong.StatusCode);
        Assert.Equal((1L, 2), await State(bob, id));
    }

    [Fact]
    public async Task MalformedKeysReturn400AndLegacyUnkeyedCommandsStillUse409()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, _) = await Create(creator);
        using var alice = AsSeat(host, aliceToken);
        var path = $"/api/dev/matches/{id}/end-turn";
        foreach (var key in new[] { "not-a-uuid", Guid.Empty.ToString("D"),
            new string('1', 200) })
        {
            using var invalid = await Command(alice, path,
                new { expectedRevision = 0 }, key);
            Assert.Equal(HttpStatusCode.BadRequest, invalid.StatusCode);
            Assert.Equal("no-store", invalid.Headers.CacheControl?.ToString());
        }
        Assert.Equal((0L, 1), await State(alice, id));
        using var first = await Command(alice, path, new { expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        using var retry = await Command(alice, path, new { expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.Conflict, retry.StatusCode);
        Assert.Equal((1L, 2), await State(alice, id));

        using var productionHost = Host("Production");
        using var production = productionHost.CreateClient();
        using var absent = await Command(production, path,
            new { expectedRevision = 0 }, Guid.NewGuid().ToString("D"));
        Assert.Equal(HttpStatusCode.NotFound, absent.StatusCode);
    }

    [Fact]
    public async Task FreeMoveWithIdempotentReplayCannotTeleportOrConsumeSecondFreeMove()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, _) = await Create(creator);
        using var alice = AsSeat(host, aliceToken);
        using var options = await alice.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{id}/turn-options");
        Assert.NotNull(options);
        var adjacent = options.RootElement.GetProperty("freeMoveStreetIds")[0].GetString()!;
        var key = Guid.NewGuid().ToString("D");
        var path = $"/api/dev/matches/{id}/free-move";
        var payload = new { expectedRevision = 0, destinationStreetId = adjacent };

        using var first = await Command(alice, path, payload, key);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        using var again = await Command(alice, path, payload, key);
        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal((1L, 2), await State(alice, id));

        using var altered = await Command(alice, path,
            new { expectedRevision = 0, destinationStreetId = "other-street" }, key);
        Assert.Equal(HttpStatusCode.Conflict, altered.StatusCode);
        using var newKey = await Command(alice, path, payload,
            Guid.NewGuid().ToString("D"));
        Assert.Equal(HttpStatusCode.Conflict, newKey.StatusCode);
        Assert.Equal((1L, 2), await State(alice, id));
    }
}
