using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #169: authenticated Development creator tokens must never be bundled with
/// extra private deck data or arbitrary JSON metadata in a creator 201.
/// React stores this entire response in component memory, so it independently
/// validates the exact .NET wire shape. The API already emits this shape.
/// </summary>
public sealed class DevelopmentCreatorExactWireContractTests
{
    private static WebApplicationFactory<Program> Host(string name) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(name));

    private static readonly string[] CreatorKeys =
        ["credentials", "matchId", "state"];
    private static readonly string[] CredentialKeys =
        ["playerId", "token"];

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task RealFullDeckCreatorEmitsOnlyThreeTopLevelAndTwoCredentialFields(int seats)
    {
        using var host = Host("Development");
        using var client = host.CreateClient();
        var ids = Enumerable.Range(0, seats)
            .Select(i => $"player-{i}").ToArray();
        using var response = await client.PostAsJsonAsync(
            "/api/dev/matches/from-full-deck", new
            {
                playerIds = ids,
                characters = CharacterSetupFixture.Catalog(),
                availableActivities = ActivitySetupFixture.Catalog(),
                actionCardIds = ActionDeckFixture.ActionIds(),
                electionDayCardId = ActionDeckFixture.ElectionDayId,
                seed = 2026
            });
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
        using var doc = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(doc);
        var root = doc.RootElement;
        Assert.Equal(JsonValueKind.Object, root.ValueKind);
        Assert.Equal(CreatorKeys, root.EnumerateObject()
            .Select(property => property.Name)
            .OrderBy(name => name, StringComparer.Ordinal));
        var matchId = root.GetProperty("matchId").GetGuid();
        Assert.NotEqual(Guid.Empty, matchId);
        var publicState = root.GetProperty("state");
        Assert.Equal(matchId, publicState.GetProperty("matchId").GetGuid());
        Assert.Equal(seats, publicState.GetProperty("players").GetArrayLength());

        var credentials = root.GetProperty("credentials");
        Assert.Equal(seats, credentials.GetArrayLength());
        var seenSeats = new HashSet<string>(StringComparer.Ordinal);
        var seenTokens = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in credentials.EnumerateArray())
        {
            Assert.Equal(JsonValueKind.Object, entry.ValueKind);
            Assert.Equal(CredentialKeys, entry.EnumerateObject()
                .Select(property => property.Name)
                .OrderBy(name => name, StringComparer.Ordinal));
            var seatId = entry.GetProperty("playerId").GetString();
            var bearer = entry.GetProperty("token").GetString();
            Assert.NotNull(seatId);
            Assert.NotNull(bearer);
            Assert.Contains(seatId, ids);
            Assert.True(seenSeats.Add(seatId));
            Assert.Matches(new Regex("^[0-9a-fA-F]{64}$"), bearer);
            Assert.True(seenTokens.Add(bearer));
        }
        Assert.Equal(seats, seenSeats.Count);
        Assert.Equal(seats, seenTokens.Count);

        // These are private initial cards and metadata from the trusted
        // shuffle/checkpoint, never part of a multi-seat creation receipt.
        var json = root.GetRawText();
        Assert.DoesNotContain("cardIds", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("remainingDrawPile", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("privateDeal", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("privateHands", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("electionDayCardId", json, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("secret", json, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task ProductionHasNoCreatorReceiptOrCredentialFields()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.PostAsync(
            "/api/dev/matches/from-full-deck", content: null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        var wire = await response.Content.ReadAsStringAsync();
        Assert.DoesNotContain("credentials", wire, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", wire, StringComparison.OrdinalIgnoreCase);
    }
}
