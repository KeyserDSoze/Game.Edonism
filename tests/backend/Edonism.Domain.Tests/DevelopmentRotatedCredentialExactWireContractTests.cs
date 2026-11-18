using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #173: real Development POST /rotate-token emits ONLY the two fields of
/// the .NET DevSeatCredential (playerId/token). A forged HTTP 200 may not
/// silently add private-deck/opponent-bearer metadata to a rotation receipt.
/// The server already emits this narrow DTO; these are wire parity tests.
/// </summary>
public sealed class DevelopmentRotatedCredentialExactWireContractTests
{
    private static WebApplicationFactory<Program> Host(string environment) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(
            builder => builder.UseEnvironment(environment));

    private static HttpClient Seat(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Edonism-Dev-Token", token);
        return client;
    }

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public async Task AuthenticRotationReceiptHasExactlyTwoFieldsAndRevokesOnlyItsActor(
        int seats)
    {
        using var host = Host("Development");
        using var creator = host.CreateClient();
        var ids = Enumerable.Range(0, seats)
            .Select(index => $"actor-{index}").ToArray();
        using var response = await creator.PostAsJsonAsync(
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
        using var created = await response.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(created);
        var matchId = created.RootElement.GetProperty("matchId").GetGuid();
        var tokens = created.RootElement.GetProperty("credentials")
            .EnumerateArray().Select(entry => entry.GetProperty("token").GetString()!)
            .ToArray();
        Assert.Equal(seats, tokens.Length);

        var target = seats - 1;
        var endpoint = $"/api/dev/matches/{matchId}";
        using var oldSeat = Seat(host, tokens[target]);
        using var otherSeat = Seat(host, tokens[0]);
        using var oldPublic = await oldSeat.GetAsync(endpoint);
        Assert.Equal(HttpStatusCode.OK, oldPublic.StatusCode);
        var original = await oldPublic.Content.ReadAsStringAsync();

        using var rotation = await oldSeat.PostAsync(endpoint + "/rotate-token", null);
        Assert.Equal(HttpStatusCode.OK, rotation.StatusCode);
        Assert.Equal("no-store", rotation.Headers.CacheControl?.ToString());
        using var receiptDoc = await rotation.Content.ReadFromJsonAsync<JsonDocument>();
        Assert.NotNull(receiptDoc);
        var receipt = receiptDoc.RootElement;
        Assert.Equal(new[] { "playerId", "token" }, receipt.EnumerateObject()
            .Select(property => property.Name)
            .OrderBy(name => name, StringComparer.Ordinal));
        Assert.Equal(ids[target], receipt.GetProperty("playerId").GetString());
        var newlyMinted = receipt.GetProperty("token").GetString();
        Assert.NotNull(newlyMinted);
        Assert.Matches("^[a-fA-F0-9]{64}$", newlyMinted);
        Assert.DoesNotContain(tokens, token => token.Equals(
            newlyMinted, StringComparison.OrdinalIgnoreCase));
        var raw = receipt.GetRawText();
        Assert.DoesNotContain("cardIds", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("otherPlayerTokens", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("remainingDrawPile", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("privateHand", raw, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("futureActions", raw, StringComparison.OrdinalIgnoreCase);

        using var revoked = await oldSeat.GetAsync(endpoint);
        Assert.Equal(HttpStatusCode.NotFound, revoked.StatusCode);
        using var revokedHand = await oldSeat.GetAsync(endpoint + "/hand");
        Assert.Equal(HttpStatusCode.NotFound, revokedHand.StatusCode);
        using var renewed = Seat(host, newlyMinted);
        using var refreshed = await renewed.GetAsync(endpoint);
        using var preservedOther = await otherSeat.GetAsync(endpoint);
        Assert.Equal(HttpStatusCode.OK, refreshed.StatusCode);
        Assert.Equal(HttpStatusCode.OK, preservedOther.StatusCode);
        Assert.Equal(original, await refreshed.Content.ReadAsStringAsync());
        Assert.Equal(original, await preservedOther.Content.ReadAsStringAsync());
        using var snapshot = await renewed.GetFromJsonAsync<JsonDocument>(endpoint);
        Assert.NotNull(snapshot);
        Assert.Equal(0, snapshot.RootElement.GetProperty("revision").GetInt32());
        Assert.Equal(1, snapshot.RootElement.GetProperty("events").GetArrayLength());
        Assert.Equal(ids[0], snapshot.RootElement.GetProperty("activePlayerId").GetString());
    }

    [Fact]
    public async Task ProductionCannotMintDevelopmentRotatedBearer()
    {
        using var host = Host("Production");
        using var client = host.CreateClient();
        using var response = await client.PostAsync(
            "/api/dev/matches/00000000-0000-0000-0000-000000000020/rotate-token", null);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }
}
