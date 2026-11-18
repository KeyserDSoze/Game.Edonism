using Edonism.Domain.Matches;
using Edonism.Infrastructure.World;
using Xunit;

namespace Edonism.Domain.Tests;

/// <summary>
/// #168: the existing .NET printed roster rule (16 henchmen per seat)
/// is the source of truth for React's read-only resource admission.
/// Neither preview path allocates or spends any units.
/// </summary>
public sealed class PrintedHenchmenBudgetParityTests
{
    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    [InlineData(8)]
    public void FullRosterRejectsSelfConsistentForgedTotalEvenWithAccurateOwnLots(int seats)
    {
        var board = BoardCatalog.LoadDefault();
        var seeds = board.Slots.Take(seats).Select((slot, i) =>
            new MatchParticipantSeed($"player-{i}", slot.Id)).ToArray();
        var match = GameMatch.CreateFromTrustedSetup(Guid.NewGuid(), board, seeds);
        var state = match.Snapshot();
        Assert.Equal(seats, state.Players.Count);
        Assert.All(state.Players, player =>
        {
            Assert.Equal(16, player.HenchmenTotal);
            Assert.Equal(15, player.HenchmenAvailable);
        });

        var expected = GrossSalaryRules.Quote(board, state.Players,
            state.ControlledActivities);
        Assert.Equal(seats, expected.Count);
        Assert.All(expected, quote => Assert.Equal(3, quote.GrossAtoms));

        // A forged 15/14, 17/16, or 1/0 is internally consistent with
        // exactly one deployed public henchman; it must still be rejected.
        foreach (var total in new[] { 0, 1, 15, 17, 64 })
        {
            var forged = state.Players.ToArray();
            forged[^1] = forged[^1] with
            {
                HenchmenTotal = total,
                HenchmenAvailable = total - 1
            };
            Assert.Throws<ArgumentException>(() =>
                GrossSalaryRules.Quote(board, forged, state.ControlledActivities));
        }

        // Zero-lot seat: 16/16 is legitimate for a read-only Domain
        // salary quote. Alternate zero-deployed reserves must be rejected.
        var withoutFirstLot = state.ControlledActivities
            .Where(lot => lot.OwnerPlayerId != state.Players[0].PlayerId).ToArray();
        var zeroLot = state.Players.ToArray();
        zeroLot[0] = zeroLot[0] with { HenchmenAvailable = 16 };
        var validZero = GrossSalaryRules.Quote(board, zeroLot, withoutFirstLot);
        Assert.Equal(2, validZero[0].GrossAtoms);
        Assert.All(validZero.Skip(1), quote => Assert.Equal(3, quote.GrossAtoms));

        foreach (var total in new[] { 0, 1, 15, 17, 64 })
        {
            var forged = zeroLot.ToArray();
            forged[0] = forged[0] with
            {
                HenchmenTotal = total,
                HenchmenAvailable = total
            };
            Assert.Throws<ArgumentException>(() =>
                GrossSalaryRules.Quote(board, forged, withoutFirstLot));
        }

        // This is domain verification only; no gameplay wallet changes.
        Assert.Equal(state.Players, match.Snapshot().Players);
        Assert.Equal(state.ControlledActivities, match.Snapshot().ControlledActivities);
        Assert.True(match.VerifyPublicAudit().IsValid);
    }
}
