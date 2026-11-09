using System.Text.Json;
using Edonism.Domain.World;

namespace Edonism.Infrastructure.World;

/// <summary>Loads the exact same versioned board JSON consumed by the React preview.</summary>
public static class BoardCatalog
{
    private static readonly Lazy<BoardDefinition> DefaultBoard = new(LoadCore);

    public static BoardDefinition LoadDefault() => DefaultBoard.Value;

    private static BoardDefinition LoadCore()
    {
        using var stream = typeof(BoardCatalog).Assembly.GetManifestResourceStream("Edonism.Board.v1.json")
            ?? throw new InvalidOperationException("Embedded street board definition not found.");
        var board = JsonSerializer.Deserialize<BoardDefinition>(stream, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        }) ?? throw new InvalidOperationException("Street board definition is empty.");
        board.Validate();
        return board;
    }
}
