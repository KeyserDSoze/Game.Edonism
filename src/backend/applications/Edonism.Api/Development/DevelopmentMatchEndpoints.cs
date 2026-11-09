using Edonism.Domain.Matches;
using Edonism.Domain.World;

namespace Edonism.Api.Development;

public sealed record CreateDevelopmentMatchRequest(IReadOnlyList<MatchParticipantSeed> Players);
public sealed record CreateCardDevelopmentMatchRequest(
    IReadOnlyList<MatchParticipantCardSeed> Players,
    IReadOnlyList<ActivityCardId> AvailableActivities,
    int Seed);
public sealed record CreateCharacterDevelopmentMatchRequest(
    IReadOnlyList<string> PlayerIds,
    IReadOnlyList<CharacterCardDefinition> Characters,
    IReadOnlyList<ActivityCardId> AvailableActivities,
    int Seed);
public sealed record CreateFullDevelopmentMatchRequest(
    IReadOnlyList<string> PlayerIds,
    IReadOnlyList<CharacterCardDefinition> Characters,
    IReadOnlyList<ActivityCardId> AvailableActivities,
    IReadOnlyList<string> ActionCardIds,
    string ElectionDayCardId,
    int Seed);
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

        // Only in Development; test fixtures can supply synthetic card IDs and
        // receive the credentials for all seats. No production catalogue is implied.
        group.MapPost("/from-cards", (
            CreateCardDevelopmentMatchRequest request, DevelopmentMatchStore store) =>
        {
            try
            {
                var created = store.CreateWithCards(
                    request.Players, request.AvailableActivities, request.Seed);
                return Results.Created($"/api/dev/matches/{created.MatchId}", created);
            }
            catch (ArgumentException)
            {
                return Results.BadRequest(new { code = "invalid_card_setup" });
            }
        });

        // The caller supplies synthetic Development catalog metadata, not
        // the drawn character or any player location. The server draws both.
        group.MapPost("/from-characters", (
            CreateCharacterDevelopmentMatchRequest request, DevelopmentMatchStore store) =>
        {
            try
            {
                var created = store.CreateWithCharacters(
                    request.PlayerIds, request.Characters, request.AvailableActivities, request.Seed);
                return Results.Created($"/api/dev/matches/{created.MatchId}", created);
            }
            catch (ArgumentException)
            {
                return Results.BadRequest(new { code = "invalid_character_setup" });
            }
        });

        // Rulebook2 pp.3-4: 58 actions plus one Election Day, dealt 4 per player.
        // Neither player hands nor the draw pile appear in the public response.
        group.MapPost("/from-full-deck", (
            CreateFullDevelopmentMatchRequest request, DevelopmentMatchStore store) =>
        {
            try
            {
                var created = store.CreateWithFullDeck(
                    request.PlayerIds, request.Characters, request.AvailableActivities,
                    request.ActionCardIds, request.ElectionDayCardId, request.Seed);
                return Results.Created($"/api/dev/matches/{created.MatchId}", created);
            }
            catch (ArgumentException)
            {
                return Results.BadRequest(new { code = "invalid_full_deck_setup" });
            }
        });

        group.MapGet("/{matchId:guid}/hand", (Guid matchId, HttpContext context,
            DevelopmentMatchStore store) =>
        {
            return store.TryReadHand(matchId, Token(context), out var hand)
                ? Results.Ok(hand)
                : Results.NotFound(new { code = "hand_not_found" });
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
