using Edonism.Domain.Matches;

namespace Edonism.Api.Development;

public sealed record CreateDevelopmentMatchRequest(IReadOnlyList<MatchParticipantSeed> Players);
public sealed record DevelopmentFreeMoveRequest(string DestinationStreetId, long ExpectedRevision);
public sealed record DevelopmentEndTurnRequest(long ExpectedRevision);

public static class DevelopmentMatchEndpoints
{
    // No player IDs in mutating requests: identity is derived only from a secret
    // issued by the server, and all these routes exist ONLY in Development.
    private const string TokenHeader = "X-Edonism-Dev-Token";

    public static IEndpointRouteBuilder MapDevelopmentMatches(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/dev/matches");

        group.MapPost("/", (CreateDevelopmentMatchRequest request, DevelopmentMatchStore store) =>
        {
            try
            {
                var created = store.Create(request.Players);
                return Results.Created($"/api/dev/matches/{created.MatchId}", created);
            }
            catch (ArgumentException)
            {
                return Results.BadRequest(new { code = "invalid_preview_setup" });
            }
        });

        group.MapGet("/{matchId:guid}", (Guid matchId, HttpContext context, DevelopmentMatchStore store) =>
        {
            return store.TryRead(matchId, Token(context), out var snapshot)
                ? Results.Ok(snapshot)
                : Results.NotFound(new { code = "match_not_found" });
        });

        group.MapPost("/{matchId:guid}/free-move", (
            Guid matchId, DevelopmentFreeMoveRequest request, HttpContext context, DevelopmentMatchStore store) =>
        {
            if (!store.TryFreeMove(matchId, Token(context), request.DestinationStreetId,
                    request.ExpectedRevision, out var result))
            {
                return Results.NotFound(new { code = "match_not_found" });
            }

            return Result(result!);
        });

        group.MapPost("/{matchId:guid}/end-turn", (
            Guid matchId, DevelopmentEndTurnRequest request, HttpContext context, DevelopmentMatchStore store) =>
        {
            if (!store.TryEndTurn(matchId, Token(context), request.ExpectedRevision, out var result))
            {
                return Results.NotFound(new { code = "match_not_found" });
            }

            return Result(result!);
        });

        return app;
    }

    private static string Token(HttpContext context) => context.Request.Headers[TokenHeader].ToString();
    private static IResult Result(MatchCommandResult result) =>
        result.Accepted
            ? Results.Ok(result.State)
            : Results.Conflict(new { code = result.Code });
}
