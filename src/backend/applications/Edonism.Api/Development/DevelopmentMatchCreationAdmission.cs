namespace Edonism.Api.Development;

/// <summary>
/// A narrow, process-local safety budget for four unauthenticated Development
/// fixture creators. No client-supplied actor identity, IP or token controls
/// admission. This does not bound total persistent files or secure Production.
/// </summary>
public sealed class DevelopmentMatchCreationAdmission
{
    public const int MaxAttemptsPerWindow = 64;
    public const long MaxJsonBytes = 128 * 1024;
    public static readonly TimeSpan Window = TimeSpan.FromSeconds(60);
    private readonly object _gate = new();
    private readonly TimeProvider _clock;
    private DateTimeOffset _start;
    private int _attempts;

    public DevelopmentMatchCreationAdmission(TimeProvider? clock = null)
    {
        _clock = clock ?? TimeProvider.System;
        _start = _clock.GetUtcNow();
    }

    public bool TryAdmit(out int retryAfterSeconds)
    {
        lock (_gate)
        {
            var now = _clock.GetUtcNow();
            if (now < _start || now - _start >= Window)
            {
                _start = now;
                _attempts = 0;
            }

            if (_attempts == MaxAttemptsPerWindow)
            {
                retryAfterSeconds = Math.Max(1,
                    (int)Math.Ceiling((Window - (now - _start)).TotalSeconds));
                return false;
            }

            _attempts++;
            retryAfterSeconds = 0;
            return true;
        }
    }

    /// <summary>
    /// Exact creator POST paths only, not prefix matches, other verbs or
    /// command routes. A trailing slash on the root creator is supported.
    /// </summary>
    public static bool IsCreator(HttpRequest request)
    {
        if (!HttpMethods.IsPost(request.Method)) return false;
        var path = request.Path.Value;
        return path is not null && (
            path.Equals("/api/dev/matches", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/dev/matches/", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/dev/matches/from-cards", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/dev/matches/from-characters", StringComparison.OrdinalIgnoreCase)
            || path.Equals("/api/dev/matches/from-full-deck", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Read no more than MaxJsonBytes + 1 bytes, even when the HTTP request
    /// has no Content-Length (chunked). On success, replay the same bytes to
    /// normal ASP.NET Core JSON binding; no creator body is parsed twice.
    /// </summary>
    public static async Task<bool> TryBufferBodyAsync(
        HttpContext context, MemoryStream buffer)
    {
        var block = new byte[8192];
        long total = 0;
        while (true)
        {
            var remaining = MaxJsonBytes - total + 1;
            var read = await context.Request.Body.ReadAsync(
                block.AsMemory(0, (int)Math.Min(block.Length, remaining)),
                context.RequestAborted);
            if (read == 0)
            {
                buffer.Position = 0;
                return true;
            }
            total += read;
            if (total > MaxJsonBytes) return false;
            buffer.Write(block, 0, read);
        }
    }
}
