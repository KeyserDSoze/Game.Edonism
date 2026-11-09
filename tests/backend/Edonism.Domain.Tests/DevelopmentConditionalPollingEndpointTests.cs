using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Api.Development;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentConditionalPollingEndpointTests
{
    private static WebApplicationFactory<Program> Host(DevelopmentMatchStore? store = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseEnvironment("Development");
            if (store is not null)
                builder.ConfigureTestServices(services =>
                {
                    services.RemoveAll<DevelopmentMatchStore>();
                    services.AddSingleton(store);
                });
        });

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
        using var payload = await response.Content.ReadFromJsonAsync<JsonDocument>();
        var credentials = payload!.RootElement.GetProperty("credentials").EnumerateArray().ToArray();
        return (payload.RootElement.GetProperty("matchId").GetGuid(),
            credentials[0].GetProperty("token").GetString()!,
            credentials[1].GetProperty("token").GetString()!);
    }

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static async Task<HttpResponseMessage> Read(
        HttpClient client, Guid matchId, string? ifNoneMatch = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, $"/api/dev/matches/{matchId}");
        if (ifNoneMatch is not null)
            request.Headers.TryAddWithoutValidation("If-None-Match", ifNoneMatch);
        return await client.SendAsync(request);
    }

    [Fact]
    public async Task AuthorizedConditionalPollIs304OnlyForExactCurrentRevision()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);

        using var initial = await Read(alice, id);
        Assert.Equal(HttpStatusCode.OK, initial.StatusCode);
        Assert.Equal("no-store", initial.Headers.CacheControl?.ToString());
        var etag = initial.Headers.ETag?.ToString();
        Assert.NotNull(etag);
        Assert.Contains("edonism-revision-0", etag, StringComparison.Ordinal);
        var initialJson = await initial.Content.ReadAsStringAsync();
        Assert.DoesNotContain(aliceToken, initialJson);
        Assert.DoesNotContain(bobToken, initialJson);
        Assert.DoesNotContain("cardIds", initialJson);

        using var unchanged = await Read(bob, id, etag);
        Assert.Equal(HttpStatusCode.NotModified, unchanged.StatusCode);
        Assert.Equal("no-store", unchanged.Headers.CacheControl?.ToString());
        Assert.Equal(etag, unchanged.Headers.ETag?.ToString());
        Assert.Empty(await unchanged.Content.ReadAsByteArrayAsync());

        // No token, malformed token and a nonexisting match are indistinguishable,
        // even if the caller knows the exact public revision tag.
        using var unknown = await Read(creator, id, etag);
        Assert.Equal(HttpStatusCode.NotFound, unknown.StatusCode);
        using var forged = Seat(host, new string('0', 64));
        using var forgedRead = await Read(forged, id, etag);
        Assert.Equal(HttpStatusCode.NotFound, forgedRead.StatusCode);

        using var move = await alice.PostAsJsonAsync($"/api/dev/matches/{id}/end-turn",
            new { expectedRevision = 0 });
        Assert.Equal(HttpStatusCode.OK, move.StatusCode);
        using var changed = await Read(bob, id, etag);
        Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
        var newerTag = changed.Headers.ETag?.ToString();
        Assert.NotNull(newerTag);
        Assert.NotEqual(etag, newerTag);
        using var newer = await Read(bob, id, newerTag);
        Assert.Equal(HttpStatusCode.NotModified, newer.StatusCode);
        using var old = await Read(bob, id, "W/\\"edonism-revision-0\\", W/\\"irrelevant\\"");
        Assert.Equal(HttpStatusCode.OK, old.StatusCode);
        using var noMatch = await Read(bob, Guid.NewGuid(), newerTag);
        Assert.Equal(HttpStatusCode.NotFound, noMatch.StatusCode);
    }

    [Fact]
    public async Task TokenRotationDoesNotLeakExistenceThroughConditionalResponse()
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, original, bobToken) = await Create(creator);
        using var old = Seat(host, original);
        using var bob = Seat(host, bobToken);
        using var first = await Read(old, id);
        var etag = first.Headers.ETag!.ToString();

        using var rotate = await old.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotate.StatusCode);
        using var rotated = await rotate.Content.ReadFromJsonAsync<JsonDocument>();
        var freshToken = rotated!.RootElement.GetProperty("token").GetString()!;
        using var revoked = await Read(old, id, etag);
        Assert.Equal(HttpStatusCode.NotFound, revoked.StatusCode);
        using var newSeat = Seat(host, freshToken);
        using var stillUnchanged = await Read(newSeat, id, etag);
        Assert.Equal(HttpStatusCode.NotModified, stillUnchanged.StatusCode);
        using var bobUnchanged = await Read(bob, id, etag);
        Assert.Equal(HttpStatusCode.NotModified, bobUnchanged.StatusCode);
    }

    [Fact]
    public async Task EncryptedRestartPreservesTagAndAuthorization()
    {
        var dir = Path.Combine(Path.GetTempPath(), "edonism-dev-etag-" + Guid.NewGuid().ToString("N"));
        var key = Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
        try
        {
            Guid id;
            string alice;
            string tag;
            using (var oldHost = Host(new DevelopmentMatchStore(
                new DevelopmentMatchCheckpointFiles(dir, key))))
            using (var creator = oldHost.CreateClient())
            {
                (id, alice, _) = await Create(creator);
                using var seat = Seat(oldHost, alice);
                using var response = await Read(seat, id);
                tag = response.Headers.ETag!.ToString();
            }
            using var newHost = Host(new DevelopmentMatchStore(
                new DevelopmentMatchCheckpointFiles(dir, key)));
            using var sameSeat = Seat(newHost, alice);
            using var unchanged = await Read(sameSeat, id, tag);
            Assert.Equal(HttpStatusCode.NotModified, unchanged.StatusCode);
            using var wrong = Seat(newHost, new string('0', 64));
            using var denied = await Read(wrong, id, tag);
            Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);
        }
        finally
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
    }
}
