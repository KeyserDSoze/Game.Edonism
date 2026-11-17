namespace Edonism.Domain.Matches;

/// <summary>
/// A HYPOTHETICAL per-player result for one printed mayor tax setting.
/// No income is paid and no atoms are moved to the municipality.
/// </summary>
public sealed record MatchHypotheticalNetSalary(
    string PlayerId, int GrossAtoms, int HypotheticalTaxAtoms,
    int HypotheticalNetAtoms);

/// <summary>
/// Printed possibilities, NOT an elected mayor's chosen or applied tax.
/// PotentialWithheldAtoms is a calculation, not a municipal wallet balance.
/// </summary>
public sealed record MatchHypotheticalTaxScenario(
    int HypotheticalTaxAtomsPerPlayer, int PotentialWithheldAtoms,
    IReadOnlyList<MatchHypotheticalNetSalary> Players);

/// <summary>
/// Rulebook2 pp. 5, 9–10: a mayor can set 0, 1 or 2 atoms of salary tax.
/// Pure financial what-if math, never a salary settlement, a policy vote
/// or a command. Call only with a Domain-audited gross salary quote.
/// </summary>
public static class MatchSalaryTaxScenarios
{
    public const int PrintedMinTaxAtoms = 0;
    public const int PrintedMaxTaxAtoms = 2;

    public static IReadOnlyList<MatchHypotheticalTaxScenario> Quote(
        IReadOnlyList<MatchGrossSalaryQuote> grossQuotes)
    {
        ArgumentNullException.ThrowIfNull(grossQuotes);
        if (grossQuotes.Count is < 2 or > 8
            || grossQuotes.Any(quote => quote is null
                || !MatchParticipantId.IsValid(quote.PlayerId)
                || quote.BaseAtoms != GrossSalaryRules.PrintedBaseAtoms
                || quote.StandingActivityAtoms is < 0 or > 16
                || quote.GrossAtoms != quote.BaseAtoms + quote.StandingActivityAtoms)
            || grossQuotes.Select(quote => quote.PlayerId)
                .Distinct(StringComparer.Ordinal).Count() != grossQuotes.Count
            || grossQuotes.Sum(quote => quote.StandingActivityAtoms) > 30)
            throw new ArgumentException(
                "Hypothetical salary taxes require canonical public gross quotes.",
                nameof(grossQuotes));

        var variants = new MatchHypotheticalTaxScenario[
            PrintedMaxTaxAtoms - PrintedMinTaxAtoms + 1];
        for (var tax = PrintedMinTaxAtoms; tax <= PrintedMaxTaxAtoms; tax++)
        {
            var rows = grossQuotes.Select(quote => new MatchHypotheticalNetSalary(
                quote.PlayerId, quote.GrossAtoms, tax,
                checked(quote.GrossAtoms - tax))).ToArray();
            variants[tax - PrintedMinTaxAtoms] = new MatchHypotheticalTaxScenario(
                tax, checked(tax * grossQuotes.Count), Array.AsReadOnly(rows));
        }

        return Array.AsReadOnly(variants);
    }
}
