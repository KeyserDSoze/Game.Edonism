using System.Reflection;
using Edonism.Api.Development;
using Edonism.Application;
using Edonism.Infrastructure.World;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHealthChecks();
if (builder.Environment.IsDevelopment())
{
    // By default Development stays memory-only. Persistence is opt-in and the
    // encryption key MUST be provided outside source control.
    var checkpointDir = Environment.GetEnvironmentVariable("EDONISM_DEV_CHECKPOINT_DIR");
    var checkpointKey = Environment.GetEnvironmentVariable("EDONISM_DEV_CHECKPOINT_KEY_HEX");
    if (string.IsNullOrWhiteSpace(checkpointDir) != string.IsNullOrWhiteSpace(checkpointKey))
        throw new InvalidOperationException(
            "Development match storage requires BOTH checkpoint dir and AES-256 key.");
    builder.Services.AddSingleton<DevelopmentMatchCreationAdmission>();
    builder.Services.AddSingleton(string.IsNullOrWhiteSpace(checkpointDir)
        ? new DevelopmentMatchStore()
        : new DevelopmentMatchStore(new DevelopmentMatchCheckpointFiles(
            checkpointDir!, checkpointKey!)));
}

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options => options.AddPolicy("frontend", policy =>
{
    if (allowedOrigins.Length > 0)
    {
        policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod();
    }
}));

var app = builder.Build();

// Issue #33: the Development match endpoints may issue all-seat bearer
// capabilities or actor-private hands. Apply response privacy headers BEFORE
// routing/model binding so 201/200/304/400/404/409 (even bad JSON and unknown
// paths under this prefix) are never cacheable by compliant HTTP caches.
// Do not expose this Development-specific middleware in Production.
if (app.Environment.IsDevelopment())
{
    app.Use(async (context, next) =>
    {
        if (context.Request.Path.StartsWithSegments("/api/dev/matches"))
        {
            // Model binding may throw BadHttpRequestException, after which
            // DeveloperExceptionPage clears and recreates the 400 response.
            // OnStarting survives that header reset and reasserts privacy
            // for the final status, including malformed JSON and 304.
            context.Response.OnStarting(() =>
            {
                context.Response.Headers.CacheControl = "no-store";
                context.Response.Headers.Pragma = "no-cache";
                context.Response.Headers.Expires = "0";
                return Task.CompletedTask;
            });
            context.Response.Headers.CacheControl = "no-store";
            context.Response.Headers.Pragma = "no-cache";
            context.Response.Headers.Expires = "0";
        }

        await next();
    });
}

// The 4 unauthenticated Development fixture creators need admission limits
// BEFORE router/model binding and BEFORE untrusted JSON allocation. Apply
// the no-store middleware above to 413/429 too. This is not Production auth.
if (app.Environment.IsDevelopment())
{
    app.Use(async (context, next) =>
    {
        if (!DevelopmentMatchCreationAdmission.IsCreator(context.Request))
        {
            await next();
            return;
        }

        var budget = context.RequestServices
            .GetRequiredService<DevelopmentMatchCreationAdmission>();
        if (context.Request.ContentLength > DevelopmentMatchCreationAdmission.MaxJsonBytes)
        {
            await Results.Json(new { code = "dev_create_payload_too_large" },
                statusCode: StatusCodes.Status413PayloadTooLarge).ExecuteAsync(context);
            return;
        }
        if (!budget.TryAdmit(out var retryAfter))
        {
            context.Response.Headers.RetryAfter = retryAfter.ToString(
                System.Globalization.CultureInfo.InvariantCulture);
            await Results.Json(new { code = "dev_create_rate_limited" },
                statusCode: StatusCodes.Status429TooManyRequests).ExecuteAsync(context);
            return;
        }

        // ContentLength may be absent (chunked), or may be fabricated.
        // Buffer at most 128 KiB + 1 byte before exposing the replay stream
        // to the framework binder. Never trust ContentLength alone.
        await using var bounded = new MemoryStream();
        if (!await DevelopmentMatchCreationAdmission.TryBufferBodyAsync(context, bounded))
        {
            await Results.Json(new { code = "dev_create_payload_too_large" },
                statusCode: StatusCodes.Status413PayloadTooLarge).ExecuteAsync(context);
            return;
        }
        var original = context.Request.Body;
        context.Request.Body = bounded;
        try { await next(); }
        finally { context.Request.Body = original; }
    });
}

// ASP.NET Core's endpoint router may return 415 for an invalid Content-Type
// BEFORE a Minimal API endpoint filter or endpoint-metadata middleware runs.
// For the TWO known Development mutation routes, authorize the bearer BEFORE
// routing/model binding (#45), then bound the authenticated JSON body (#78).
// The store authenticates again under the match lock before any mutation.
if (app.Environment.IsDevelopment())
{
    app.Use(async (context, next) =>
    {
        if (!HttpMethods.IsPost(context.Request.Method)
            || !DevelopmentCommandPreauthorization.TryMatchPath(
                context.Request.Path, out var matchId))
        {
            await next();
            return;
        }

        var store = context.RequestServices.GetRequiredService<DevelopmentMatchStore>();
        if (!store.HasSeatAccess(matchId,
                context.Request.Headers["X-Edonism-Dev-Token"].ToString()))
        {
            // Authorization intentionally precedes Content-Length, body and
            // Content-Type inspection so revoked/forged callers learn nothing
            // about the command parser or its resource limits.
            await Results.NotFound(new { code = "match_not_found" })
                .ExecuteAsync(context);
            return;
        }

        if (context.Request.ContentLength
            is > DevelopmentCommandPreauthorization.MaxJsonBytes)
        {
            await Results.Json(new { code = "dev_command_payload_too_large" },
                statusCode: StatusCodes.Status413PayloadTooLarge)
                .ExecuteAsync(context);
            return;
        }

        // Content-Length can be absent (chunked) or dishonest. Buffer only
        // max + 1 bytes, then replay a valid body unchanged to normal Minimal
        // API JSON binding. No custom command parsing or gameplay occurs here.
        await using var bounded = new MemoryStream();
        if (!await DevelopmentBoundedRequestBody.TryBufferAsync(
                context, bounded, DevelopmentCommandPreauthorization.MaxJsonBytes))
        {
            await Results.Json(new { code = "dev_command_payload_too_large" },
                statusCode: StatusCodes.Status413PayloadTooLarge)
                .ExecuteAsync(context);
            return;
        }

        var original = context.Request.Body;
        context.Request.Body = bounded;
        try { await next(); }
        finally { context.Request.Body = original; }
    });
}
// #82: two Development mutations are intentionally BODYLESS. Authorize
// before inspecting even Content-Length, then reject an unexpected single
// byte without rotating a capability or recording a presence heartbeat.
// Do not apply this rule to creators or JSON command routes.
if (app.Environment.IsDevelopment())
{
    app.Use(async (context, next) =>
    {
        if (!HttpMethods.IsPost(context.Request.Method)
            || !DevelopmentBodylessPostGuard.TryMatchPath(
                context.Request.Path, out var matchId))
        {
            await next();
            return;
        }

        var store = context.RequestServices.GetRequiredService<DevelopmentMatchStore>();
        if (!store.HasSeatAccess(matchId,
                context.Request.Headers["X-Edonism-Dev-Token"].ToString()))
        {
            await Results.NotFound(new { code = "match_not_found" })
                .ExecuteAsync(context);
            return;
        }

        if (!await DevelopmentBodylessPostGuard.HasNoBodyAsync(context))
        {
            await Results.Json(new { code = "dev_bodyless_payload_not_allowed" },
                statusCode: StatusCodes.Status413PayloadTooLarge)
                .ExecuteAsync(context);
            return;
        }

        // Both endpoint handlers reauthorize inside the match lock. Rotation
        // occurring after this preflight cannot grant stale-bearer access.
        await next();
    });
}

// Explicit routing here prevents implicit routing from executing BEFORE
// the auth gate and exposing body/Content-Type validation to revoked tokens.
app.UseRouting();
app.UseCors("frontend");
app.MapHealthChecks("/health");
app.MapGet("/api/v1/meta", () => Results.Ok(new
{
    game = GameFoundation.Name,
    status = GameFoundation.Status,
    version = typeof(Program).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion,
    authoritativeGameplay = false
}));
// Immutable public board only: no client authority over movement, money or PvP.
app.MapGet("/api/v1/board", () => Results.Ok(BoardCatalog.LoadDefault()));

if (app.Environment.IsDevelopment())
{
    app.MapDevelopmentMatches();
}

app.Run();

public partial class Program
{
}
