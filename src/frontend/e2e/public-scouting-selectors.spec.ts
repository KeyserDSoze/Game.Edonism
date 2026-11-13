import { expect, test } from "@playwright/test";
import { selectPublicScoutingView, type PublicScoutingFilters } from
  "../src/features/matches/publicScoutingSelectors";

// #99: the selector has NO HTTP, React, geometry, JSON-import or token
// dependencies. Only verified public projections may be passed by the UI.
// This deterministic test fixture intentionally includes 2/4/8 public seats.
const streets = Object.freeze([
  { id: "gauss", name: "Gauss Avenue" },
  { id: "einstein", name: "Einstein Avenue" },
  { id: "newton", name: "Newton Avenue" },
  { id: "planck", name: "Planck Avenue" },
  { id: "boson", name: "Boson Street" },
  { id: "meson", name: "Meson Street" },
  { id: "main-square", name: "Main Square" },
]);
const otherIds = ["bob", "charlie", "diana", "eve", "frank", "grace", "heidi"];

type Lot = Readonly<{
  slotId: string;
  ownerPlayerId: string;
  streetId: string;
  posture: number;
  streetSteps: number;
  streetPath: readonly string[];
}>;
type Other = Readonly<{
  otherPlayerId: string;
  streetId: string;
  streetSteps: number;
  streetPath: readonly string[];
}>;

function verifiedFixture(seatCount: 2 | 4 | 8) {
  const others: readonly Other[] = Object.freeze(otherIds.slice(0, seatCount - 1)
    .map((id, i) => Object.freeze({
      otherPlayerId: id,
      streetId: i % 2 === 0 ? "einstein" : "gauss",
      streetSteps: i % 3,
      streetPath: Object.freeze(i % 2 === 0 ? ["gauss", "einstein"] : ["gauss"]),
    })));
  const routes: readonly Lot[] = Object.freeze(others.flatMap((other, i) => [
    Object.freeze({
      slotId: "public-" + i + "-1",
      ownerPlayerId: other.otherPlayerId,
      streetId: i % 2 === 0 ? "einstein" : "gauss",
      posture: i % 2,
      streetSteps: i % 3,
      streetPath: Object.freeze(i % 2 === 0 ? ["gauss", "einstein"] : ["gauss"]),
    }),
    Object.freeze({
      slotId: "public-" + i + "-2",
      ownerPlayerId: other.otherPlayerId,
      streetId: i % 2 === 0 ? "gauss" : "newton",
      posture: (i + 1) % 2,
      streetSteps: (i + 1) % 3,
      streetPath: Object.freeze(i % 2 === 0 ? ["gauss"] : ["gauss", "newton"]),
    }),
  ]).sort((a, b) => a.streetSteps - b.streetSteps ||
    a.ownerPlayerId.localeCompare(b.ownerPlayerId) ||
    a.slotId.localeCompare(b.slotId)));
  return { others, routes };
}

const allFilters: PublicScoutingFilters = {
  ownerId: "", streetId: "", nearbyOnly: false, posture: "all",
};

for (const count of [2, 4, 8] as const) {
  test(`#99: ${count}-seat pure selectors preserve verified public ordering and group parity`, () => {
    const { others, routes } = verifiedFixture(count);
    const prior = JSON.stringify({ others, routes, streets });
    const full = selectPublicScoutingView(others, routes, streets, allFilters);

    expect(full.visibleOpponentLots).toEqual(routes);
    expect(full.visibleOpponentLots).not.toBe(routes);
    expect(full.nearestVisibleLotByRival.map(x => x.otherPlayerId))
      .toEqual(others.map(other => other.otherPlayerId));
    expect(full.rivalLotStreetDistribution.map(x => x.streetId))
      .toEqual(streets.map(x => x.id));
    expect(full.rivalLotStreetDistribution.reduce((sum, x) => sum + x.total, 0))
      .toBe(routes.length);
    expect(full.rivalLotStreetDistribution.find(x => x.streetId === "main-square"))
      .toMatchObject({ total: 0, standing: 0, fallen: 0, owners: [] });

    for (const street of full.rivalLotStreetDistribution) {
      const onStreet = routes.filter(x => x.streetId === street.streetId);
      expect(street.total).toBe(onStreet.length);
      expect(street.standing + street.fallen).toBe(street.total);
      expect(street.owners.map(x => x.ownerId)).toEqual(others
        .filter(other => onStreet.some(lot => lot.ownerPlayerId === other.otherPlayerId))
        .map(x => x.otherPlayerId));
      expect(street.owners.reduce((sum, x) => sum + x.total, 0))
        .toBe(street.total);
      for (const owner of street.owners) {
        const owned = onStreet.filter(x => x.ownerPlayerId === owner.ownerId);
        expect(owner.total).toBe(owned.length);
        expect(owner.standing).toBe(owned.filter(x => x.posture === 0).length);
        expect(owner.fallen).toBe(owned.filter(x => x.posture === 1).length);
      }
    }
    for (const other of full.nearestVisibleLotByRival) {
      expect(other.route).toEqual(routes.find(lot =>
        lot.ownerPlayerId === other.otherPlayerId) ?? null);
      expect(other.playerRoute).toBe(others.find(x =>
        x.otherPlayerId === other.otherPlayerId));
    }
    const selectedOwner = others[0].otherPlayerId;
    const scoped = selectPublicScoutingView(others, routes, streets, {
      ownerId: selectedOwner,
      streetId: "einstein",
      nearbyOnly: true,
      posture: "standing",
    });
    expect(scoped.selectedOpponentOwner).toBe(selectedOwner);
    expect(scoped.selectedOpponentStreet).toBe("einstein");
    expect(scoped.visibleOpponentLots).toEqual(routes.filter(route =>
      route.ownerPlayerId === selectedOwner
      && route.streetId === "einstein"
      && route.streetSteps <= 1 && route.posture === 0));
    // The complete public territory view is independent of all local filters.
    expect(scoped.rivalLotStreetDistribution).toEqual(full.rivalLotStreetDistribution);
    expect(scoped.nearestVisibleLotByRival.map(x => x.otherPlayerId))
      .toEqual(others.map(x => x.otherPlayerId));
    expect(JSON.stringify({ others, routes, streets })).toBe(prior);
  });
}

test("#99: unknown owner/street filters cannot create a new viewer identity or street", () => {
  const { others, routes } = verifiedFixture(8);
  const view = selectPublicScoutingView(others, routes, streets, {
    ownerId: "invented-rival", streetId: "invented-street",
    nearbyOnly: false, posture: "all",
  });
  expect(view.selectedOpponentOwner).toBe("");
  expect(view.selectedOpponentStreet).toBe("");
  expect(view.visibleOpponentLots).toEqual(routes);
  expect(view.rivalLotStreetDistribution).toHaveLength(7);
  expect(view.nearestVisibleLotByRival).toHaveLength(7);

  const empty = selectPublicScoutingView<Other, Lot>([], [], streets, allFilters);
  expect(empty.visibleOpponentLots).toEqual([]);
  expect(empty.nearestVisibleLotByRival).toEqual([]);
  expect(empty.rivalLotStreetDistribution).toHaveLength(7);
  expect(empty.rivalLotStreetDistribution.every(row =>
    row.total === 0 && row.owners.length === 0)).toBe(true);
});

test("#99: nearby and posture compose without reordering paths or hiding rival seat positions", () => {
  const { others, routes } = verifiedFixture(4);
  const filtered = selectPublicScoutingView(others, routes, streets, {
    ownerId: "", streetId: "", nearbyOnly: true, posture: "fallen",
  });
  expect(filtered.visibleOpponentLots).toEqual(routes.filter(route =>
    route.streetSteps <= 1 && route.posture === 1));
  expect(filtered.nearestVisibleLotByRival).toHaveLength(others.length);
  for (const other of filtered.nearestVisibleLotByRival) {
    expect(other.playerRoute).toBe(others.find(x =>
      x.otherPlayerId === other.otherPlayerId));
  }
  expect(filtered.rivalLotStreetDistribution.reduce((sum, row) => sum + row.total, 0))
    .toBe(routes.length);
});
