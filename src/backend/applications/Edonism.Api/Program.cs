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
