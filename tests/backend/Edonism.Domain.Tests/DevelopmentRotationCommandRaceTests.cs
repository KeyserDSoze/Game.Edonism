using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Infrastructure.World;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #79: HTTP rotation and command submission share one Development match lock.
/// A command bearing the old capability either linearizes before revocation
/// or is denied; the new bearer must remain usable in either ordering.
/// </summary>
public sealed class DevelopmentRotationCommandRaceTests
{
    private sealed record Seat(string PlayerId, string Token);

    private static WebApplicationFactory<Program> Host() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment("Development"));

    private static HttpClient AsSeat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static async Task<(Guid Id, Seat[] Seats)> Create(
        HttpClient creator, int count)
    {
        var players = BoardCatalog.LoadDefault().Slots.Take(count)
            .Select((slot, i) => new
            {
                playerId = $"seat-{i}",
                startingSlotId = slot.Id
            }).ToArray();
        using var response = await creator.PostAsJsonAsync(
            "/api/dev/matches/", new { players });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var body = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(body);
        var credentials = body.RootElement.GetProperty("credentials")
            .EnumerateArray().Select(x => new Seat(
                x.GetProperty("playerId").GetString()!,
                x.GetProperty("token").GetString()!)).ToArray();
        Assert.Equal(count, credentials.Length);
        Assert.Equal(count, credentials.Select(x => x.Token).Distinct().Count());
        return (body.RootElement.GetProperty("matchId").GetGuid(), credentials);
    }

    private static async Task<HttpResponseMessage> Command(
        HttpClient client, Guid id, string kind, string? destination, string key)
    {
        using var request = new HttpRequestMessage(
            HttpMethod.Post, $"/api/dev/matches/{id}/{kind}")
        {
            Content = JsonContent.Create(kind == "end-turn"
                ? (object)new { expectedRevision = 0 }
                : new { expectedRevision = 0, destinationStreetId = destination })
        };
        request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return await client.SendAsync(request);
    }

    private static void NoStore(HttpResponseMessage response) =>
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());

    [Theory]
    [InlineData(2, "free-move")]
    [InlineData(2, "end-turn")]
    [InlineData(3, "free-move")]
    [InlineData(3, "end-turn")]
    [InlineData(4, "free-move")]
    [InlineData(4, "end-turn")]
    [InlineData(5, "free-move")]
    [InlineData(5, "end-turn")]
    [InlineData(6, "free-move")]
    [InlineData(6, "end-turn")]
    [InlineData(7, "free-move")]
    [InlineData(7, "end-turn")]
    [InlineData(8, "free-move")]
    [InlineData(8, "end-turn")]
    public async Task RotationAndOldBearerCommandAreLinearizable(int count, string kind)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, seats) = await Create(creator, count);
        using var old = AsSeat(host, seats[0].Token);
        using var opponent = AsSeat(host, seats[1].Token);
        var origin = BoardCatalog.LoadDefault().Slots[0].StreetId;
        var destination = BoardCatalog.LoadDefault().Streets
            .Single(s => s.Id == origin).Neighbors[0];
        var key = Guid.NewGuid().ToString("D");
        var release = new TaskCompletionSource(
            TaskCreationOptions.RunContinuationsAsynchronously);

        var commandTask = Task.Run(async () =>
        {
            await release.Task;
            return await Command(old, id, kind, destination, key);
        });
        var rotationTask = Task.Run(async () =>
        {
            await release.Task;
            return await old.PostAsync($"/api/dev/matches/{id}/rotate-token", null);
        });
        release.SetResult();

        using var command = await commandTask;
        using var rotation = await rotationTask;
        Assert.Equal(HttpStatusCode.OK, rotation.StatusCode);
        NoStore(rotation);
        NoStore(command);
        Assert.Contains(command.StatusCode,
            new[] { HttpStatusCode.OK, HttpStatusCode.NotFound });
        using var credential = await rotation.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(credential);
        Assert.Equal(seats[0].PlayerId,
            credential.RootElement.GetProperty("playerId").GetString());
        var newToken = credential.RootElement.GetProperty("token").GetString()!;
        Assert.NotEqual(seats[0].Token, newToken);
        Assert.DoesNotContain(seats.Select(x => x.Token), x => x == newToken);
        using var fresh = AsSeat(host, newToken);

        // Both outcomes are permitted by scheduling, but a revoked bearer
        // must NEVER read, replay an accepted UUID or execute again.
        using var revokedRead = await old.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.NotFound, revokedRead.StatusCode);
        NoStore(revokedRead);
        using var revokedReplay = await Command(old, id, kind, destination, key);
        Assert.Equal(HttpStatusCode.NotFound, revokedReplay.StatusCode);
        NoStore(revokedReplay);

        var firstAccepted = command.StatusCode == HttpStatusCode.OK;
        if (!firstAccepted)
        {
            using var rejected = await command.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(rejected);
            Assert.Equal("match_not_found",
                rejected.RootElement.GetProperty("code").GetString());
        }

        using var afterRace = await fresh.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{id}");
        Assert.NotNull(afterRace);
        Assert.Equal(firstAccepted ? 1 : 0,
            afterRace.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(firstAccepted ? 2 : 1,
            afterRace.RootElement.GetProperty("events").GetArrayLength());

        // If preflight raced with rotation, the store must deny the command.
        // The same UUID is still unspent and succeeds under the new bearer.
        // If execution preceded rotation, this is an idempotent replay.
        using var retried = await Command(fresh, id, kind, destination, key);
        Assert.Equal(HttpStatusCode.OK, retried.StatusCode);
        NoStore(retried);
        using var current = await fresh.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{id}");
        Assert.NotNull(current);
        var state = current.RootElement;
        Assert.Equal(1, state.GetProperty("revision").GetInt64());
        Assert.Equal(2, state.GetProperty("events").GetArrayLength());
        var last = state.GetProperty("events").EnumerateArray().Last();
        Assert.Equal(seats[0].PlayerId, last.GetProperty("actorId").GetString());
        if (kind == "free-move")
        {
            Assert.Equal("free-move", last.GetProperty("kind").GetString());
            Assert.Equal(origin, last.GetProperty("fromStreetId").GetString());
            Assert.Equal(destination, last.GetProperty("toStreetId").GetString());
            Assert.Equal(seats[0].PlayerId,
                state.GetProperty("activePlayerId").GetString());
            var actor = state.GetProperty("players")[0];
            Assert.Equal(destination, actor.GetProperty("streetId").GetString());
            Assert.True(actor.GetProperty("freeMoveUsed").GetBoolean());
        }
        else
        {
            Assert.Equal("turn-ended", last.GetProperty("kind").GetString());
            Assert.Equal(seats[1].PlayerId,
                state.GetProperty("activePlayerId").GetString());
            Assert.Equal(origin, state.GetProperty("players")[0]
                .GetProperty("streetId").GetString());
        }
        Assert.All(state.GetProperty("players").EnumerateArray(), player =>
        {
            Assert.Equal(4, player.GetProperty("atoms").GetInt32());
            Assert.Equal(2, player.GetProperty("diplomacyTokens").GetInt32());
            Assert.Equal(15, player.GetProperty("henchmenAvailable").GetInt32());
        });

        // Unrelated seats never inherit the new capability or its receipt.
        var snapshots = await Task.WhenAll(seats.Skip(1).Select(async seat =>
        {
            using var peer = AsSeat(host, seat.Token);
            using var response = await peer.GetAsync($"/api/dev/matches/{id}");
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            NoStore(response);
            return await response.Content.ReadAsStringAsync();
        }));
        using var freshResponse = await fresh.GetAsync($"/api/dev/matches/{id}");
        var snapshot = await freshResponse.Content.ReadAsStringAsync();
        Assert.All(snapshots, peer => Assert.Equal(snapshot, peer));
        foreach (var secret in seats.Select(x => x.Token).Append(newToken).Append(key))
            Assert.DoesNotContain(secret, snapshot);

        using var auditResponse = await opponent.GetAsync($"/api/dev/matches/{id}/audit");
        Assert.Equal(HttpStatusCode.OK, auditResponse.StatusCode);
        NoStore(auditResponse);
        using var audit = await auditResponse.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(audit);
        Assert.True(audit.RootElement.GetProperty("isValid").GetBoolean());
        Assert.Equal(1, audit.RootElement.GetProperty("verifiedRevision").GetInt64());

        // Repeating the same UUID with the fresh token is pure replay.
        using var repeat = await Command(fresh, id, kind, destination, key);
        Assert.Equal(HttpStatusCode.OK, repeat.StatusCode);
        using var unchanged = await fresh.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{id}");
        Assert.Equal(1, unchanged!.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(2, unchanged.RootElement.GetProperty("events").GetArrayLength());
    }
}
