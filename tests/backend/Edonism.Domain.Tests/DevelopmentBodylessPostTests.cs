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
/// #82: bodyless Development security-sensitive POST endpoints authenticate
/// before inspecting payloads and reject any data before side effects.
/// </summary>
public sealed class DevelopmentBodylessPostTests
{
    private sealed class UnknownLengthContent : HttpContent
    {
        private readonly byte[] _bytes;

        public UnknownLengthContent(byte[] bytes)
        {
            _bytes = bytes;
            Headers.ContentType = new MediaTypeHeaderValue("application/json");
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

    private static async Task<(Guid Id, string Alice, string Bob)> Create(HttpClient creator)
    {
        using var response = await creator.PostAsJsonAsync("/api/dev/matches/", new
        {
            players = new[]
            {
                new { playerId = "alice", startingSlotId = "N-01" },
                new { playerId = "bob", startingSlotId = "S-01" }
            }
        });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(json);
        var seats = json.RootElement.GetProperty("credentials")
            .EnumerateArray().ToArray();
        return (json.RootElement.GetProperty("matchId").GetGuid(),
            seats[0].GetProperty("token").GetString()!,
            seats[1].GetProperty("token").GetString()!);
    }

    private static async Task<HttpResponseMessage> Send(
        HttpClient client, string path, byte[] body, bool unknownLength)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, path);
        if (unknownLength)
        {
            request.Content = new UnknownLengthContent(body);
            Assert.Null(request.Content.Headers.ContentLength);
        }
        else
        {
            request.Content = new ByteArrayContent(body);
            request.Content.Headers.ContentLength = body.Length;
        }
        return await client.SendAsync(request);
    }

    private static void NoStore(HttpResponseMessage response)
    {
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.True(response.Headers.TryGetValues("Pragma", out var pragma));
        Assert.Equal("no-cache", Assert.Single(pragma!));
    }

    private static async Task AssertNotFound(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        NoStore(response);
        using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(json);
        Assert.Equal("match_not_found",
            json.RootElement.GetProperty("code").GetString());
    }

    private static async Task AssertRejected(
        HttpResponseMessage response, params string[] secrets)
    {
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        NoStore(response);
        var raw = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(raw);
        Assert.Equal("dev_bodyless_payload_not_allowed",
            json.RootElement.GetProperty("code").GetString());
        Assert.Single(json.RootElement.EnumerateObject());
        foreach (var secret in secrets)
            Assert.DoesNotContain(secret, raw);
    }

    private static async Task AssertUntouched(
        HttpClient client, Guid id, bool active)
    {
        using var state = await client.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{id}");
        Assert.NotNull(state);
        Assert.Equal(0, state.RootElement.GetProperty("revision").GetInt64());
        Assert.Single(state.RootElement.GetProperty("events").EnumerateArray());

        using var presence = await client.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{id}/presence");
        Assert.NotNull(presence);
        Assert.Equal(active, presence.RootElement.GetProperty("seats")[0]
            .GetProperty("isActive").GetBoolean());
        Assert.False(presence.RootElement.GetProperty("seats")[1]
            .GetProperty("isActive").GetBoolean());
    }

    [Theory]
    [InlineData("presence", false)]
    [InlineData("presence", true)]
    [InlineData("rotate-token", false)]
    [InlineData("rotate-token", true)]
    public async Task UnexpectedBodiesCannotMutateAndAuthorizationRemainsFirst(
        string command, bool unknownLength)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, bobToken) = await Create(creator);
        using var alice = Seat(host, aliceToken);
        using var bob = Seat(host, bobToken);
        using var forged = Seat(host, new string('F', 64));
        var path = $"/api/dev/matches/{id}/{command}";

        foreach (var length in new[] { 1, 64 * 1024 })
        {
            var payload = Encoding.UTF8.GetBytes(
                new string('x', length));
            using (var missing = await Send(creator, path, payload, unknownLength))
                await AssertNotFound(missing);
            using (var fake = await Send(forged, path, payload, unknownLength))
                await AssertNotFound(fake);
            using (var denied = await Send(alice, path, payload, unknownLength))
                await AssertRejected(denied, aliceToken, bobToken);
            await AssertUntouched(bob, id, active: false);
        }

        // Zero bytes, even in an unknown-length transport, are legitimate.
        using var accepted = await Send(alice, path, [], unknownLength);
        Assert.Equal(HttpStatusCode.OK, accepted.StatusCode);
        NoStore(accepted);
        if (command == "presence")
        {
            using var data = await accepted.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(data);
            Assert.True(data.RootElement.GetProperty("seats")[0]
                .GetProperty("isActive").GetBoolean());
            await AssertUntouched(bob, id, active: true);
        }
        else
        {
            using var credential = await accepted.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(credential);
            Assert.Equal("alice", credential.RootElement.GetProperty("playerId")
                .GetString());
            var newToken = credential.RootElement.GetProperty("token").GetString()!;
            Assert.NotEqual(aliceToken, newToken);
            using (var revoked = await Send(alice, path, [42], unknownLength))
                await AssertNotFound(revoked);
            using var replacement = Seat(host, newToken);
            await AssertUntouched(bob, id, active: false);
            using var another = await Send(replacement, path, [], unknownLength);
            Assert.Equal(HttpStatusCode.OK, another.StatusCode);
            NoStore(another);
        }
    }

    [Theory]
    [InlineData("presence")]
    [InlineData("rotate-token")]
    public async Task BodylessGuardUsesOnlyExactPostRoutes(string command)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var (id, aliceToken, _) = await Create(creator);
        using var alice = Seat(host, aliceToken);

        // Exact route matches case-insensitively and ignores query strings.
        using var upper = await Send(alice,
            $"/API/DEV/MATCHES/{id}/{command.ToUpperInvariant()}?x=1",
            [42], unknownLength: false);
        await AssertRejected(upper, aliceToken);

        // Trailing extra segment and a GET to the wrong method never trigger
        // bodyless POST validation (endpoint routing independently returns 404).
        using var extension = await Send(alice,
            $"/api/dev/matches/{id}/{command}/extra", [42],
            unknownLength: false);
        Assert.Equal(HttpStatusCode.NotFound, extension.StatusCode);
        NoStore(extension);

        using var state = await alice.GetFromJsonAsync<JsonDocument>(
            $"/api/dev/matches/{id}");
        Assert.NotNull(state);
        Assert.Equal(0, state.RootElement.GetProperty("revision").GetInt64());
    }
}
