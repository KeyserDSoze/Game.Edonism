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
