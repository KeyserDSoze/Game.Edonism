using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Edonism.Domain.Matches;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #164: only an authenticated Development seat may learn the POSITION
/// of a typed Election Day card in THEIR OWN four-card hand, not its
/// physical ID in a deck or another hand, and never an election command.
/// </summary>
public sealed class DevelopmentOwnElectionDayEndpointTests
{
    private static WebApplicationFactory<Program> Host(string environment = "Development") =>
        new WebApplicationFactory<Program>()
            .WithWebHostBuilder(builder => builder.UseEnvironment(environment));

    private static HttpClient Actor(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task AuthenticatedStatusAgreesOnlyWithOwnFourCardsAcrossAllSeats(
        int seats)
    {
        using var host = Host();
        using var creator = host.CreateClient();
        var playerIds = Enumerable.Range(0, seats)
            .Select(i => $"player-{i}").ToArray();
        const int seed = 2026;
        using var reply = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds,
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed
            });
        Assert.Equal(HttpStatusCode.Created, reply.StatusCode);
        using var created = await reply.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var id = created.RootElement.GetProperty("matchId").GetGuid();
        var tokens = created.RootElement.GetProperty("credentials").EnumerateArray()
            .Select(row => row.GetProperty("token").GetString()!).ToArray();
        var originalState = created.RootElement.GetProperty("state").GetRawText();
        var deal = InitialActionDeckComposer.Deal(
            ActionDeckFixture.ActionIds(), ActionDeckFixture.ElectionDayId,
            playerIds, seed);
        var path = $"/api/dev/matches/{id}/hand/election-day";
        using (var noToken = await creator.GetAsync(path))
        {
            Assert.Equal(HttpStatusCode.NotFound, noToken.StatusCode);
            Assert.Equal("no-store", noToken.Headers.CacheControl?.ToString());
        }
        using (var invalid = Actor(host, new string('0', 64)))
        using (var denied = await invalid.GetAsync(path))
            Assert.Equal(HttpStatusCode.NotFound, denied.StatusCode);

        for (var index = 0; index < seats; index++)
        {
            using var actor = Actor(host, tokens[index]);
            using var inspected = await actor.GetAsync(path);
            Assert.Equal(HttpStatusCode.OK, inspected.StatusCode);
            Assert.Equal("no-store", inspected.Headers.CacheControl?.ToString());
            using var body = await inspected.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(body);
            var status = body.RootElement;
            Assert.Equal(id, status.GetProperty("matchId").GetGuid());
            Assert.Equal(playerIds[index], status.GetProperty("playerId").GetString());
            Assert.Equal(0, status.GetProperty("verifiedRevision").GetInt64());
            Assert.True(status.GetProperty("classificationAvailable").GetBoolean());

            using var handReply = await actor.GetAsync(
                $"/api/dev/matches/{id}/hand?playerId={playerIds[(index + 1) % seats]}");
            Assert.Equal(HttpStatusCode.OK, handReply.StatusCode);
            using var hand = await handReply.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(hand);
            var handCards = hand.RootElement.GetProperty("cardIds")
                .EnumerateArray().Select(card => card.GetString()!).ToArray();
            Assert.Equal(4, handCards.Length);
            Assert.Equal(deal.Hands[index].CardIds, handCards);
            var expected = Array.IndexOf(handCards, ActionDeckFixture.ElectionDayId);
            if (expected < 0)
                Assert.Equal(JsonValueKind.Null, status.GetProperty("ownHandIndex").ValueKind);
            else
                Assert.Equal(expected, status.GetProperty("ownHandIndex").GetInt32());

            var wire = await inspected.Content.ReadAsStringAsync();
            Assert.DoesNotContain("electionDayCardId", wire,
                StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain(ActionDeckFixture.ElectionDayId, wire);
            Assert.DoesNotContain("cardIds", wire, StringComparison.OrdinalIgnoreCase);
            Assert.DoesNotContain("drawPile", wire, StringComparison.OrdinalIgnoreCase);
            foreach (var token in tokens) Assert.DoesNotContain(token, wire);
        }

        using (var owner = Actor(host, tokens[0]))
        {
            using var changed = await owner.PostAsync(
                $"/api/dev/matches/{id}/rotate-token", null);
            Assert.Equal(HttpStatusCode.OK, changed.StatusCode);
            using var tokenBody = await changed.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(tokenBody);
            var newToken = tokenBody.RootElement.GetProperty("token").GetString()!;
            using (var revoked = await owner.GetAsync(path))
                Assert.Equal(HttpStatusCode.NotFound, revoked.StatusCode);
            using (var replacement = Actor(host, newToken))
            using (var allowed = await replacement.GetAsync(path))
            {
                Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
                using var status = await allowed.Content.ReadFromJsonAsync<JsonDocument>();
                Assert.NotNull(status);
                Assert.Equal(0, status.RootElement.GetProperty("verifiedRevision").GetInt64());
            }
        }
        using var publicAfter = Actor(host, tokens[1]);
        using var publicReply = await publicAfter.GetAsync($"/api/dev/matches/{id}");
        Assert.Equal(HttpStatusCode.OK, publicReply.StatusCode);
        using var after = await publicReply.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(after);
        Assert.Equal(originalState, after.RootElement.GetRawText());
    }

    [Fact]
    public async Task ProductionHasNoPrivateElectionDayInspectionRoute()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.GetAsync(
            $"/api/dev/matches/{Guid.NewGuid()}/hand/election-day");
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
