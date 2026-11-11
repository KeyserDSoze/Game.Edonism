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
/// <summary>
/// Match EXACTLY the two Development command paths before the router can
/// short-circuit malformed Content-Type with 415. No other Dev routes,
/// query parameters, HTTP verbs or arbitrary path prefixes are authorized.
/// This only identifies a resource; the store resolves the bearer under lock.
/// </summary>
internal static class DevelopmentCommandPreauthorization
{
    public static bool TryMatchPath(PathString path, out Guid matchId)
    {
        matchId = Guid.Empty;
        var segments = path.Value?.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return segments is { Length: 5 }
            && segments[0].Equals("api", StringComparison.OrdinalIgnoreCase)
            && segments[1].Equals("dev", StringComparison.OrdinalIgnoreCase)
            && segments[2].Equals("matches", StringComparison.OrdinalIgnoreCase)
            && (segments[4].Equals("free-move", StringComparison.OrdinalIgnoreCase)
                || segments[4].Equals("end-turn", StringComparison.OrdinalIgnoreCase))
            && Guid.TryParse(segments[3], out matchId);
    }
}

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
            catch (DevelopmentMatchCapacityException)
            {
                return CapacityReached();
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
            catch (DevelopmentMatchCapacityException)
            {
                return CapacityReached();
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
            catch (DevelopmentMatchCapacityException)
            {
                return CapacityReached();
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
            catch (DevelopmentMatchCapacityException)
            {
                return CapacityReached();
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

        // Reconstruct historical player positions exclusively inside the
        // .NET verifier. This endpoint is read-only, bearer-authorized and
        // never exposes hands, character secrets or unverified event frames.
        group.MapGet("/{matchId:guid}/history", (Guid matchId, HttpContext context,
            DevelopmentMatchStore store) =>
        {
            return store.TryReadHistory(matchId, Token(context), out var history)
                ? Results.Ok(history)
                : Results.NotFound(new { code = "match_not_found" });
        });

        // #49: actor-authorized, read-only shortest street graph distances to
        // currently uncontrolled public activities. NOT a purchase action.
        group.MapGet("/{matchId:guid}/uncontrolled-routes",
            (Guid matchId, HttpContext context, DevelopmentMatchStore store) =>
        {
            return store.TryReadUncontrolledRoutes(matchId, Token(context), out var routes)
                ? Results.Ok(routes)
                : Results.NotFound(new { code = "match_not_found" });
        });

        // #43: actor-authorized, audit-verified completed/remaining turn order.
        // Does not grant turn permissions, reveal private cards or skip actors.
        group.MapGet("/{matchId:guid}/turn-progress",
            (Guid matchId, HttpContext context, DevelopmentMatchStore store) =>
        {
            return store.TryReadFirstRoundTurnProgress(matchId, Token(context), out var progress)
                ? Results.Ok(progress)
                : Results.NotFound(new { code = "match_not_found" });
        });

        // #42: verified, immutable gross quote and NEXT order only after the
        // last first-round turn. Auth before phase check, no settlement writes.
        group.MapGet("/{matchId:guid}/settlement-preview",
            (Guid matchId, HttpContext context, DevelopmentMatchStore store) =>
        {
            if (!store.TryReadPendingSettlementPreview(matchId, Token(context), out var preview))
                return Results.NotFound(new { code = "match_not_found" });
            return preview is null
                ? Results.Conflict(new { code = "round_not_pending" })
                : Results.Ok(preview);
        });

        // A heartbeat is an ephemeral, bearer-authenticated hint that a
        // Development seat's browser is recently active. It neither mutates
        // Domain state nor grants gameplay permissions. GET never marks a
        // seat active merely by observing it.
        group.MapGet("/{matchId:guid}/presence", (Guid matchId, HttpContext context,
            DevelopmentMatchStore store) =>
        {
            return store.TryReadPresence(matchId, Token(context), out var presence)
                ? Results.Ok(presence)
                : Results.NotFound(new { code = "match_not_found" });
        });
        group.MapPost("/{matchId:guid}/presence", (Guid matchId, HttpContext context,
            DevelopmentMatchStore store) =>
        {
            return store.TryHeartbeat(matchId, Token(context), out var presence)
                ? Results.Ok(presence)
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

            var etag = $"W/\"edonism-revision-{snapshot!.Revision}\"";
            var conditions = context.Request.Headers.IfNoneMatch.ToString().Split(',');
            var unchanged = conditions.Any(value => value.Trim() == etag || value.Trim() == "*");
            if (conditions.Any(value => value.Trim() == etag)
                && BoundedWaitSeconds(context.Request.Headers["Prefer"].ToString()) is int seconds)
            {
                var result = await store.WaitForRevisionAsync(matchId, token, snapshot.Revision,
                    TimeSpan.FromSeconds(seconds), context.RequestAborted);
                if (!result.Found)
                    return Results.NotFound(new { code = "match_not_found" });
                if (result.Saturated)
                {
                    // Authenticated congestion, NOT a session revocation.
                    // The #33 response policy adds no-store to this 429 too.
                    context.Response.Headers["Retry-After"] = "1";
                    return Results.StatusCode(StatusCodes.Status429TooManyRequests);
                }
                snapshot = result.State!;
                etag = $"W/\"edonism-revision-{snapshot.Revision}\"";
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
                    request.ExpectedRevision, out var result, CommandKey(context)))
                return Results.NotFound(new { code = "match_not_found" });

            return Result(result!);
        });

        group.MapPost("/{matchId:guid}/end-turn", (
            Guid matchId, DevelopmentEndTurnRequest request, HttpContext context, DevelopmentMatchStore store) =>
        {
            if (!store.TryEndTurn(matchId, Token(context), request.ExpectedRevision,
                    out var result, CommandKey(context)))
                return Results.NotFound(new { code = "match_not_found" });

            return Result(result!);
        });

        return app;
    }

    // Capacity is distinct from transient request-rate limiting (429). A
    // process restart clears memory-only fixture slots, not encrypted files.
    private static IResult CapacityReached() => Results.Json(
        new { code = "dev_match_capacity_reached" },
        statusCode: StatusCodes.Status503ServiceUnavailable);

    private static string Token(HttpContext context) => context.Request.Headers[TokenHeader].ToString();

    private static string? CommandKey(HttpContext context)
    {
        // #40: preserve an invalid/empty/multi-valued header for the store
        // to reject ONLY AFTER resolving the actor under the match lock.
        // A revoked/missing bearer must never receive header-validation 400.
        // null alone means the historical unkeyed command.
        var supplied = context.Request.Headers["Idempotency-Key"];
        return supplied.Count switch
        {
            0 => null,
            1 => supplied.ToString(),
            _ => string.Empty
        };
    }

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
            : result.Code == "invalid_idempotency_key"
                ? Results.BadRequest(new { code = result.Code })
                : Results.Conflict(new { code = result.Code });
}
