namespace Edonism.Api.Development;

/// <summary>
/// Route-specific, Development-only guard for authenticated mutations whose
/// contracts have NO request payload. Never inspect an unauthenticated body.
/// </summary>
internal static class DevelopmentBodylessPostGuard
{
    public static bool TryMatchPath(PathString path, out Guid matchId)
    {
        matchId = Guid.Empty;
        var segments = path.Value?.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return segments is { Length: 5 }
            && segments[0].Equals("api", StringComparison.OrdinalIgnoreCase)
            && segments[1].Equals("dev", StringComparison.OrdinalIgnoreCase)
            && segments[2].Equals("matches", StringComparison.OrdinalIgnoreCase)
            && (segments[4].Equals("rotate-token", StringComparison.OrdinalIgnoreCase)
                || segments[4].Equals("presence", StringComparison.OrdinalIgnoreCase))
            && Guid.TryParse(segments[3], out matchId);
    }

    /// <summary>
    /// Caller MUST authenticate first. A known positive Content-Length needs
    /// no I/O; otherwise read at most ONE byte. Never allocate or buffer a
    /// caller-controlled body just to reject it. An absent Content-Length may
    /// still mean a chunked body; do not trust that absence as zero bytes.
    /// </summary>
    public static async Task<bool> HasNoBodyAsync(HttpContext context)
    {
        if (context.Request.ContentLength is > 0) return false;
        if (context.Request.ContentLength == 0) return true;

        var oneByte = new byte[1];
        var count = await context.Request.Body.ReadAsync(
            oneByte.AsMemory(), context.RequestAborted);
        return count == 0;
    }
}
