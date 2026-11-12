using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #78: authenticated Development command bodies are bounded before Minimal
/// API model binding, while bearer authorization remains the first signal.
/// </summary>
public sealed class DevelopmentCommandBodyLimitTests
{
    private const string Root = "/api/dev/matches";
    private const int MaxCommandBytes = 4 * 1024;

    private sealed class UnknownLengthJsonContent : HttpContent
    {
        private readonly byte[] _bytes;

        public UnknownLengthJsonContent(string json)
        {
            _bytes = Encoding.UTF8.GetBytes(json);
            Headers.ContentType = new MediaTypeHeaderValue("application/json")
            {
                CharSet = "utf-8"
            };
        }

        protected override async Task SerializeToStreamAsync(
            Stream stream, TransportContext? context)
        {
            await stream.WriteAsync(_bytes);
        }

        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return false;
        }
    }

    private static WebApplicationFactory<Program> Host() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment("Development"));

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    private static async Task<(Guid MatchId, string Alice, string Bob)> Create(
        HttpClient creator)
    {
        using var response = await creator.PostAsJsonAsync(Root + "/", new
        {
            players = new[]
            {
                new { playerId = "alice", startingSlotId = "N-01" },
                new { playerId = "bob", startingSlotId = "S-01" }
            }
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var document = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(document);
        var root = document.RootElement;
        var credentials = root.GetProperty("credentials").EnumerateArray().ToArray();
        return (root.GetProperty("matchId").GetGuid(),
            credentials.Single(x => x.GetProperty("playerId").GetString() == "alice")
                .GetProperty("token").GetString()!,
            credentials.Single(x => x.GetProperty("playerId").GetString() == "bob")
                .GetProperty("token").GetString()!);
    }

    private static string PadToBytes(string json, int byteCount)
    {
        var current = Encoding.UTF8.GetByteCount(json);
        Assert.True(current <= byteCount);
        var padded = json + new string(' ', byteCount - current);
        Assert.Equal(byteCount, Encoding.UTF8.GetByteCount(padded));
        return padded;
    }

    private static async Task<string> ValidPayload(
        HttpClient actor, Guid id, string kind)
    {
        if (kind == "end-turn")
            return "{\"expectedRevision\":0}";

        using var options = await actor.GetFromJsonAsync<JsonDocument>(
            $"{Root}/{id}/turn-options");
        Assert.NotNull(options);
        var destination = options.RootElement.GetProperty("freeMoveStreetIds")[0]
            .GetString()!;
        return JsonSerializer.Serialize(new
        {
            expectedRevision = 0,
            destinationStreetId = destination
        });
    }

    private static async Task<HttpResponseMessage> Send(
        HttpClient client, string path, string json, string key, bool unknownLength)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        if (unknownLength)
        {
            request.Content = new UnknownLengthJsonContent(json);
            Assert.Null(request.Content.Headers.ContentLength);
        }
        else
        {
            request.Content = new StringContent(
                json, Encoding.UTF8, "application/json");
            request.Content.Headers.ContentLength =
                Encoding.UTF8.GetByteCount(json);
            Assert.Equal((long)Encoding.UTF8.GetByteCount(json),
                request.Content.Headers.ContentLength);
        }
        request.Headers.TryAddWithoutValidation("Idempotency-Key", key);
        return await client.SendAsync(request);
    }

    private static void AssertNoStore(HttpResponseMessage response)
    {
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.True(response.Headers.TryGetValues("Pragma", out var pragma));
        Assert.Equal("no-cache", Assert.Single(pragma!));
    }

    private static async Task AssertNotFound(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        AssertNoStore(response);
        using var body = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("match_not_found",
            body!.RootElement.GetProperty("code").GetString());
    }

    private static async Task AssertTooLarge(
        HttpResponseMessage response, params string[] secrets)
    {
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        AssertNoStore(response);
        var raw = await response.Content.ReadAsStringAsync();
        using var body = JsonDocument.Parse(raw);
        Assert.Equal("dev_command_payload_too_large",
            body.RootElement.GetProperty("code").GetString());
        Assert.Single(body.RootElement.EnumerateObject());
        foreach (var secret in secrets)
            Assert.DoesNotContain(secret, raw);
    }

    private static async Task AssertUnchanged(
        HttpClient reader, Guid id)
    {
        using var state = await reader.GetFromJsonAsync<JsonDocument>($"{Root}/{id}");
        Assert.NotNull(state);
        Assert.Equal(0, state.RootElement.GetProperty("revision").GetInt64());
        Assert.Single(state.RootElement.GetProperty("events").EnumerateArray());

        using var presence = await reader.GetFromJsonAsync<JsonDocument>(
            $"{Root}/{id}/presence");
        Assert.NotNull(presence);
        Assert.All(presence.RootElement.GetProperty("seats").EnumerateArray(),
            seat => Assert.False(seat.GetProperty("isActive").GetBoolean()));
    }

    [Theory]
    [InlineData("end-turn")]
    [InlineData("free-move")]
    public async Task KnownLengthLimitKeepsAuthorizationFirstAndDoesNotConsumeReceipt(
        string kind)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        using var forged = Seat(host, new string('F', 64));
        var path = $"{Root}/{id}/{kind}";
        var valid = await ValidPayload(alice, id, kind);
        var oversized = PadToBytes(valid, MaxCommandBytes + 1);
        var exactLimit = PadToBytes(valid, MaxCommandBytes);
        var key = Guid.NewGuid().ToString("D");

        // Missing/forged bearers are denied before even the known length is
        // classified as too large.
        using (var missing = await Send(
            creator, path, oversized, key, unknownLength: false))
            await AssertNotFound(missing);
        using (var invalid = await Send(
            forged, path, oversized, key, unknownLength: false))
            await AssertNotFound(invalid);

        // Rotation revokes the old bearer without changing the game revision.
        using var rotation = await alice.PostAsync($"{Root}/{id}/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotation.StatusCode);
        using var rotationBody =
            await rotation.Content.ReadFromJsonAsync<JsonDocument>();
        using var current = Seat(host,
            rotationBody!.RootElement.GetProperty("token").GetString()!);
        using (var revoked = await Send(
            alice, path, oversized, key, unknownLength: false))
            await AssertNotFound(revoked);

        using (var tooLarge = await Send(
            current, path, oversized, key, unknownLength: false))
            await AssertTooLarge(tooLarge, aliceToken, bobToken, key);
        await AssertUnchanged(bob, id);

        // Exactly 4 KiB is allowed and the same UUID still works, proving the
        // 413 did not create an idempotency receipt.
        using var accepted = await Send(
            current, path, exactLimit, key, unknownLength: false);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        AssertNoStore(accepted);
        using var after = await bob.GetFromJsonAsync<JsonDocument>($"{Root}/{id}");
        Assert.Equal(1, after!.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(2, after.RootElement.GetProperty("events").GetArrayLength());
    }

    [Theory]
    [InlineData("end-turn")]
    [InlineData("free-move")]
    public async Task UnknownLengthBodyReadsAtMostLimitPlusOneAndReplaysValidJson(
        string kind)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        var path = $"{Root}/{id}/{kind}";
        var valid = await ValidPayload(alice, id, kind);
        var oversized = PadToBytes(valid, MaxCommandBytes + 1);
        var exactLimit = PadToBytes(valid, MaxCommandBytes);
        var key = Guid.NewGuid().ToString("D");

        using (var tooLarge = await Send(
            alice, path, oversized, key, unknownLength: true))
            await AssertTooLarge(tooLarge, aliceToken, bobToken, key);
        await AssertUnchanged(bob, id);

        // The bounded replay stream is rewound to zero for the real binder.
        using var accepted = await Send(
            alice, path, exactLimit, key, unknownLength: true);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        AssertNoStore(accepted);
        using var after = await bob.GetFromJsonAsync<JsonDocument>($"{Root}/{id}");
        Assert.Equal(1, after!.RootElement.GetProperty("revision").GetInt64());
        Assert.Equal(2, after.RootElement.GetProperty("events").GetArrayLength());
    }
}
