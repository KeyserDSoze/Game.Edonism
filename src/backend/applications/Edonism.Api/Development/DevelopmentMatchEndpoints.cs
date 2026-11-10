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

        // Development only: validates the current PUBLIC movement/turn audit,
        // not player hands, draw pile, or a Production persistence/replay log.
        group.MapGet("/{matchId:guid}/audit", (Guid matchId, HttpContext context,
            DevelopmentMatchStore store) =>
        {
            return store.TryReadAudit(matchId, Token(context), out var verification)
                ? Results.Ok(verification)
                : Results.NotFound(new { code = "match_not_found" });
        });

        // A single Development bootstrap joins state, this actor's private
        // hand and the Domain's permissions at one revision under one lock.
        // Authorization comes only from the bearer header, never query playerId.
        group.MapGet("/{matchId:guid}/seat", (Guid matchId, HttpContext context,
            DevelopmentMatchStore store) =>
        {
            return store.TryBootstrapSeat(matchId, Token(context), out var bootstrap)
                ? Results.Ok(bootstrap)
                : Results.NotFound(new { code = "match_not_found" });
        });

        // Actor-scoped first-round options from the Domain, never from 3D/UI
        // geometry. This projection intentionally has no cards or token data.
        group.MapGet("/{matchId:guid}/turn-options", (Guid matchId, HttpContext context,
            DevelopmentMatchStore store) =>
        {
            return store.TryReadTurnOptions(matchId, Token(context), out var options)
                ? Results.Ok(options)
                : Results.NotFound(new { code = "match_not_found" });
        });

        group.MapGet("/{matchId:guid}/hand", (Guid matchId, HttpContext context,
            DevelopmentMatchStore store) =>
        {
            return store.TryReadHand(matchId, Token(context), out var hand)
                ? Results.Ok(hand)
                : Results.NotFound(new { code = "hand_not_found" });
        });

        // Prefer: wait=N activates a bounded, authenticated conditional
        // long poll ONLY when the supplied ETag matches the current revision.
        // A waiter reauthenticates after wake (including token revocation).
        // No match lock or request thread remains blocked during the wait.
        group.MapGet("/{matchId:guid}", async (Guid matchId, HttpContext context,
            DevelopmentMatchStore store) =>
        {
            var token = Token(context);
            if (!store.TryRead(matchId, token, out var snapshot))
                return Results.NotFound(new { code = "match_not_found" });

            var etag = $"W/\\"edonism-revision-{snapshot!.Revision}\\"";
            var conditions = context.Request.Headers.IfNoneMatch.ToString().Split(',');
            var unchanged = conditions.Any(value => value.Trim() == etag || value.Trim() == "*");
            if (unchanged && BoundedWaitSeconds(context.Request.Headers.Prefer.ToString()) is int seconds)
            {
                var result = await store.WaitForRevisionAsync(matchId, token, snapshot.Revision,
                    TimeSpan.FromSeconds(seconds), context.RequestAborted);
                if (!result.Found)
                    return Results.NotFound(new { code = "match_not_found" });
                snapshot = result.State!;
                etag = $"W/\\"edonism-revision-{snapshot.Revision}\\"";
                unchanged = conditions.Any(value => value.Trim() == etag || value.Trim() == "*");
            }

            context.Response.Headers.ETag = etag;
            return unchanged
                ? Results.StatusCode(StatusCodes.Status304NotModified)
                : Results.Ok(snapshot);
        });

        // Issue #28: a seat holder can invalidate only their own Development
        // capability. No playerId/body input and no publicly cached response.
        group.MapPost("/{matchId:guid}/rotate-token", (
            Guid matchId, HttpContext context, DevelopmentMatchStore store) =>
        {
            return store.TryRotateSeatToken(matchId, Token(context), out var credential)
                ? Results.Ok(credential)
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

    private static int? BoundedWaitSeconds(string prefer)
    {
        // Ignore arbitrary/invalid preferences rather than allowing clients
        // to hold connections indefinitely. An out-of-range wait is a normal
        // conditional GET (304), not a request with a clamped long timeout.
        if (!prefer.StartsWith("wait=", StringComparison.OrdinalIgnoreCase))
            return null;
        var candidate = prefer["wait=".Length..];
        return int.TryParse(candidate, out var seconds) && seconds is >= 1 and <= 10
            ? seconds
            : null;
    }
    private static IResult Result(MatchCommandResult result) =>
        result.Accepted
            ? Results.Ok(result.State)
            : Results.Conflict(new { code = result.Code });
}
