using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #166: never publish or accept a private-hand DTO with additional
/// capability, opponent-hand or draw-pile fields. Transport source is .NET;
/// the React guard independently rejects forged, over-wide HTTP 200 replies.
/// </summary>
public sealed class DevelopmentPrivateHandWireContractTests
{
    private static WebApplicationFactory<Program> Host(string environment) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static readonly string[] ExpectedKeys =
        ["cardIds", "matchId", "playerId"];

    private static void AssertExactOwnHand(JsonElement payload,
        Guid matchId, string playerId, string[] cards)
    {
        Assert.Equal(JsonValueKind.Object, payload.ValueKind);
        Assert.Equal(ExpectedKeys, payload.EnumerateObject()
            .Select(property => property.Name)
            .OrderBy(name => name, StringComparer.Ordinal));
        Assert.Equal(matchId, payload.GetProperty("matchId").GetGuid());
        Assert.Equal(playerId, payload.GetProperty("playerId").GetString());
        var ids = payload.GetProperty("cardIds")
            .EnumerateArray().Select(card => card.GetString()!).ToArray();
        Assert.Equal(4, ids.Length);
        Assert.Equal(ids.Length, ids.Distinct(StringComparer.Ordinal).Count());
        Assert.Equal(cards, ids);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task RealAuthenticatedHandAndAtomicSeatEmitOnlyThreeOwnFields(int seatCount)
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var players = Enumerable.Range(0, seatCount)
            .Select(index => "player-" + index).ToArray();
        using var createdResponse = await creator.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = players,
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
        var tokens = created.RootElement.GetProperty("credentials").EnumerateArray()
            .Select(row => row.GetProperty("token").GetString()!).ToArray();
        Assert.Equal(seatCount, tokens.Length);

        var allCards = new HashSet<string>(StringComparer.Ordinal);
        using var anonymous = await creator.GetAsync(
            $"/api/dev/matches/{matchId}/hand");
        Assert.Equal(HttpStatusCode.NotFound, anonymous.StatusCode);

        for (var i = 0; i < seatCount; i++)
        {
            using var seat = host.CreateClient();
            seat.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", tokens[i]);
            // The fake actor query must NOT override bearer-bound seat identity.
            using var handResponse = await seat.GetAsync(
                $"/api/dev/matches/{matchId}/hand?playerId={players[(i + 1) % seatCount]}");
            using var atomicResponse = await seat.GetAsync(
                $"/api/dev/matches/{matchId}/seat");
            Assert.Equal(HttpStatusCode.OK, handResponse.StatusCode);
            Assert.Equal(HttpStatusCode.OK, atomicResponse.StatusCode);
            Assert.Equal("no-store", handResponse.Headers.CacheControl?.ToString());
            Assert.Equal("no-store", atomicResponse.Headers.CacheControl?.ToString());
            using var hand = await handResponse.Content.ReadFromJsonAsync<JsonDocument>();
            using var atomic = await atomicResponse.Content.ReadFromJsonAsync<JsonDocument>();
            Assert.NotNull(hand);
            Assert.NotNull(atomic);
            var cards = hand.RootElement.GetProperty("cardIds")
                .EnumerateArray().Select(card => card.GetString()!).ToArray();
            AssertExactOwnHand(hand.RootElement, matchId, players[i], cards);
            AssertExactOwnHand(atomic.RootElement.GetProperty("hand"),
                matchId, players[i], cards);
            foreach (var card in cards)
                Assert.True(allCards.Add(card), "Two seats received the same card.");

            var handWire = await handResponse.Content.ReadAsStringAsync();
            var atomicWire = await atomicResponse.Content.ReadAsStringAsync();
            foreach (var wire in new[] { handWire, atomicWire })
            {
                Assert.DoesNotContain("remainingDrawPile", wire,
                    StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("electionDayCardId", wire,
                    StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("otherPlayerCardIds", wire,
                    StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("tokenDigests", wire,
                    StringComparison.OrdinalIgnoreCase);
                foreach (var token in tokens)
                    Assert.DoesNotContain(token, wire);
            }
        }

        Assert.Equal(4 * seatCount, allCards.Count);
    }

    [Fact]
    public async Task ProductionExposesNeitherPrivateHandNorSeatBootstrap()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var hand = await client.GetAsync(
            $"/api/dev/matches/{Guid.NewGuid()}/hand");
        using var seat = await client.GetAsync(
            $"/api/dev/matches/{Guid.NewGuid()}/seat");
        Assert.Equal(HttpStatusCode.NotFound, hand.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, seat.StatusCode);
    }
}
