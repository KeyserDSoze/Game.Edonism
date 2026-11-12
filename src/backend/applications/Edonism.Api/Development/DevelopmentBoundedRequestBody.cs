namespace Edonism.Api.Development;

/// <summary>
/// Buffers an untrusted Development request body with an explicit byte ceiling.
/// The caller decides authorization and policy before invoking this helper.
/// </summary>
internal static class DevelopmentBoundedRequestBody
{
    public static async Task<bool> TryBufferAsync(
        HttpContext context, MemoryStream buffer, long maxBytes)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(buffer);
        if (maxBytes < 1) throw new ArgumentOutOfRangeException(nameof(maxBytes));

        var block = new byte[8192];
        long total = 0;
        while (true)
        {
            // Read at most one byte beyond the policy limit so a missing or
            // dishonest Content-Length cannot force unbounded buffering.
            var remaining = maxBytes - total + 1;
            var read = await context.Request.Body.ReadAsync(
                block.AsMemory(0, (int)Math.Min(block.Length, remaining)),
                context.RequestAborted);
            if (read == 0)
            {
                buffer.Position = 0;
                return true;
            }

            total += read;
            if (total > maxBytes) return false;
            buffer.Write(block, 0, read);
        }
    }
}
