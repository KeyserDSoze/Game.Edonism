using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Edonism.Domain.Matches;

namespace Edonism.Api.Development;

/// <summary>
/// Opt-in encrypted single-process Development checkpoint files.
/// No unencrypted hands, deck or bearer credentials are ever written.
/// NOT a Production multiplayer database or identity provider.
/// </summary>
public sealed record PersistedDevelopmentMatch(
    int FormatVersion,
    Guid MatchId,
    GameMatchCheckpoint Checkpoint,
    IReadOnlyDictionary<string, string> TokenDigests);

public sealed class DevelopmentMatchCheckpointFiles
{
    private const int FileVersion = 1;
    private const int NonceBytes = 12;
    private const int TagBytes = 16;
    private const int MaxPayloadBytes = 1024 * 1024;
    private static readonly byte[] Magic = "EDONDM01"u8.ToArray();

    private readonly string _directory;
    private readonly byte[] _key;

    /// <param name="directory">Single-user, private, dedicated Development data directory.</param>
    /// <param name="keyHex">Exactly 32 random bytes encoded as 64 hex chars. NEVER commit it.</param>
    public DevelopmentMatchCheckpointFiles(string directory, string keyHex)
    {
        if (string.IsNullOrWhiteSpace(directory) || !Path.IsPathFullyQualified(directory)
            || string.IsNullOrWhiteSpace(keyHex) || keyHex.Length != 64)
            throw new ArgumentException("Dev checkpoint directory must be absolute and AES key must be 64 hex chars.");

        try { _key = Convert.FromHexString(keyHex); }
        catch (FormatException e) { throw new ArgumentException("Invalid Development AES key hex.", nameof(keyHex), e); }
        if (_key.Length != 32)
            throw new ArgumentException("AES-256 requires 32 bytes.", nameof(keyHex));

        _directory = Path.GetFullPath(directory);
        Directory.CreateDirectory(_directory);
        // On Unix, keep both ciphertext and directory private to this user.
        // The directory guards initial temp-file creation before permissions are set.
        if (!OperatingSystem.IsWindows())
            Directory.SetUnixFileMode(_directory, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    }

    private string PathFor(Guid matchId) =>
        Path.Combine(_directory, $"{matchId:N}.edonism");

    public void Save(GameMatchCheckpoint checkpoint, IReadOnlyDictionary<string, byte[]> tokenDigests)
    {
        ArgumentNullException.ThrowIfNull(checkpoint);
        ArgumentNullException.ThrowIfNull(tokenDigests);
        var id = checkpoint.State.MatchId;
        if (id == Guid.Empty) throw new ArgumentException("Invalid match ID.", nameof(checkpoint));

        var digests = tokenDigests.ToDictionary(kv => kv.Key,
            kv => Convert.ToHexString(kv.Value), StringComparer.Ordinal);
        var payload = JsonSerializer.SerializeToUtf8Bytes(new PersistedDevelopmentMatch(
            FileVersion, id, checkpoint, digests));
        if (payload.Length > MaxPayloadBytes)
            throw new InvalidDataException("Checkpoint payload too large.");

        var nonce = RandomNumberGenerator.GetBytes(NonceBytes);
        var ciphertext = new byte[payload.Length];
        var tag = new byte[TagBytes];
        using (var aes = new AesGcm(_key, TagBytes))
            aes.Encrypt(nonce, payload, ciphertext, tag, id.ToByteArray());

        var encrypted = new byte[Magic.Length + NonceBytes + TagBytes + ciphertext.Length];
        Magic.CopyTo(encrypted, 0);
        nonce.CopyTo(encrypted, Magic.Length);
        tag.CopyTo(encrypted, Magic.Length + NonceBytes);
        ciphertext.CopyTo(encrypted, Magic.Length + NonceBytes + TagBytes);

        var target = PathFor(id);
        var temp = Path.Combine(_directory, $"{id:N}.{Guid.NewGuid():N}.tmp");
        try
        {
            using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write,
                FileShare.None, 4096, FileOptions.WriteThrough))
            {
                stream.Write(encrypted);
                stream.Flush(flushToDisk: true);
            }

            if (!OperatingSystem.IsWindows())
                File.SetUnixFileMode(temp, UnixFileMode.UserRead | UnixFileMode.UserWrite);
            // Same-directory atomic rename on local Linux filesystems. No plaintext temp.
            File.Move(temp, target, overwrite: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
            CryptographicOperations.ZeroMemory(payload);
        }
    }

    public PersistedDevelopmentMatch? Load(Guid matchId)
    {
        if (matchId == Guid.Empty) return null;
        var path = PathFor(matchId);
        if (!File.Exists(path)) return null;

        var info = new FileInfo(path);
        if (info.Length <= Magic.Length + NonceBytes + TagBytes
            || info.Length > MaxPayloadBytes + Magic.Length + NonceBytes + TagBytes)
            throw new InvalidDataException("Invalid encrypted checkpoint size.");
        var bytes = File.ReadAllBytes(path);
        if (!bytes.AsSpan(0, Magic.Length).SequenceEqual(Magic))
            throw new InvalidDataException("Invalid checkpoint envelope.");

        var nonce = bytes.AsSpan(Magic.Length, NonceBytes);
        var tag = bytes.AsSpan(Magic.Length + NonceBytes, TagBytes);
        var ciphertext = bytes.AsSpan(Magic.Length + NonceBytes + TagBytes);
        var plaintext = new byte[ciphertext.Length];
        try
        {
            using (var aes = new AesGcm(_key, TagBytes))
                aes.Decrypt(nonce, ciphertext, tag, plaintext, matchId.ToByteArray());
            var result = JsonSerializer.Deserialize<PersistedDevelopmentMatch>(plaintext);
            if (result is null || result.FormatVersion != FileVersion
                || result.MatchId != matchId || result.Checkpoint is null
                || result.Checkpoint.State is null || result.Checkpoint.State.MatchId != matchId
                || result.TokenDigests is null)
                throw new InvalidDataException("Checkpoint format or identity invalid.");
            return result;
        }
        catch (CryptographicException ex)
        {
            throw new InvalidDataException("Checkpoint authentication failed.", ex);
        }
        catch (JsonException ex)
        {
            throw new InvalidDataException("Checkpoint JSON invalid.", ex);
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }
}
