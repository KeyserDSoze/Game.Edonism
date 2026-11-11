using System.Net;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Edonism.Api.Development;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class DevelopmentMatchCreationAdmissionTests
{
    private sealed class TestClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } =
            new(2026, 11, 11, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private static WebApplicationFactory<Program> Host(string name = "Development") =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(name));

    private static void AssertPrivate(HttpResponseMessage response, HttpStatusCode status)
    {
        Assert.Equal(status, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        Assert.True(response.Headers.TryGetValues("Pragma", out var pragma));
        Assert.Equal("no-cache", Assert.Single(pragma!));
        var hasExpires = response.Headers.TryGetValues("Expires", out var expires)
            || response.Content.Headers.TryGetValues("Expires", out expires);
        Assert.True(hasExpires);
        Assert.Equal("0", Assert.Single(expires!));
    }

    [Fact]
    public void FixedWindowQuotaRejectsExactSixtyFifthAndResetsAfterTimeOrClockRollback()
    {
        var clock = new TestClock();
        var admission = new DevelopmentMatchCreationAdmission(clock);
        var results = new bool[128];
        Parallel.For(0, results.Length, i =>
        {
            results[i] = admission.TryAdmit(out _);
        });
        Assert.Equal(DevelopmentMatchCreationAdmission.MaxAttemptsPerWindow,
            results.Count(accepted => accepted));
        Assert.False(admission.TryAdmit(out var after));
        Assert.Equal(60, after);

        clock.Now = clock.Now.AddSeconds(59);
        Assert.False(admission.TryAdmit(out after));
        Assert.Equal(1, after);
        clock.Now = clock.Now.AddSeconds(1);
        Assert.True(admission.TryAdmit(out after));
        Assert.Equal(0, after);
        clock.Now = clock.Now.AddMinutes(-3);
        Assert.True(admission.TryAdmit(out after));
        Assert.Equal(0, after);
    }

    [Theory]
    [InlineData("POST", "/api/dev/matches", true)]
    [InlineData("POST", "/api/dev/matches/", true)]
    [InlineData("POST", "/api/dev/matches/from-cards", true)]
    [InlineData("POST", "/api/dev/matches/from-characters", true)]
    [InlineData("POST", "/api/dev/matches/from-full-deck", true)]
    [InlineData("POST", "/API/DEV/MATCHES/FROM-CARDS", true)]
    [InlineData("GET", "/api/dev/matches/from-full-deck", false)]
    [InlineData("POST", "/api/dev/matches/from-cards/extra", false)]
    [InlineData("POST", "/api/dev/matches/from-full-deck-other", false)]
    [InlineData("POST", "/api/dev/matches/00000000-0000-0000-0000-000000000020/end-turn", false)]
    [InlineData("POST", "/api/dev/matches/00000000-0000-0000-0000-000000000020/presence", false)]
    [InlineData("POST", "/api/v1/meta", false)]
    public void OnlyExactCreatorPostRoutesAreAdmitted(string method, string path, bool expected)
    {
        var context = new DefaultHttpContext();
        context.Request.Method = method;
        context.Request.Path = path;
        Assert.Equal(expected, DevelopmentMatchCreationAdmission.IsCreator(context.Request));
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(131072, true)]
    [InlineData(131073, false)]
    [InlineData(524288, false)]
    public async Task BoundedReaderNeverConsumesMoreThanLimitPlusOne(int bytes, bool accepted)
    {
        using var source = new MemoryStream(new byte[bytes]);
        using var bounded = new MemoryStream();
        var context = new DefaultHttpContext();
        context.Request.Body = source;
        var result = await DevelopmentMatchCreationAdmission.TryBufferBodyAsync(
            context, bounded);
        Assert.Equal(accepted, result);
        Assert.Equal(Math.Min(bytes, DevelopmentMatchCreationAdmission.MaxJsonBytes + 1),
            source.Position);
        Assert.InRange(bounded.Length, 0, DevelopmentMatchCreationAdmission.MaxJsonBytes);
        if (accepted)
        {
            Assert.Equal(bytes, bounded.Length);
            Assert.Equal(0, bounded.Position);
        }
    }

    [Theory]
    [InlineData("/api/dev/matches/")]
    [InlineData("/api/dev/matches/from-cards")]
    [InlineData("/api/dev/matches/from-characters")]
    [InlineData("/api/dev/matches/from-full-deck")]
    public async Task OversizeBodiesAreRejectedBeforeBindingOrCreatingAnySeat(string path)
    {
        using var host = Host();
        using var client = host.CreateClient();
        using var oversize = new StringContent(
            new string('X', (int)DevelopmentMatchCreationAdmission.MaxJsonBytes + 1),
            Encoding.UTF8, "application/json");
        using var rejected = await client.PostAsync(path, oversize);
        AssertPrivate(rejected, HttpStatusCode.RequestEntityTooLarge);
        using var doc = await rejected.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("dev_create_payload_too_large",
            doc!.RootElement.GetProperty("code").GetString());
        Assert.False(doc.RootElement.TryGetProperty("credentials", out _));
        Assert.False(doc.RootElement.TryGetProperty("state", out _));

        // Next small, valid body goes through the original creator endpoint.
        using var normal = await client.PostAsJsonAsync("/api/dev/matches/", new
        {
            players = new[]
            {
                new { playerId = "alice", startingSlotId = "N-01" },
                new { playerId = "bob", startingSlotId = "S-01" }
            }
        });
        AssertPrivate(normal, HttpStatusCode.Created);
        using var created = await normal.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal(2, created!.RootElement.GetProperty("credentials").GetArrayLength());
    }

    [Fact]
    public async Task UnknownContentLengthIsAlsoCappedWithoutReadingUnboundedStreams()
    {
        using var host = Host();
        using var client = host.CreateClient();
        using var request = new HttpRequestMessage(HttpMethod.Post,
            "/api/dev/matches/from-full-deck")
        {
            Content = new StreamContent(new MemoryStream(
                new byte[DevelopmentMatchCreationAdmission.MaxJsonBytes + 25]))
        };
        request.Headers.TransferEncodingChunked = true;
        request.Content.Headers.ContentType =
            new System.Net.Http.Headers.MediaTypeHeaderValue("application/json");
        using var response = await client.SendAsync(request);
        AssertPrivate(response, HttpStatusCode.RequestEntityTooLarge);
        using var doc = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("dev_create_payload_too_large",
            doc!.RootElement.GetProperty("code").GetString());
    }

    [Fact]
    public async Task AllFourValidCreatorFixturesRemainAvailableAndPrivate()
    {
        using var host = Host();
        using var client = host.CreateClient();
        var routes = new (string Path, object Payload)[]
        {
            ("/api/dev/matches/", new
            {
                players = new[]
                {
                    new { playerId = "alice", startingSlotId = "N-01" },
                    new { playerId = "bob", startingSlotId = "S-01" }
                }
            }),
            ("/api/dev/matches/from-cards", new
            {
                players = new[]
                {
                    new { playerId = "alice", startingCardId = "sport:01" },
                    new { playerId = "bob", startingCardId = "public-financing:01" }
                },
                availableActivities = ActivitySetupFixture.Catalog(),
                seed = 2026
            }),
            ("/api/dev/matches/from-characters", new
            {
                playerIds = new[] { "alice", "bob" },
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                seed = 2026
            }),
            ("/api/dev/matches/from-full-deck", new
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
            using var response = await client.PostAsJsonAsync(path, payload);
            AssertPrivate(response, HttpStatusCode.Created);
            using var json = await response.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.Equal(2, json!.RootElement.GetProperty("credentials").GetArrayLength());
            var id = json.RootElement.GetProperty("matchId").GetGuid();
            var alice = json.RootElement.GetProperty("credentials")[0]
                .GetProperty("token").GetString()!;
            using var seat = host.CreateClient();
            seat.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", alice);
            using var read = await seat.GetAsync($"/api/dev/matches/{id}");
            AssertPrivate(read, HttpStatusCode.OK);
        }
    }

    [Fact]
    public async Task SixtyFifthAttemptReturns429WithRetryAfterWithoutAffectingOtherRoutes()
    {
        using var host = Host();
        using var client = host.CreateClient();
        // Each valid JSON body is intentionally an invalid single-seat setup;
        // rejected requests also count to protect the unauthenticated binder.
        for (var i = 0; i < DevelopmentMatchCreationAdmission.MaxAttemptsPerWindow; i++)
        {
            using var rejected = await client.PostAsJsonAsync("/api/dev/matches/", new
            {
                players = new[] { new { playerId = "alice", startingSlotId = "N-01" } }
            });
            AssertPrivate(rejected, HttpStatusCode.BadRequest);
        }
        using var denied = await client.PostAsJsonAsync(
            "/api/dev/matches/from-characters", new { playerIds = new[] { "alice" } });
        AssertPrivate(denied, HttpStatusCode.TooManyRequests);
        Assert.True(denied.Headers.TryGetValues("Retry-After", out var values));
        Assert.InRange(int.Parse(Assert.Single(values!)), 1, 60);
        using var json = await denied.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.Equal("dev_create_rate_limited", json!.RootElement.GetProperty("code").GetString());
        Assert.False(json.RootElement.TryGetProperty("credentials", out _));
        using var stillAvailable = await client.GetAsync("/api/v1/meta");
        Assert.Equal(HttpStatusCode.OK, stillAvailable.StatusCode);
        using var unregistered = await client.PostAsync(
            "/api/dev/matches/unrecognized-route", null);
        // ASP.NET may return 404 or 405 for an unmatched path: neither
        // is the creator admission 429 response.
        Assert.NotEqual(HttpStatusCode.TooManyRequests, unregistered.StatusCode);
    }

    [Fact]
    public async Task ProductionNeverExposesAnyCreatorOrRateLimit()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var rejected = await client.PostAsync(
            "/api/dev/matches/from-full-deck", new StringContent(
                new string('x', (int)DevelopmentMatchCreationAdmission.MaxJsonBytes + 1)));
        Assert.Equal(HttpStatusCode.NotFound, rejected.StatusCode);
        using var info = await client.GetAsync("/api/v1/meta");
        Assert.Equal(HttpStatusCode.OK, info.StatusCode);
    }
}
