using System.Reflection;
using Edonism.Application;
using Edonism.Infrastructure.World;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHealthChecks();

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
// Immutable public board definition only. This endpoint cannot move players or mutate a match.
app.MapGet("/api/v1/board", () => Results.Ok(BoardCatalog.LoadDefault()));
app.Run();

public partial class Program
{
}
