using System.Net;
using System.Net.Http.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Edonism.Domain.Tests;

public sealed class BoardEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public BoardEndpointTests(WebApplicationFactory<Program> factory) => _factory = factory;

    [Fact]
    public async Task PublicBoardEndpointExposesVersionedSevenStreetsAndThirtySlots()
    {
        using var client = _factory.CreateClient();
        using var response = await client.GetAsync("/api/v1/board");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        using var json = await response.Content.ReadFromJsonAsync<System.Text.Json.JsonDocument>();
        Assert.NotNull(json);
        var root = json.RootElement;
        Assert.Equal("edonism-streets-v1", root.GetProperty("version").GetString());
        Assert.Equal(7, root.GetProperty("streets").GetArrayLength());
        Assert.Equal(30, root.GetProperty("slots").GetArrayLength());
        Assert.Equal(9, root.GetProperty("roads").GetArrayLength());
        Assert.Contains(root.GetProperty("streets").EnumerateArray(),
            street => street.GetProperty("id").GetString() == "main-square");
    }

    [Fact]
    public async Task StaticBoardIsReadOnlyAndCannotBeMutatedThroughPost()
    {
        using var client = _factory.CreateClient();
        using var response = await client.PostAsJsonAsync("/api/v1/board", new { cardId = "fake", slotId = "N-01" });
        Assert.Equal(HttpStatusCode.MethodNotAllowed, response.StatusCode);
    }
}
